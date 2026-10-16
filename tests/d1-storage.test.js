import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createDatabase,eq,inArray,sql} from '../tgcloud/lib/d1-query.js';
import {storageModel} from '../tgcloud/lib/storage-model.js';
import {handleQuery} from '../shared/worker.js';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE subscriptions(tg_id INTEGER PRIMARY KEY,active INTEGER DEFAULT 0,profile TEXT NOT NULL,seen TEXT NOT NULL); CREATE TABLE leases(key TEXT PRIMARY KEY,until INTEGER NOT NULL); CREATE TABLE snapshots(key TEXT PRIMARY KEY,value TEXT NOT NULL,reader TEXT,updated_at INTEGER);');
  const schema=Object.fromEntries(Object.entries(storageModel).map(([name,meta])=>[name,Object.fromEntries(Object.keys(meta.fields).map(key=>[key,{}]))]));
  const execute=async ({text,params})=>{
    const before=sqlite.prepare('SELECT total_changes() AS n').get().n;
    const rows=sqlite.prepare(text).all(...params);
    return {rows,changes:sqlite.prepare('SELECT total_changes() AS n').get().n-before};
  };
  return {sqlite,schema,db:createDatabase(schema,storageModel,execute),execute};
}

test('D1 adapter preserves JSON, booleans, dates, upserts, filtering and deletion',async()=>{
  const {sqlite,schema,db}=fixture();
  const users=schema.subscriptions;
  await db.insert(users).values({tgId:42,active:true,profile:{name:"O'Neil",courses:['3'],فارسی:'نام'},seen:{}}).onConflictDoUpdate({target:users.tgId,set:{active:true}}).run();
  let row=await db.select().from(users).where(eq(users.tgId,42)).get();
  assert.equal(row.active,true);assert.equal(row.profile.name,"O'Neil");assert.equal(row.profile.فارسی,'نام');
  await db.insert(users).values({tgId:42,active:false,profile:{},seen:{}}).onConflictDoUpdate({target:users.tgId,set:{active:false}}).run();
  row=await db.select().from(users).where(eq(users.tgId,42)).get();assert.equal(row.active,false);assert.equal(row.profile.name,"O'Neil");
  await db.update(users).set({profile:{courses:['80']},active:true}).where(eq(users.tgId,42)).run();
  assert.equal(await db.$count(users),1);
  const at=new Date('2026-10-17T00:00:00Z');
  await db.insert(schema.snapshots).values({key:'a',value:[{id:1}],updatedAt:at,reader:null}).run();
  const snapshots=await db.select().from(schema.snapshots).where(inArray(schema.snapshots.key,['a','b'])).all();
  assert.equal(snapshots[0].updatedAt.toISOString(),at.toISOString());assert.deepEqual(snapshots[0].value,[{id:1}]);
  assert.deepEqual(await db.select().from(schema.snapshots).where(inArray(schema.snapshots.key,[])).all(),[]);
  await db.delete(users).where(eq(users.tgId,42)).run();assert.equal(await db.$count(users),0);
  sqlite.close();
});

test('D1 lease claims remain atomic and only the matching claimant releases',async()=>{
  const {sqlite,db}=fixture();
  const claim=until=>db.run(sql`INSERT INTO leases (key, until) VALUES ('scan', ${until}) ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE leases.until < ${100}`);
  const claims=await Promise.all([claim(200),claim(300)]);
  assert.deepEqual(claims.map(r=>r.rowsAffected),[1,0]);
  await db.run(sql`UPDATE leases SET until = 0 WHERE key = 'scan' AND until = ${300}`);
  assert.equal((await db.get(sql`SELECT until FROM leases WHERE key = 'scan'`)).until,200);
  sqlite.close();
});

test('shared database service rejects unauthenticated and destructive requests',async()=>{
  const {sqlite,execute}=fixture();let requests=0;
  const env={DATABASE_KEY:'test-key',SHARED_DB:{prepare(text){return {bind(...params){return {async all(){requests++;const r=await execute({text,params});return {results:r.rows,meta:{changes:r.changes}};}};}};}}};
  const request=(key,text='SELECT 1 AS ok')=>new Request('https://example.com/query',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify({text,params:[]})});
  assert.equal((await handleQuery(request('wrong'),env)).status,401);assert.equal(requests,0);
  assert.equal((await handleQuery(request('test-key','DROP TABLE leases'),env)).status,503);
  assert.equal((await handleQuery(request('test-key','SELECT 1; DELETE FROM leases'),env)).status,503);
  const response=await handleQuery(request('test-key'),env);assert.equal(response.status,200);assert.deepEqual(await response.json(),{rows:[{ok:1}],changes:0});
  sqlite.close();
});

test('Telegram SDK fresh column descriptors resolve by physical table and column',async()=>{
  const {sqlite,schema,execute}=fixture();
  const users={};for(const [key,field]of Object.entries(storageModel.subscriptions.fields))Object.defineProperty(users,key,{get:()=>({_table:'subscriptions',_col:field.name})});
  schema.subscriptions=users;const db=createDatabase(schema,storageModel,execute);
  await db.insert(users).values({tgId:7,active:true,profile:{name:'Test'},seen:{}}).run();
  assert.equal((await db.select().from(users).where(eq(users.tgId,7)).get()).profile.name,'Test');
  sqlite.close();
});

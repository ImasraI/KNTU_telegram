import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { authenticate, seal, unseal } from '../personal/security.js';
import { universityLogin } from '../personal/login.js';
import { handleRequest, refreshPersonal, withRenewal } from '../personal/worker.js';
import { personalCommand } from '../tgcloud/lib/personal-bot.js';

const BOT='123:fake-test-bot', KEY=Buffer.alloc(32,7).toString('base64'), ORIGIN='https://personal.example';
function init(id=123,date=Math.floor(Date.now()/1000),extra={}) {
  const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id,first_name:'Test'}),...extra});
  const secret=createHmac('sha256','WebAppData').update(BOT).digest();
  p.set('hash',createHmac('sha256',secret).update([...p].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return p.toString();
}
function database() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../personal/schema.sql',import.meta.url),'utf8'));
  return {db,prepare(sql){let values=[];const q={bind(...v){values=v;return q;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};return q;}};
}
const home='<script>M.cfg={"userId":42};</script><select id="calendar-course-filter-1"><option value="3">Course</option></select>';
const course='<body id="page-course-view-topics"><li id="module-9"><a href="https://vc.kntu.ac.ir/mod/resource/view.php?id=9"><span class="instancename">File</span></a></li></body>';
function request(action,input={},id=123){return new Request(ORIGIN+'/api/'+action,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({...input,initData:init(id)})});}
function env(){return {BOT_TOKEN:BOT,VAULT_KEY:KEY,PERSONAL_DB:database()};}
const logged=async()=>({userId:42,session:'FAKE_SESSION_123',courses:[{id:3,fullname:'Course'}]});
const connect=(e,input={},id=123)=>handleRequest(request('connect',{username:'student',password:'private-password',remember:false,...input},id),e,{login:logged});
function unlock(e,id=123){e.PERSONAL_DB.db.prepare('UPDATE personal_connections SET last_attempt_at=0 WHERE tg_id=?').run(id);}

test('personal routing allows only private owner chat and never asks for password in messages',()=>{
  const group=personalCommand({text:'/personal',from:{id:123},chat:{id:-1,type:'group'}},ORIGIN);
  assert.equal(group.reply_markup,undefined);
  const topic=personalCommand({text:'/personal',from:{id:123},chat:{id:-1,type:'supergroup'},message_thread_id:77},ORIGIN);
  assert.equal(topic.message_thread_id,77);assert.equal(topic.reply_markup,undefined);
  const privateMessage={text:'/personal',from:{id:123},chat:{id:123,type:'private'}};
  assert.equal(personalCommand(privateMessage,ORIGIN).reply_markup.inline_keyboard[0][0].web_app.url,ORIGIN);
  assert.equal(personalCommand(privateMessage,'').reply_markup,undefined);
  assert.equal(personalCommand(privateMessage,'https://a.example/?password=x').reply_markup,undefined);
});
test('Telegram initData is signed, fresh, unique and private',async()=>{
  assert.equal(await authenticate(init(),BOT),123);
  for(const value of [init()+'x',init(123,1),init(123,undefined,{chat_type:'group'}),init()+'&user={}']) await assert.rejects(authenticate(value,BOT),/UNAUTHORIZED/);
  await assert.rejects(authenticate(init(), 'wrong-token'),/UNAUTHORIZED/);
});
test('AES-GCM vault is randomized, authenticated and bound to Telegram owner',async()=>{
  const a=await seal({password:'sensitive',payload:'x'.repeat(160000)},123,KEY),b=await seal({password:'sensitive'},123,KEY);
  assert.ok(!a.includes('sensitive'));assert.notEqual(a,b);assert.equal((await unseal(a,123,KEY)).password,'sensitive');
  await assert.rejects(unseal(a,456,KEY));await assert.rejects(unseal(a,123,Buffer.alloc(32,8).toString('base64')));
  await assert.rejects(seal({},123,'bad-key'),/SERVER_CONFIG/);
});
function ssoRequest({foreign=false,bad=false}={}) {
  const calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url,options});assert.equal(options.redirect,'manual');
    const u=new URL(url);
    if(u.origin==='https://vc.kntu.ac.ir'&&u.pathname==='/login/index.php')return new Response('<a href="/auth/oauth2/login.php?id=1&amp;sesskey=fresh">University</a>',{headers:{'Set-Cookie':'MoodleSession=INITIAL_SESSION; Path=/; HttpOnly'}});
    if(u.pathname==='/auth/oauth2/login.php')return new Response(null,{status:302,headers:{location:'https://sso.kntu.ac.ir/auth'}});
    if(u.pathname==='/auth')return new Response(`<form id="kc-form-login" action="${foreign?'https://evil.example/steal':'https://sso.kntu.ac.ir/realms/kntu/login-actions/authenticate?session_code=fresh'}"><input type="hidden" name="hidden" value="fresh"></form>`,{headers:{'Set-Cookie':'AUTH_SESSION_ID=SSOCOOKIE; Path=/; HttpOnly'}});
    if(u.pathname.includes('login-actions')) {
      assert.equal(options.method,'POST');assert.ok(options.headers.Cookie.includes('AUTH_SESSION_ID=SSOCOOKIE'));assert.ok(!options.headers.Cookie.includes('MoodleSession'));
      const fields=new URLSearchParams(options.body);assert.equal(fields.get('username'),'student');assert.equal(fields.get('password'),'password');assert.equal(fields.get('hidden'),'fresh');
      return bad?new Response('<form id="kc-form-login"></form>'):new Response(null,{status:302,headers:{location:'https://vc.kntu.ac.ir/admin/oauth2callback.php?code=transient'}});
    }
    if(u.pathname==='/admin/oauth2callback.php')return new Response(null,{status:302,headers:{location:'/my/index.php','Set-Cookie':'MoodleSession=ROTATED_SESSION_123; Path=/; HttpOnly'}});
    if(u.pathname==='/my/index.php'){assert.equal(options.headers.Cookie,'MoodleSession=ROTATED_SESSION_123');return new Response(home);}
    assert.fail('unexpected university request');
  };return {calls,fetcher};
}
test('fresh SSO flow keeps cookies by origin, submits CSRF fields, follows callback and verifies identity',async()=>{
  const {calls,fetcher}=ssoRequest();const result=await universityLogin('student','password',fetcher);
  assert.equal(result.userId,42);assert.equal(result.session,'ROTATED_SESSION_123');assert.equal(result.courses[0].id,3);
  assert.ok(calls.every(c=>!c.url.includes('password')));
});
test('foreign login action and invalid credentials fail without accepting guest session',async()=>{
  const foreign=ssoRequest({foreign:true});await assert.rejects(universityLogin('student','password',foreign.fetcher),/LOGIN_FLOW_UNSUPPORTED/);
  assert.ok(!foreign.calls.some(c=>c.options.method==='POST'));
  await assert.rejects(universityLogin('student','password',ssoRequest({bad:true}).fetcher),/LOGIN_FAILED/);
});
test('session renews exactly once only for authentication failures and matching identity',async()=>{
  let attempts=0,logins=0;const data={session:'old',username:'s',password:'p',userId:42};
  const result=await withRenewal(data,async s=>{attempts++;if(s==='old')throw new Error('LOGIN_REQUIRED');return 'ok';},undefined,async()=>{logins++;return {...await logged(),session:'new'};});
  assert.equal(result,'ok');assert.equal(attempts,2);assert.equal(logins,1);
  await assert.rejects(withRenewal({...data,password:null},async()=>{throw new Error('LOGIN_REQUIRED');}),/LOGIN_REQUIRED/);
  await assert.rejects(withRenewal(data,async()=>{throw new Error('UNIVERSITY_UNREACHABLE');},undefined,async()=>assert.fail('must not relogin')),/UNIVERSITY_UNREACHABLE/);
  await assert.rejects(withRenewal(data,async()=>{throw new Error('LOGIN_REQUIRED');},undefined,async()=>({...await logged(),userId:99})),/LOGIN_FAILED/);
});
test('optional password persistence, encrypted session and owner-only status',async()=>{
  const e=env();assert.equal((await connect(e)).status,200);
  let row=await e.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id=?').bind(123).first();
  assert.ok(!row.sealed.includes('private-password'));assert.ok(!row.sealed.includes('FAKE_SESSION'));
  assert.equal((await unseal(row.sealed,123,KEY)).password,null);
  const own=await (await handleRequest(request('status'),e)).json();assert.equal(own.connected,true);assert.equal(own.remember,false);assert.ok(!JSON.stringify(own).includes('FAKE_SESSION'));
  const other=await (await handleRequest(request('status',{tgId:123,chatId:123},456),e)).json();assert.equal(other.connected,false);
  unlock(e);assert.equal((await connect(e,{remember:true})).status,200);
  row=await e.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id=?').bind(123).first();assert.equal((await unseal(row.sealed,123,KEY)).password,'private-password');
  assert.equal((await connect(e)).status,429);
  unlock(e);await connect(e,{remember:false});
  row=await e.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id=?').bind(123).first();assert.equal((await unseal(row.sealed,123,KEY)).password,null);
  e.PERSONAL_DB.db.close();
});
test('API rejects forged identity, foreign origin and malformed input before university login',async()=>{
  const e=env();let logins=0;const dependencies={login:async()=>{logins++;return logged();}};
  const forged=new Request(ORIGIN+'/api/connect',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({initData:'user=123',username:'x',password:'p',remember:true})});
  assert.equal((await handleRequest(forged,e,dependencies)).status,401);
  const foreign=new Request(request('connect'));foreign.headers.set('Origin','https://evil.example');assert.equal((await handleRequest(foreign,e,dependencies)).status,401);
  assert.equal((await handleRequest(request('connect',{username:'',password:'p',remember:true}),e,dependencies)).status,400);assert.equal(logins,0);e.PERSONAL_DB.db.close();
});
test('refresh baselines privately, sends only to owner, and disconnect deletes credentials and cache',async()=>{
  const e=env();await connect(e,{remember:true});unlock(e);let changed=false;const recipients=[];
  const upstream=async(url,options={})=>{
    if(url.startsWith('https://api.telegram.org/')){recipients.push(JSON.parse(options.body).chat_id);return Response.json({ok:true,result:{message_id:1}});}
    if(url.endsWith('/my/index.php'))return new Response(home);
    if(url.includes('/course/view.php'))return new Response(changed?course.replace('File','New File'):course);
    assert.fail('unexpected request');
  };
  await refreshPersonal(e,123,{request:upstream,notify:true});assert.equal(recipients.length,0);
  unlock(e);changed=true;await refreshPersonal(e,123,{request:upstream,notify:true});assert.deepEqual(recipients,[123]);
  unlock(e);await refreshPersonal(e,123,{request:upstream,notify:true});assert.deepEqual(recipients,[123]);
  await handleRequest(request('disconnect',{tgId:123},456),e);assert.equal((await (await handleRequest(request('status'),e)).json()).connected,true);
  await handleRequest(request('disconnect'),e);assert.equal((await (await handleRequest(request('status'),e)).json()).connected,false);
  assert.equal(e.PERSONAL_DB.db.prepare('SELECT COUNT(*) AS n FROM personal_connections WHERE tg_id=123').get().n,0);e.PERSONAL_DB.db.close();
});
test('disconnect during refresh cannot recreate personal data or send in-flight messages',async()=>{
  const e=env();await connect(e);unlock(e);let calls=0;
  await assert.rejects(refreshPersonal(e,123,{request:async url=>{
    calls++;if(url.endsWith('/my/index.php'))return new Response(home);
    await handleRequest(request('disconnect'),e);return new Response(course);
  },notify:true}),/BUSY/);
  assert.equal(calls,2);assert.equal((await (await handleRequest(request('status'),e)).json()).connected,false);e.PERSONAL_DB.db.close();
});
test('expired personal session renews through SSO during refresh, but only with saved consent',async()=>{
  const e=env();await connect(e,{remember:true});unlock(e);let renewals=0;
  const upstream=async(url,options)=>{
    if(options.headers.Cookie==='MoodleSession=FAKE_SESSION_123')return new Response(null,{status:302,headers:{location:'/login/index.php'}});
    return new Response(url.endsWith('/my/index.php')?home:course);
  };
  const result=await refreshPersonal(e,123,{request:upstream,login:async()=>{renewals++;return {...await logged(),session:'NEW_SESSION_123'};}});
  assert.equal(renewals,1);assert.equal(result.state,'connected');
  let row=await e.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id=?').bind(123).first();assert.equal((await unseal(row.sealed,123,KEY)).session,'NEW_SESSION_123');
  unlock(e);await connect(e,{remember:false});unlock(e);
  await assert.rejects(refreshPersonal(e,123,{request:upstream,login:async()=>assert.fail('must not use a forgotten password')}),/LOGIN_REQUIRED/);
  row=await e.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id=?').bind(123).first();assert.equal(row.state,'needs_login');e.PERSONAL_DB.db.close();
});
test('failed new login preserves existing encrypted connection and never returns remote details',async()=>{
  const e=env();await connect(e);unlock(e);
  const before=(await e.PERSONAL_DB.prepare('SELECT sealed FROM personal_connections WHERE tg_id=?').bind(123).first()).sealed;
  const response=await handleRequest(request('connect',{username:'student',password:'do-not-leak',remember:true}),e,{login:async()=>{throw new Error('remote page password=do-not-leak');}});
  assert.equal(response.status,400);assert.equal(await response.text(),'{"error":"REQUEST_FAILED"}');
  assert.equal((await e.PERSONAL_DB.prepare('SELECT sealed FROM personal_connections WHERE tg_id=?').bind(123).first()).sealed,before);e.PERSONAL_DB.db.close();
});

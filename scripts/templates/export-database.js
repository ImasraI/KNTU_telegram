import {db as telegramDb,EndpointError} from 'sdk';
import {db as cloudDb,sql as cloudSql} from '../lib/database.js';
import {storageModel} from '../lib/storage-model.js';
import {sql} from 'sdk/db';
import {OWNER_ID} from '../lib/config.js';
export default async function(input,ctx) {
 if(ctx?.initData?.user?.id!==OWNER_ID) throw new EndpointError('Owner only',{code:'OWNER_ONLY'});
 const backend=input?.backend==='telegram'?'telegram':'cloudflare';
 const db=backend==='telegram'?telegramDb:cloudDb;
 const query=backend==='telegram'?sql:cloudSql;
 const names=Object.values(storageModel).map(table=>"'"+table.name+"'").join(',');
 const schema=await db.all(query.raw('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN ('+names+') AND sql IS NOT NULL')); 
 const tables={};
 for(const entry of schema.filter(e=>e.type==='table')) {
  tables[entry.name]=await db.all(query.raw('SELECT * FROM "'+entry.name.replace(/"/g,'""')+'"'));
 }
 return 'PRIVATE_BACKUP_START'+JSON.stringify({format:1,backend,createdAt:new Date().toISOString(),appId:'8298297292',schema,tables})+'PRIVATE_BACKUP_END';
}

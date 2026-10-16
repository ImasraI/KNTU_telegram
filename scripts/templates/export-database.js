import {db,EndpointError} from 'sdk';
import {sql} from 'sdk/db';
import {OWNER_ID} from '../lib/config.js';
export default async function(input,ctx) {
 if(ctx?.initData?.user?.id!==OWNER_ID) throw new EndpointError('Owner only',{code:'OWNER_ONLY'});
 const schema=await db.all(sql`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`);
 const tables={};
 for(const entry of schema.filter(e=>e.type==='table')) {
  tables[entry.name]=await db.all(sql.raw('SELECT * FROM "'+entry.name.replace(/"/g,'""')+'"'));
 }
 return 'PRIVATE_BACKUP_START'+JSON.stringify({format:1,createdAt:new Date().toISOString(),appId:'8298297292',schema,tables})+'PRIVATE_BACKUP_END';
}

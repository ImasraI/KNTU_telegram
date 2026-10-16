import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {OWNER_ID} from '../tgcloud/lib/config.js';
const backend=process.argv.includes('--telegram')?'telegram':'cloudflare';
const endpoint=resolve('tgcloud/endpoints/exportDatabase.js');
if(existsSync(endpoint)) throw new Error('Backup endpoint path already exists; refusing to overwrite it.');
writeFileSync(endpoint,readFileSync(new URL('./templates/export-database.js',import.meta.url)));
try {
 const out=spawnSync(process.execPath,['node_modules/@tgcloud/cli/bin/tgcloud.js','run','endpoints/exportDatabase',JSON.stringify({backend}),'--ctx',JSON.stringify({initData:{user:{id:OWNER_ID}}})],{encoding:'utf8',maxBuffer:100*1024*1024,timeout:180000});
 const start=out.stdout?.indexOf('PRIVATE_BACKUP_START'),end=out.stdout?.lastIndexOf('PRIVATE_BACKUP_END');
 if(out.status!==0||start<0||end<0) throw new Error('Backup failed; remote output withheld to protect credentials.');
 const raw=out.stdout.slice(start+'PRIVATE_BACKUP_START'.length,end),backup=JSON.parse(raw);
 const dir=resolve('..','KNTU_backups');mkdirSync(dir,{recursive:true});
 const path=resolve(dir,backend+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');writeFileSync(path,raw,{mode:0o600});
 console.log(JSON.stringify({path,bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex'),rows:Object.fromEntries(Object.entries(backup.tables).map(([name,rows])=>[name,rows.length]))}));
} finally {unlinkSync(endpoint);}

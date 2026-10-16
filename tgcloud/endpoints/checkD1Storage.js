import student from './student.js';
import {EndpointError} from 'sdk';
import {db,eq,sql} from '../lib/database.js';
import * as schema from '../schema.js';
import {OWNER_ID} from '../lib/config.js';
import {directorySummary} from '../lib/monitor.js';
export default async function(input,ctx) {
 if(ctx?.initData?.user?.id!==OWNER_ID)throw new EndpointError('Owner only',{code:'OWNER_ONLY'});
 let writeVerified=false;
 if(input?.probe) {
  const key='_migration_probe:'+Date.now();
  try {
   await db.insert(schema.settings).values({key,value:{probe:true}}).run();
   writeVerified=(await db.select().from(schema.settings).where(eq(schema.settings.key,key)).get())?.value?.probe===true;
  } finally {await db.delete(schema.settings).where(eq(schema.settings.key,key)).run();}
 }
 const counts={};for(const [name,table]of Object.entries(schema))counts[name]=await db.$count(table);
 const courses=(await db.select().from(schema.settings).where(eq(schema.settings.key,'courses')).get())?.value;
 const directory=await directorySummary();
 const view=await student({action:'home'},ctx);
 return {backend:'Cloudflare D1',writeVerified,counts,courses:Array.isArray(courses)?courses.length:null,directoryCourses:directory.courses.length,miniAppCourses:view.courses.length};
}

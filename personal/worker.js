import {contributionConsent,publishEnrollment,withdrawEnrollment,sharedActivities,recordVerifiedUser} from './shared.js';
import { authenticate, seal, unseal, validateVaultKey } from './security.js';
import { credentialInput, universityLogin, dashboard, VC } from './login.js';
import { connector } from '../tgcloud/lib/moodle.js';
import { signature, notification,matchingSignature } from '../tgcloud/lib/content.js';
import {submissionState} from '../tgcloud/lib/submissions.js';

const SAFE_CODES = new Set(['INVALID_INPUT','UNAUTHORIZED','LOGIN_FAILED','LOGIN_REQUIRED','LOGIN_INTERACTION_REQUIRED','LOGIN_FLOW_UNSUPPORTED','SESSION_UNAVAILABLE','UNIVERSITY_UNREACHABLE','UNIVERSITY_RATE_LIMIT','DASHBOARD_LAYOUT','BUSY','RETRY_LATER','NOT_CONNECTED','SERVER_CONFIG','VAULT_ERROR','SHARING_CONSENT_REQUIRED','PASSWORD_REQUIRED']);
const codeOf = e => SAFE_CODES.has(e?.message) ? e.message : 'REQUEST_FAILED';
const reply = (value, status=200) => Response.json(value, {status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const authExpired = e => ['LOGIN_REQUIRED','UNIVERSITY_LOGIN_REQUIRED','UNIVERSITY_HTTP_401','UNIVERSITY_HTTP_403'].includes(e?.message);
function configured(env) { if(!env.PERSONAL_DB || !env.BOT_TOKEN || !env.VAULT_KEY) throw new Error('SERVER_CONFIG'); validateVaultKey(env.VAULT_KEY); }
async function rowFor(env,id) { return env.PERSONAL_DB.prepare('SELECT * FROM personal_connections WHERE tg_id = ?').bind(id).first(); }
async function claim(env,id) {
  const now=Date.now(), until=now+120000, token=crypto.randomUUID();
  const row=await env.PERSONAL_DB.prepare(`INSERT INTO personal_connections (tg_id,lease_until,lease_token,last_attempt_at) VALUES (?,?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET lease_until=excluded.lease_until,lease_token=excluded.lease_token,last_attempt_at=excluded.last_attempt_at
    WHERE personal_connections.lease_until < ? AND personal_connections.last_attempt_at < ? RETURNING tg_id`).bind(id,until,token,now,now,now-60000).first();
  if(!row) {
    // Report the real remaining wait so a client can show it beside the action
    // instead of parroting a fixed "one minute" on the dashboard.
    const previous=await env.PERSONAL_DB.prepare('SELECT last_attempt_at FROM personal_connections WHERE tg_id=?').bind(id).first();
    const retryAfterSeconds=Math.max(1,Math.ceil((Number(previous?.last_attempt_at??0)+60000-now)/1000));
    throw Object.assign(new Error('BUSY'),{retryAfterSeconds});
  }
  return {until,token};
}
async function save(env,id,lease,data,state='connected',error=null) {
  const encrypted=await seal(data,id,env.VAULT_KEY);
  const result=await env.PERSONAL_DB.prepare('UPDATE personal_connections SET sealed=?,state=?,last_error=?,updated_at=?,contributing=?,next_refresh_at=?,queued_at=0 WHERE tg_id=? AND lease_token=? AND lease_until>?').bind(encrypted,state,error,Date.now(),data.contribute?1:0,Date.now()+(state==='connected'?6*3600000:15*60000),id,lease.token,Date.now()).run();
  if(!result.meta?.changes) throw new Error('BUSY');
}
async function release(env,id,lease) { await env.PERSONAL_DB.prepare('UPDATE personal_connections SET lease_until=0,lease_token=NULL WHERE tg_id=? AND lease_token=?').bind(id,lease.token).run(); }
async function publishSavedEnrollment(env,id,lease,data) {
  try { await publishEnrollment(env,id,data); }
  catch(error) {
    // Retain encrypted credentials, but retry a failed shared publication soon.
    await save(env,id,lease,data,'error',codeOf(error));
    throw error;
  }
}
function summary(data,row) {
  return {connected:!!data, state:row?.state??'disconnected', error:row?.last_error??null,
    remember:!!data?.password, contributing:!!data?.contribute, lastSuccessAt:data?.lastSuccessAt??null,lastRenewedAt:data?.lastRenewedAt??null,
    courses:(data?.courses??[]).map(c=>({id:c.id,name:c.fullname})),
    items:Object.entries(data?.snapshots??{}).flatMap(([courseId,items])=>items.map(i=>({courseId,id:i.id,name:i.name,kind:i.kind,dates:i.dates,url:i.url}))) };
}
function universityFetch(request, deadline) {
  return async (url,options={}) => {
    if(new URL(url).origin!==VC) throw new Error('LOGIN_FLOW_UNSUPPORTED');
    if(Date.now()>=deadline) throw new Error('UNIVERSITY_UNREACHABLE');
    const res=await request(url,{...options,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now())))});
    if(res.status>=300&&res.status<400) throw new Error('LOGIN_REQUIRED');
    return res;
  };
}
export async function withRenewal(data,operation,request=fetch,login=universityLogin) {
  try { return await operation(data.session); }
  catch(e) {
    if(!authExpired(e)) throw e;
    if(!data.password) throw new Error('LOGIN_REQUIRED');
    const next=await login(data.username,data.password,request);
    if(next.userId!==data.userId) throw new Error('LOGIN_FAILED');
    data.session=next.session; data.courses=next.courses; data.lastRenewedAt=new Date().toISOString();
    return await operation(data.session); // One retry; never loop on a bad password.
  }
}
async function privateSend(env,id,text,request) {
  // The recipient is always the verified Telegram user / D1 primary key. No group parameter exists.
  const res=await request(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:id,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000)});
  let result; try {result=await res.json();}catch{throw new Error('DELIVERY_FAILED');}
  if(!res.ok||result.ok!==true) throw new Error('DELIVERY_FAILED');
}
export async function refreshPersonal(env,id,{request=fetch,notify=false,login=universityLogin}={}) {
  const lease=await claim(env,id);
  let data, previousState;
  try {
    const row=await rowFor(env,id);
    previousState=row?.state;
    if(!row?.sealed) throw new Error('NOT_CONNECTED');
    data=await unseal(row.sealed,id,env.VAULT_KEY);
    if(env.UNIFIED_CATALOG==='1'&&!data.contribute){data.contribute=true;data.consentAt=Date.now();}
    const deadline=Date.now()+70000;
    const limited=universityFetch(request,deadline);
    // Validate the current identity as well as enrollment before touching personal data.
    const home=await withRenewal(data,async session=>{
      const res=await limited(VC+'/my/index.php',{headers:{Cookie:'MoodleSession='+session}});
      if(!res.ok) throw new Error(res.status===401||res.status===403?'LOGIN_REQUIRED':'UNIVERSITY_UNREACHABLE');
      return dashboard(await res.text());
    },request,login);
    if(home.userId!==data.userId) throw new Error('LOGIN_FAILED');
    data.courses=home.courses;
    if(data.contribute) {
      await save(env,id,lease,data);
      await publishSavedEnrollment(env,id,lease,data);
      data.snapshots=await sharedActivities(env,data.courses);
      data.lastSuccessAt=new Date().toISOString();
      await save(env,id,lease,data);
      return summary(data,{state:'connected'});
    }
    data.snapshots??={}; data.receipts??={};
    let sent=0;
    for(const course of data.courses) {
      const items=await withRenewal(data,session=>connector(limited,{mode:'session',secret:session}).items(course),request,login);
      const key=String(course.id), previous=data.snapshots[key];
      if(!previous) {
        for(const item of items) data.receipts[`${key}:${item.id}`]=signature(item);
      } else if(notify) {
        for(const item of items) {
          const receipt=`${key}:${item.id}`, old=data.receipts[receipt];
          if(matchingSignature(old,item)) continue;
          if(sent>=20) break;
          // Recheck the lease before any outgoing message, including after /disconnect.
          const live=await rowFor(env,id);
          if(live?.lease_token!==lease.token || Date.now()>=lease.until) throw new Error('BUSY');
          await privateSend(env,id,notification(course,{...item,change:old?'updated':'new'}),request);
          data.receipts[receipt]=signature(item); sent++;
          await save(env,id,lease,data);
        }
      }
      data.snapshots[key]=items;
      await save(env,id,lease,data);
    }
    const enrolled=new Set(data.courses.map(c=>String(c.id)));
    for(const key of Object.keys(data.snapshots)) if(!enrolled.has(key)) delete data.snapshots[key];
    for(const key of Object.keys(data.receipts)) if(!enrolled.has(key.split(':')[0])) delete data.receipts[key];
    data.lastSuccessAt=new Date().toISOString();
    await save(env,id,lease,data);
    return summary(data,{state:'connected'});
  } catch(e) {
    const code=codeOf(e);
    const needsLogin=['LOGIN_REQUIRED','LOGIN_FAILED','LOGIN_INTERACTION_REQUIRED'].includes(code);
    if(data) {
      try {
        await save(env,id,lease,data,needsLogin?'needs_login':'error',code);
        if(notify && needsLogin && previousState!=='needs_login') await privateSend(env,id,'اتصال شخصی VC نیازمند ورود دوباره است. در پیوی ربات /personal را باز کنید. رمز را در چت نفرستید.',request);
      } catch {/* Deletion, superseded lease or failed private warning must not recreate data. */}
    }
    throw new Error(code);
  } finally { await release(env,id,lease); }
}
// The authenticated status of one Telegram user's own VC connection. Shared by
// the public /api/status route and the CatalogAdmin service entrypoint, so both
// report the same thing: real personal-service state, never a projection of the
// shared catalog.
export async function personalStatus(env,id) {
  configured(env);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('INVALID_INPUT');
  const row=await rowFor(env,id);
  const data=row?.sealed?await unseal(row.sealed,id,env.VAULT_KEY):null;
  if(data?.contribute)data.snapshots=await sharedActivities(env,data.courses);
  return summary(data,row);
}
// Connect (or reconnect) one, already-verified Telegram user. The caller supplies
// only credentials; the user id comes from verified initData upstream.
export async function connectPersonal(env,id,input,{upstream=fetch,login=universityLogin}={}) {
  configured(env);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('INVALID_INPUT');
  const contribute=env.UNIFIED_CATALOG==='1'||contributionConsent(input);
  if(contribute&&!env.SHARED_DB)throw new Error('SERVER_CONFIG');
  const credentials=credentialInput(env.UNIFIED_CATALOG==='1'?{...input,remember:true}:input);
  const lease=await claim(env,id);
  try {
    const result=await login(credentials.username,credentials.password,upstream);
    const data={contribute,consentAt:contribute?Date.now():null,username:credentials.username,password:credentials.remember?credentials.password:null,
      session:result.session,userId:result.userId,courses:result.courses,snapshots:{},receipts:{},lastSuccessAt:null,lastRenewedAt:new Date().toISOString()};
    await save(env,id,lease,data);
    await publishSavedEnrollment(env,id,lease,data);
    return summary(data,{state:'connected'});
  } finally { await release(env,id,lease); }
}
// Disconnect is idempotent and only ever touches this user's own row.
export async function disconnectPersonal(env,id) {
  configured(env);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('INVALID_INPUT');
  await withdrawEnrollment(env,id);
  await env.PERSONAL_DB.prepare('DELETE FROM personal_connections WHERE tg_id=?').bind(id).run();
  return {disconnected:true};
}
export async function handleRequest(request,env,{upstream=fetch,login=universityLogin}={}) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')) {
    const publicAssets = new Set(['/','/index.html','/theme.css','/style.css','/app.js']);
    if(!['GET','HEAD'].includes(request.method)||!publicAssets.has(url.pathname)) return new Response('Not found',{status:404});
    const res=await env.ASSETS.fetch(request);
    const headers=new Headers(res.headers);
    headers.set('Cache-Control','no-store'); headers.set('Referrer-Policy','no-referrer');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    return new Response(res.body,{status:res.status,headers});
  }
  if(request.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
  try {
    configured(env);
    if(request.headers.get('origin')!==url.origin) throw new Error('UNAUTHORIZED');
    if(!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('INVALID_INPUT');
    const reader=request.body?.getReader(); let size=0,parts=[];
    if(!reader) throw new Error('INVALID_INPUT');
    while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw new Error('INVALID_INPUT');}parts.push(value);}
    const buffer=new Uint8Array(size);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(buffer));}catch{throw new Error('INVALID_INPUT');}
    if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('INVALID_INPUT');
    const id=await authenticate(input.initData,env.BOT_TOKEN);
    try{const person=JSON.parse(new URLSearchParams(input.initData).get('user'));if(person.id===id)await recordVerifiedUser(env,person);}catch{ /* profile metadata must not block login */ }
    // No request-supplied userId/accountId/chatId is ever used.
    if(url.pathname==='/api/status') return reply(await personalStatus(env,id));
    if(url.pathname==='/api/disconnect') return reply(await disconnectPersonal(env,id));
    if(url.pathname==='/api/contribute') {
      if(input.sharingConsent!==true)throw new Error('SHARING_CONSENT_REQUIRED');
      const lease=await claim(env,id);
      try {
        const row=await rowFor(env,id);
        const data=row?.sealed?await unseal(row.sealed,id,env.VAULT_KEY):null;
        if(!data?.password)throw new Error('PASSWORD_REQUIRED');
        const home=await withRenewal(data,async session=>{
          const response=await universityFetch(upstream,Date.now()+45000)(VC+'/my/index.php',{headers:{Cookie:'MoodleSession='+session}});
          if(!response.ok)throw new Error('UNIVERSITY_UNREACHABLE');
          return dashboard(await response.text());
        },upstream,login);
        if(home.userId!==data.userId)throw new Error('LOGIN_FAILED');
        data.contribute=true;data.consentAt=Date.now();data.courses=home.courses;
        await save(env,id,lease,data);
        await publishSavedEnrollment(env,id,lease,data);
        return reply(summary(data,{state:'connected'}));
      }finally{await release(env,id,lease);}
    }
    if(url.pathname==='/api/refresh') return reply(await refreshPersonal(env,id,{request:upstream,notify:true,login}));
    if(url.pathname!=='/api/connect') return reply({error:'NOT_FOUND'},404);
    return reply(await connectPersonal(env,id,input,{upstream,login}));
  } catch(e) {
    const code=codeOf(e);
    const body={error:code};
    if(code==='BUSY'&&Number.isFinite(e?.retryAfterSeconds))body.retryAfterSeconds=e.retryAfterSeconds;
    return reply(body,code==='UNAUTHORIZED'?401:code==='BUSY'?429:400);
  }
}
// Invoked only through the authenticated Cloudflare service binding, never HTTP.
export async function unifyConnections(env){
  configured(env);
  if(env.UNIFIED_CATALOG!=='1'||!env.SHARED_DB)throw new Error('SERVER_CONFIG');
  const rows=await env.PERSONAL_DB.prepare('SELECT tg_id FROM personal_connections WHERE sealed IS NOT NULL AND contributing=0 LIMIT 20').all();
  let migrated=0,failed=0;
  for(const row of rows.results??[]){
    let lease;
    try{
      lease=await claim(env,row.tg_id);
      const live=await rowFor(env,row.tg_id);
      if(!live?.sealed)continue;
      const data=await unseal(live.sealed,row.tg_id,env.VAULT_KEY);
      data.contribute=true;data.consentAt=Date.now();
      await save(env,row.tg_id,lease,data);
      await publishSavedEnrollment(env,row.tg_id,lease,data);
      migrated++;
    }catch{failed++;}
    finally{if(lease)await release(env,row.tg_id,lease);}
  }
  return {migrated,failed};
}
export async function personalHomework(env,id,refs,{request=fetch,login=universityLogin}={}){
  configured(env);
  if(!Number.isSafeInteger(id)||id<=0||!Array.isArray(refs)||refs.length>100)throw new Error('INVALID_INPUT');
  const row=await rowFor(env,id);if(!row?.sealed)return {available:false,states:{},pending:0};
  let data=await unseal(row.sealed,id,env.VAULT_KEY);data.submissions??={};
  const courses=new Set(data.courses.map(c=>String(c.id))),valid=[];
  const snapshots=await sharedActivities(env,data.courses.filter(c=>refs.some(ref=>String(ref.courseId)===String(c.id))));
  for(const ref of refs){if(!courses.has(String(ref.courseId)))continue;const item=(snapshots[String(ref.courseId)]??[]).find(item=>item.kind==='assign'&&String(item.id)===String(ref.itemId));if(item)valid.push({courseId:String(ref.courseId),itemId:Number(item.id),key:ref.courseId+':'+item.id});}
  const stale=valid.filter(ref=>!data.submissions[ref.key]||Date.now()-data.submissions[ref.key].at>300000);
  const result=()=>({available:true,states:Object.fromEntries(valid.filter(ref=>data.submissions[ref.key]).map(ref=>[ref.key,data.submissions[ref.key]])),pending:valid.filter(ref=>!data.submissions[ref.key]||Date.now()-data.submissions[ref.key].at>300000).length});
  if(!stale.length)return result();
  let lease;try{lease=await claim(env,id);}catch{return result();}
  try{
    const live=await rowFor(env,id);if(!live?.sealed)return {available:false,states:{},pending:0};
    data=await unseal(live.sealed,id,env.VAULT_KEY);data.submissions??={};
    const limited=universityFetch(request,Date.now()+35000);
    // A bounded refresh; subsequent requests continue from fresh cached states.
    for(const ref of stale.slice(0,20)){
      try{
        const state=await withRenewal(data,async session=>{
          const response=await limited(VC+'/mod/assign/view.php?id='+ref.itemId,{headers:{Cookie:'MoodleSession='+session}});
          if(!response.ok)throw new Error('UNIVERSITY_UNREACHABLE');
          const html=await response.text();if(/id=["'](?:page-login-index|loginbtn)/.test(html))throw new Error('LOGIN_REQUIRED');
          return submissionState(html);
        },request,login);
        data.submissions[ref.key]={...state,at:Date.now()};
      }catch{break;}
    }
    // Remove cache entries for courses no longer enrolled; keep state encrypted.
    for(const key of Object.keys(data.submissions))if(!courses.has(key.split(':')[0]))delete data.submissions[key];
    await save(env,id,lease,data);
    if(data.contribute)await publishSavedEnrollment(env,id,lease,data);
    return result();
  }finally{await release(env,id,lease);}
}
export default {
  fetch:handleRequest,
  async queue(batch,env) {
    configured(env);
    for(const job of batch.messages) {
      try {
        const id=job.body?.id;
        if(!Number.isSafeInteger(id)||id<=0){job.ack();continue;}
        const row=await rowFor(env,id);
        if(!row?.sealed){job.ack();continue;}
        await refreshPersonal(env,id,{notify:true});job.ack();
      } catch(e) {if(['LOGIN_REQUIRED','LOGIN_FAILED','NOT_CONNECTED'].includes(e.message))job.ack();else job.retry({delaySeconds:300});}
    }
  },
  async scheduled(_event,env) {
    configured(env);
    if(!env.PERSONAL_JOBS)throw new Error('SERVER_CONFIG');
    const now=Date.now(),day=new Date().toISOString().slice(0,10);
    const budget=await env.PERSONAL_DB.prepare('SELECT used FROM personal_dispatch_budget WHERE day=?').bind(day).first();
    const available=Math.max(0,1000-Number(budget?.used??0));if(!available)return;
    const auth=env.SHARED_DB?await env.SHARED_DB.prepare("SELECT owner_id FROM accounts WHERE id LIKE 'personal_%' AND enabled=1 AND json_extract(health,'$.state')='auth'").all():{results:[]};
    const expired=[...new Set((auth.results??[]).map(row=>row.owner_id))].slice(0,90);
    const params=[now-15*60000,now];
    let condition='next_refresh_at<=?';
    if(expired.length){condition+=' OR (tg_id IN ('+expired.map(()=>'?').join(',')+') AND last_attempt_at<?)';params.push(...expired,now-15*60000);}
    const rows=await env.PERSONAL_DB.prepare("SELECT tg_id FROM personal_connections WHERE sealed IS NOT NULL AND state<>'needs_login' AND queued_at<? AND ("+condition+") ORDER BY next_refresh_at ASC LIMIT 100").bind(...params).all();
    const queued=[];
    const ids=(rows.results??[]).slice(0,available).map(row=>row.tg_id);
    for(let offset=0;offset<ids.length;offset+=40) {
      const chunk=ids.slice(offset,offset+40);
      const claimed=await env.PERSONAL_DB.prepare('UPDATE personal_connections SET queued_at=? WHERE tg_id IN ('+chunk.map(()=>'?').join(',')+') AND queued_at<? RETURNING tg_id').bind(now,...chunk,now-15*60000).all();
      queued.push(...(claimed.results??[]).map(row=>row.tg_id));
    }
    if(queued.length)try{
      const reserved=await env.PERSONAL_DB.prepare('INSERT INTO personal_dispatch_budget(day,used) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=1000 RETURNING used').bind(day,queued.length).first();
      if(!reserved)throw new Error('QUEUE_DAILY_LIMIT');
      await env.PERSONAL_JOBS.sendBatch(queued.map(id=>({body:{id}})));}catch{
      for(let offset=0;offset<queued.length;offset+=40){const chunk=queued.slice(offset,offset+40);await env.PERSONAL_DB.prepare('UPDATE personal_connections SET queued_at=0 WHERE tg_id IN ('+chunk.map(()=>'?').join(',')+') AND queued_at=?').bind(...chunk,now).run();}
    }
  },
};

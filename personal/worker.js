import { authenticate, seal, unseal, validateVaultKey } from './security.js';
import { credentialInput, universityLogin, dashboard, VC } from './login.js';
import { connector } from '../tgcloud/lib/moodle.js';
import { signature, notification } from '../tgcloud/lib/content.js';

const SAFE_CODES = new Set(['INVALID_INPUT','UNAUTHORIZED','LOGIN_FAILED','LOGIN_REQUIRED','LOGIN_INTERACTION_REQUIRED','LOGIN_FLOW_UNSUPPORTED','SESSION_UNAVAILABLE','UNIVERSITY_UNREACHABLE','UNIVERSITY_RATE_LIMIT','DASHBOARD_LAYOUT','BUSY','RETRY_LATER','NOT_CONNECTED','SERVER_CONFIG','VAULT_ERROR']);
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
  if(!row) throw new Error('BUSY');
  return {until,token};
}
async function save(env,id,lease,data,state='connected',error=null) {
  const encrypted=await seal(data,id,env.VAULT_KEY);
  const result=await env.PERSONAL_DB.prepare('UPDATE personal_connections SET sealed=?,state=?,last_error=?,updated_at=? WHERE tg_id=? AND lease_token=? AND lease_until>?').bind(encrypted,state,error,Date.now(),id,lease.token,Date.now()).run();
  if(!result.meta?.changes) throw new Error('BUSY');
}
async function release(env,id,lease) { await env.PERSONAL_DB.prepare('UPDATE personal_connections SET lease_until=0,lease_token=NULL WHERE tg_id=? AND lease_token=?').bind(id,lease.token).run(); }
function summary(data,row) {
  return {connected:!!data, state:row?.state??'disconnected', error:row?.last_error??null,
    remember:!!data?.password, lastSuccessAt:data?.lastSuccessAt??null,lastRenewedAt:data?.lastRenewedAt??null,
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
          if(old===signature(item)) continue;
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
    // No request-supplied userId/accountId/chatId is ever used.
    if(url.pathname==='/api/status') {
      const row=await rowFor(env,id);
      const data=row?.sealed?await unseal(row.sealed,id,env.VAULT_KEY):null;
      return reply(summary(data,row));
    }
    if(url.pathname==='/api/disconnect') {
      await env.PERSONAL_DB.prepare('DELETE FROM personal_connections WHERE tg_id=?').bind(id).run();
      return reply({disconnected:true});
    }
    if(url.pathname==='/api/refresh') return reply(await refreshPersonal(env,id,{request:upstream,notify:true,login}));
    if(url.pathname!=='/api/connect') return reply({error:'NOT_FOUND'},404);
    const credentials=credentialInput(input);
    const lease=await claim(env,id);
    try {
      const result=await login(credentials.username,credentials.password,upstream);
      const data={username:credentials.username,password:credentials.remember?credentials.password:null,
        session:result.session,userId:result.userId,courses:result.courses,snapshots:{},receipts:{},lastSuccessAt:null,lastRenewedAt:new Date().toISOString()};
      await save(env,id,lease,data);
      return reply(summary(data,{state:'connected'}));
    } finally { await release(env,id,lease); }
  } catch(e) {const code=codeOf(e);return reply({error:code},code==='UNAUTHORIZED'?401:code==='BUSY'?429:400);}
}
export default {
  fetch:handleRequest,
  async scheduled(_event,env) {
    configured(env);
    const rows=await env.PERSONAL_DB.prepare("SELECT tg_id FROM personal_connections WHERE sealed IS NOT NULL AND state <> 'needs_login' ORDER BY updated_at ASC LIMIT 20").all();
    for(const row of rows.results??[]) {
      try{await refreshPersonal(env,row.tg_id,{notify:true});}catch{/* Codes stay in the user's row; no credentials or remote bodies are logged. */}
    }
  },
};

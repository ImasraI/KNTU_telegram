import {chat,callModel} from './ai.js';
import {calendar} from './calendar.js';
import {setClassTime} from './class-time.js';
import {samadMenu} from './samad.js';
// Only the bot backend holds the bearer credential. No public SQL/CORS access.
// Personal-service codes that may cross this gateway: everything else collapses
// to PERSONAL_UNAVAILABLE, so an unexpected failure never leaks internals.
const PERSONAL_CODES=new Set(['INVALID_INPUT','LOGIN_FAILED','LOGIN_REQUIRED','LOGIN_INTERACTION_REQUIRED','LOGIN_FLOW_UNSUPPORTED','SESSION_UNAVAILABLE','UNIVERSITY_UNREACHABLE','UNIVERSITY_RATE_LIMIT','DASHBOARD_LAYOUT','BUSY','NOT_CONNECTED','SERVER_CONFIG','VAULT_ERROR','SHARING_CONSENT_REQUIRED','PASSWORD_REQUIRED']);
export async function handleQuery(request, env) {
  const path=new URL(request.url).pathname;
  if (!['/query','/chat','/ai-status','/personal-homework','/personal-status','/personal-connect','/personal-disconnect','/calendar','/class-time','/samad'].includes(path) || request.method !== 'POST') return new Response('Not found',{status:404});
  const supplied=request.headers.get('Authorization') ?? '', expected='Bearer '+(env.DATABASE_KEY ?? '');
  let diff=supplied.length ^ expected.length;
  for(let i=0;i<expected.length;i++) diff |= (supplied.charCodeAt(i)||0)^expected.charCodeAt(i);
  if(!env.DATABASE_KEY || diff) return new Response('Unauthorized',{status:401});
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
  try {
    if(Number(request.headers.get('Content-Length')||0)>2000000) return new Response('Too large',{status:413});
    const body=await request.text();if(body.length>2000000)return new Response('Too large',{status:413});
    const query=JSON.parse(body);
    if(path==='/samad'){
      try{return Response.json(await samadMenu(env,query),{headers});}
      catch(error){return Response.json({error:['SAMAD_NOT_CONFIGURED','SAMAD_AUTH_FAILED','SAMAD_UNKNOWN_HALL','SAMAD_LAYOUT_CHANGED'].includes(error.message)?error.message:'SAMAD_UNAVAILABLE',...(query.action==='diagnose'?{stage:error.stage??null,status:error.status??null,reason:error.reason??error.networkError??null,layout:error.layout??null}:{})},{status:503,headers});}
    }
    if(path==='/class-time'){
      if(env.MAINTENANCE_MODE==='1')return Response.json({error:'UNAVAILABLE'},{status:503,headers});
      try{return Response.json(await setClassTime(env.SHARED_DB,query.input??{},query.userId),{headers});}
      catch(error){return Response.json({error:['NO_USER','UNKNOWN_COURSE','INVALID_TIME','TIME_LOCKED'].includes(error.code)?error.code:'UNAVAILABLE'},{headers});}
    }
    if(path==='/calendar'){
      if(env.MAINTENANCE_MODE==='1')return Response.json({error:'UNAVAILABLE'},{status:503,headers});
      const maintenance=await env.SHARED_DB.prepare("SELECT value FROM settings WHERE key='calendar:maintenance'").first();
      if(maintenance?.value==='true')return Response.json({error:'UNAVAILABLE'},{status:503,headers});
      try{return Response.json(await calendar(env.SHARED_DB,query.input??{},query.userId),{headers});}
      catch(error){return Response.json({error:['NO_USER','INVALID_WEEK','INVALID_NAME','INVALID_STUDENT_NUMBER','INVALID_SLOTS','PAST_SLOT','BOOKING_CONFLICT_OR_LIMIT','NOT_YOUR_BOOKING','INVALID_ACTION','STALE_BOOKING'].includes(error.code)?error.code:'UNAVAILABLE'},{headers});}
    }
    if(path==='/personal-homework')return Response.json(await env.PERSONAL_ADMIN.homework(query.userId,query.refs),{headers});
    if(path==='/personal-status'||path==='/personal-connect'||path==='/personal-disconnect'){
      try{
        if(path==='/personal-status')return Response.json(await env.PERSONAL_ADMIN.status(query.userId),{headers});
        if(path==='/personal-disconnect')return Response.json(await env.PERSONAL_ADMIN.disconnect(query.userId),{headers});
        return Response.json(await env.PERSONAL_ADMIN.connect(query.userId,query.input??{}),{headers});
      }catch(error){
        const code=PERSONAL_CODES.has(error?.message)?error.message:'PERSONAL_UNAVAILABLE';
        return Response.json({error:code},{status:code==='BUSY'?429:code==='PERSONAL_UNAVAILABLE'?503:400,headers});
      }
    }
    if(path==='/ai-status'){
      if(query.unify)return Response.json(await env.PERSONAL_ADMIN.unify(),{headers});
      if(!env.GROQ_API_KEY)return Response.json({configured:false},{headers});
      if(query.probe){
        if(!/^gsk_[A-Za-z0-9]{20,}$/.test(env.GROQ_API_KEY))return Response.json({configured:true,replyReceived:false,error:'AI_KEY_FORMAT_INVALID'},{headers});
        const row=await env.SHARED_DB.prepare("SELECT value FROM settings WHERE key='ai:config'").first();
        const config=row?JSON.parse(row.value):{};
        try {
          const answer=await callModel(env,[{role:'system',content:'Reply briefly in Persian.'},{role:'user',content:'سلام'}],config);
          return Response.json({configured:true,provider:config.provider,model:config.model,replyReceived:!!answer.trim()},{headers});
        }catch(error){return Response.json({configured:true,replyReceived:false,error:['AI_PROVIDER_ERROR','AI_RATE_LIMIT','AI_NOT_CONFIGURED','AI_AUTH_FAILED','AI_MODEL_UNAVAILABLE','AI_REQUEST_REJECTED'].includes(error.message)?error.message:'AI_TIMEOUT_OR_NETWORK'},{headers});}
      }
      const res=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+env.GROQ_API_KEY},signal:AbortSignal.timeout(15000)});
      if(!res.ok)throw new Error('AI_PROVIDER_ERROR');
      const models=await res.json();return Response.json({configured:true,models:(models.data??[]).map(model=>model.id)},{headers});
    }
    if(path==='/chat'){
      if(env.MAINTENANCE_MODE==='1')return Response.json({text:'سرویس در حال نگهداری است.'},{headers});
      try{return Response.json(await chat(env,query),{headers});}
      catch(e){const texts={AI_RATE_LIMIT:'سهمیهٔ گفت‌وگو پر شده؛ بعداً دوباره تلاش کنید.',AI_NOT_CONFIGURED:'مدیر هنوز مدل گفت‌وگو را تنظیم نکرده است.',AI_CONSENT_REQUIRED:'ابتدا در پیوی /chaton را بزنید.'};return Response.json({text:texts[e.message]??'مدل فعلاً پاسخ نمی‌دهد؛ کمی بعد تلاش کنید.'},{headers});}
    }
    if(typeof query.text!=='string'||query.text.length>100000||!Array.isArray(query.params)||query.params.length>100||query.params.some(value=>value!==null&&!['number','string'].includes(typeof value))) throw new Error('Invalid query');
    if(!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(query.text)||/[;]|--|\/\*/.test(query.text)) throw new Error('Invalid operation');
    if(env.MAINTENANCE_MODE === '1' && !/^\s*SELECT\b/i.test(query.text)) return Response.json({error:'DATABASE_MAINTENANCE'},{status:503,headers});
    const result=await env.SHARED_DB.prepare(query.text).bind(...query.params).all();
    return Response.json({rows:result.results??[],changes:result.meta?.changes??0},{headers});
  } catch { return Response.json({error:'DATABASE_QUERY_FAILED'},{status:503,headers}); }
}
export default {fetch:handleQuery,async scheduled(_event,env){
  const now=Date.now();
  for(const [table,column]of [['ai_threads','expires'],['ai_usage','expires'],['ai_requests','expires']])await env.SHARED_DB.prepare('DELETE FROM '+table+' WHERE '+column+'<?').bind(now).run();
}};

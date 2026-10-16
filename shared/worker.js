// Only the bot backend holds the bearer credential. No public SQL/CORS access.
export async function handleQuery(request, env) {
  if (new URL(request.url).pathname !== '/query' || request.method !== 'POST') return new Response('Not found',{status:404});
  const supplied=request.headers.get('Authorization') ?? '', expected='Bearer '+(env.DATABASE_KEY ?? '');
  let diff=supplied.length ^ expected.length;
  for(let i=0;i<expected.length;i++) diff |= (supplied.charCodeAt(i)||0)^expected.charCodeAt(i);
  if(!env.DATABASE_KEY || diff) return new Response('Unauthorized',{status:401});
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
  try {
    if(Number(request.headers.get('Content-Length')||0)>2000000) return new Response('Too large',{status:413});
    const body=await request.text();if(body.length>2000000)return new Response('Too large',{status:413});
    const query=JSON.parse(body);
    if(typeof query.text!=='string'||query.text.length>100000||!Array.isArray(query.params)||query.params.length>100||query.params.some(value=>value!==null&&!['number','string'].includes(typeof value))) throw new Error('Invalid query');
    if(!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(query.text)||/[;]|--|\/\*/.test(query.text)) throw new Error('Invalid operation');
    if(env.MAINTENANCE_MODE === '1' && !/^\s*SELECT\b/i.test(query.text)) return Response.json({error:'DATABASE_MAINTENANCE'},{status:503,headers});
    const result=await env.SHARED_DB.prepare(query.text).bind(...query.params).all();
    return Response.json({rows:result.results??[],changes:result.meta?.changes??0},{headers});
  } catch { return Response.json({error:'DATABASE_QUERY_FAILED'},{status:503,headers}); }
}
export default {fetch:handleQuery};

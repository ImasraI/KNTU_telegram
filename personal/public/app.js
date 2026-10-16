const app=window.Telegram?.WebApp;
app?.ready(); app?.expand();
const $=id=>document.getElementById(id);
const errors={UNAUTHORIZED:'فرم را ببندید و با /personal در پیوی ربات دوباره باز کنید.',LOGIN_FAILED:'ورود موفق نشد؛ نام کاربری و رمز حساب دانشگاهی را بررسی کنید.',LOGIN_REQUIRED:'نشست منقضی شده؛ دوباره وارد شوید.',LOGIN_INTERACTION_REQUIRED:'سامانه دانشگاه مرحله ورود دیگری می‌خواهد؛ ورود خودکار ادامه پیدا نکرد.',LOGIN_FLOW_UNSUPPORTED:'ساختار ورود دانشگاه پشتیبانی نشد. رمز به مقصد ناشناخته ارسال نمی‌شود.',BUSY:'یک درخواست در حال اجراست یا هنوز یک دقیقه از تلاش قبلی نگذشته؛ کمی بعد امتحان کنید.',NOT_CONNECTED:'ابتدا حساب را متصل کنید.',UNIVERSITY_UNREACHABLE:'سامانه دانشگاه پاسخ نداد؛ بعداً دوباره تلاش کنید.',SERVER_CONFIG:'تنظیمات سرویس شخصی کامل نیست؛ به مدیر اطلاع بدهید.',REQUEST_FAILED:'درخواست کامل نشد؛ دوباره تلاش کنید.',INVALID_INPUT:'نام کاربری و رمز را بررسی کنید.',DASHBOARD_LAYOUT:'ساختار داشبورد دانشگاه تغییر کرده و نیاز به بررسی دارد.'};
async function call(action,input={}){
  if(!app?.initData)throw new Error('UNAUTHORIZED');
  const res=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,initData:app.initData})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'REQUEST_FAILED');return data;
}
function render(data){
  $('status').textContent=data.connected?`اتصال: ${data.state==='connected'?'برقرار':data.state==='needs_login'?'نیازمند ورود دوباره':'خطا'} | تمدید خودکار: ${data.remember?'فعال':'غیرفعال'} | آخرین همگام‌سازی موفق: ${data.lastSuccessAt?new Date(data.lastSuccessAt).toLocaleString('fa-IR'):'هنوز انجام نشده'}${data.error?' | '+(errors[data.error]||'درخواست کامل نشد'):''}`:'اتصال شخصی ندارید.';
  $('courses').replaceChildren();for(const course of data.courses??[]){const li=document.createElement('li');li.textContent=course.name;$('courses').append(li);}
  $('items').replaceChildren();for(const item of data.items??[]){const li=document.createElement('li');li.textContent=`${item.name}${item.dates?' — '+item.dates:''}`;if(item.url?.startsWith('https://vc.kntu.ac.ir/')){const a=document.createElement('a');a.href=item.url;a.textContent=' بازکردن در VC';a.target='_blank';a.rel='noopener noreferrer';li.append(a);}$('items').append(li);}
  $('refresh').disabled=!data.connected;$('disconnect').disabled=!data.connected;
}
async function run(fn){const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('message').textContent='در حال انجام…';try{await fn();$('message').textContent='انجام شد.';}catch(e){$('message').textContent=errors[e.message]||'درخواست انجام نشد.';}finally{buttons.forEach(b=>b.disabled=false);}}
$('connect').addEventListener('submit',event=>{event.preventDefault();const input={username:$('username').value,password:$('password').value,remember:$('remember').checked};$('password').value='';run(async()=>render(await call('connect',input)));});
$('refresh').onclick=()=>run(async()=>render(await call('refresh')));
$('reload').onclick=()=>run(async()=>render(await call('status')));
$('disconnect').onclick=()=>{if(window.confirm('اطلاعات ورود و کش شخصی شما حذف شود؟'))run(async()=>{await call('disconnect');$('username').value='';$('password').value='';$('remember').checked=false;render(await call('status'));});};
run(async()=>render(await call('status')));

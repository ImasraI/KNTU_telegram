import { EndpointError,fetch } from 'sdk';
import {DATABASE_KEY} from '../lib/database-secret.js';
import { db, inArray, sql } from '../lib/database.js';
import { snapshots } from '../schema.js';
import { getSetting, putSetting } from '../lib/settings.js';
import { AI_DISCLOSURE, normalizeConfig } from '../lib/ai-policy.js';
import { directorySummary } from '../lib/monitor.js';
import { courseKey } from '../lib/plan.js';
import { CONTACT, FULL_NAME_HINT, FULL_NAME_LABEL, FULL_NAME_PROMPT, PRIVACY, PUBLIC_COMMANDS } from '../lib/student-policy.js';
import { COURSE_SUPPORT, forgetSubscriber, registerStudent, refreshRegistration, resumeStudent, stopStudent, subscriber,recordMiniAppUse } from '../lib/subscriptions.js';
import { FILTERS, PAGE_SIZE, courseCounts, courseView, coverageView, freshness, helpView, itemView, newestRead, pageItems, selectItems, studentState } from '../lib/student-view.js';
import {HOMEWORK_PERIODS,homeworkState,matchesHomework} from '../lib/homework.js';
import {upcomingAgenda} from '../lib/agenda.js';
import {OWNER_ID} from '../lib/config.js';

// The public student Mini App's only endpoint.
//
// It reuses the same services the chat uses (registration, exact participant
// matching, notification controls, the professor/class directory, saved
// baselines), so a student gets the same answer either way. What it adds is
// isolation: every personal action is scoped to `ctx.initData.user.id`, verified
// by the platform, and no input can name another user. A response never carries a
// credential, an account id, a participant roster or the long university code.
const MAX_KEYS_PER_QUERY = 100;
const AI_CONSENT = tgId => 'ai:consent:' + tgId;
const GATEWAY = 'https://kntu-shared-bot.arsamalaei90.workers.dev';

// Where a personal VC connection actually lives. A matched /register name, a
// covered course or a row in the shared catalog are all different facts and none
// of them proves a live personal login, so the personal service is asked directly
// for this caller and its answer is mapped without guessing.
async function gateway(path, body) {
  const response = await fetch(GATEWAY + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DATABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch { /* a non-JSON failure is still a failure */ }
  return { ok: response.ok && !!data && typeof data === 'object', data };
}

const VC_ERRORS = {
  INVALID_INPUT: 'نام کاربری و رمز حساب دانشگاهی را بررسی کنید.',
  LOGIN_FAILED: 'نام کاربری یا رمز حساب VC درست نیست.',
  LOGIN_REQUIRED: 'اتصال شما منقضی شده؛ یک‌بار دیگر وارد شوید.',
  LOGIN_INTERACTION_REQUIRED: 'ورود دانشگاه به یک مرحلهٔ دیگر نیاز دارد؛ دوباره تلاش کنید.',
  LOGIN_FLOW_UNSUPPORTED: 'ساختار ورود دانشگاه تغییر کرده؛ بعداً دوباره تلاش کنید.',
  SESSION_UNAVAILABLE: 'نشست دانشگاه ساخته نشد؛ دوباره تلاش کنید.',
  UNIVERSITY_UNREACHABLE: 'سامانهٔ دانشگاه پاسخ نداد؛ کمی بعد دوباره تلاش کنید.',
  UNIVERSITY_RATE_LIMIT: 'درخواست به دانشگاه زیاد شده؛ چند دقیقه بعد تلاش کنید.',
  DASHBOARD_LAYOUT: 'صفحهٔ دانشگاه قابل خواندن نبود؛ دوباره تلاش کنید.',
  BUSY: 'یک درخواست اتصال در حال اجراست؛ کمی بعد دوباره تلاش کنید.',
  SERVER_CONFIG: 'سرویس اتصال شخصی آماده نیست؛ به پشتیبانی اطلاع بدهید.',
  VAULT_ERROR: 'ذخیرهٔ امن اطلاعات ممکن نشد؛ دوباره تلاش کنید.',
  NOT_CONNECTED: 'ابتدا حساب VC را متصل کنید.',
  PASSWORD_REQUIRED: 'برای تمدید خودکار، یک‌بار دیگر با رمز وارد شوید.',
};

function vcFailure(code) {
  const known = Object.prototype.hasOwnProperty.call(VC_ERRORS, code);
  return new EndpointError(known ? VC_ERRORS[code] : 'اتصال به حساب VC انجام نشد؛ دوباره تلاش کنید.', { code: 'VC_' + (known ? code : 'UNAVAILABLE') });
}

// Five states, and no invented sixth: a failed status request stays `unknown` so
// the client can say "بررسی اتصال انجام نشد" instead of claiming a connection.
async function vcStatus(callerId) {
  const empty = { state: 'unknown', error: 'NO_USER', lastSuccessAt: null, lastRenewedAt: null, remember: false, courseCount: null };
  if (!callerId) return empty;
  const unavailable = { ...empty, error: 'STATUS_UNAVAILABLE' };
  try {
    const { ok, data } = await gateway('/personal-status', { userId: callerId });
    if (!ok) return unavailable;
    if (!data.connected) return { ...empty, state: 'disconnected', error: null };
    const state = data.state === 'needs_login' ? 'expired' : data.state === 'connected' ? 'connected' : 'error';
    return {
      state,
      error: typeof data.error === 'string' ? data.error : null,
      lastSuccessAt: typeof data.lastSuccessAt === 'string' ? data.lastSuccessAt : null,
      lastRenewedAt: typeof data.lastRenewedAt === 'string' ? data.lastRenewedAt : null,
      remember: !!data.remember,
      courseCount: Array.isArray(data.courses) ? data.courses.length : null,
    };
  } catch { return unavailable; }
}

// The optional smart chat, described in the caller's own terms. `enabled` is this
// caller's consent; `available` is the owner's global switch. Neither value says
// anything about another subscriber.
async function aiFacts(callerId) {
  const config = normalizeConfig(await getSetting('ai:config'));
  return {
    available: config.enabled,
    enabled: callerId ? !!(await getSetting(AI_CONSENT(callerId))) : false,
    disclosure: AI_DISCLOSURE,
  };
}

function policyView() {
  return {
    fullNameLabel: FULL_NAME_LABEL, fullNamePrompt: FULL_NAME_PROMPT, fullNameHint: FULL_NAME_HINT,
    support: COURSE_SUPPORT, contact: CONTACT,
  };
}

function requireCaller(callerId) {
  if (!callerId) throw new EndpointError('این بخش به حساب تلگرام شما نیاز دارد؛ صفحه را از دکمهٔ ربات باز کنید.', { code: 'NO_USER' });
  return callerId;
}

function keysFor(course) {
  // The canonical `origin#id` key, plus the plain-id key the single-account era
  // wrote, so the nine original baselines keep counting.
  return [courseKey(course), String(course.id)];
}

// One query for the whole course list instead of two per course.
async function snapshotRows(keys) {
  const unique = [...new Set(keys)];
  const rows = [];
  for (let i = 0; i < unique.length; i += MAX_KEYS_PER_QUERY) {
    const slice = unique.slice(i, i + MAX_KEYS_PER_QUERY);
    if (!slice.length) continue;
    rows.push(...await db.select().from(snapshots).where(inArray(snapshots.key, slice)).all());
  }
  return rows;
}

function snapshotCache(rows) {
  return new Map(rows.map(row => [row.key, row]));
}

function rowFor(cache, course) {
  return cache.get(courseKey(course)) ?? cache.get(String(course.id)) ?? null;
}

// `list` is the course list already loaded by the caller: its per-course `scan`
// times are the newest information a student is looking at, which is what the
// header badge must follow.
async function coverage(now, list = []) {
  const status = await getSetting('status');
  const courses = (await getSetting('courses')) ?? [];
  return coverageView(status, courses.length, now, newestRead(list));
}

// Public browsing: every covered course with its class line and activity counts.
async function courses(now) {
  const summary = await directorySummary();
  const cache = snapshotCache(await snapshotRows(summary.courses.flatMap(keysFor)));
  return summary.courses.map(entry => {
    const row = rowFor(cache, entry);
    const items = Array.isArray(row?.value) ? row.value : [];
    return courseView(entry, { counts: courseCounts(items), scan: freshness(row?.updatedAt ?? null, now) });
  });
}

async function payload(callerId, now) {
  const list = await courses(now);
  const ai = await aiFacts(callerId);
  const row=callerId?await subscriber(callerId):null,vc=await vcStatus(callerId);
  const me={...studentState(row),aiChat:ai.enabled,owner:callerId===OWNER_ID,vc,personalConnected:vc.state==='connected'};
  me.name=me.name||row?.profile?.usage?.name||null;
  const own=list.filter(course=>me.courses.includes(String(course.id))),cache=snapshotCache(await snapshotRows(own.flatMap(keysFor)));
  const agenda=upcomingAgenda(list,cache,me.courses,now);
  return {
    coverage: await coverage(now, list),
    courses: list,
    me,
    agenda,
    ai,
    policy: policyView(),
  };
}

export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id ?? null;
  const action = String(input?.action ?? 'home');
  const now = Date.now();
  if(callerId)try{await recordMiniAppUse(ctx.initData.user);}catch{ /* metadata must not block the Mini App */ }

  if (action === 'help') {
    return helpView({
      commands: PUBLIC_COMMANDS, privacy: PRIVACY, support: COURSE_SUPPORT, contact: CONTACT,
      label: FULL_NAME_LABEL, prompt: FULL_NAME_PROMPT, hint: FULL_NAME_HINT,
    });
  }
  if (action === 'home' || action === 'courses') return await payload(callerId, now);

  if (action === 'course') {
    const id = Number(input?.courseId);
    const list = await courses(now);
    const course = list.find(entry => entry.id === id);
    if (!course) throw new EndpointError('این درس تحت پوشش ربات نیست.', { code: 'UNKNOWN_COURSE' });
    const row = rowFor(snapshotCache(await snapshotRows(keysFor(course))), course);
    return {
      course,
      items: pageItems(selectItems(row?.value, input?.filter), input?.offset),
      scan: freshness(row?.updatedAt ?? null, now),
      coverage: await coverage(now, list),
      policy: policyView(),
    };
  }

  // One list of everything, across every covered course or across the caller's
  // own courses, so a deadline can be found without opening course by course.
  if (action === 'feed') {
    const wantedFilter=FILTERS.includes(input?.filter)?input.filter:'assign';
    const list = await courses(now);
    const ai = await aiFacts(callerId);
    const vc = await vcStatus(callerId);
    const me = { ...studentState(callerId ? await subscriber(callerId) : null), aiChat: ai.enabled, vc, personalConnected: vc.state === 'connected' };
    const requestedScope=input?.scope==='all'?'all':'mine';
    // Never silently replace a personal view with everybody's assignments.
    const scope=requestedScope;
    const period=HOMEWORK_PERIODS.includes(input?.period)?input.period:'upcoming';
    const selected = scope === 'mine' ? list.filter(entry => me.courses.includes(String(entry.id))) : list;
    const cache = snapshotCache(await snapshotRows(selected.flatMap(keysFor)));
    const entries = [];
    for (const course of selected) {
      const row = rowFor(cache, course);
      for (const item of selectItems(row?.value,wantedFilter)) {
        const tracking=homeworkState(item,null,now);
        if(item.kind==='assign'&&!['past_done','past_undone'].includes(period)&&!matchesHomework(tracking,period))continue;
        if(item.kind==='assign'&&['past_done','past_undone'].includes(period)&&tracking.period!=='past')continue;
        entries.push({
          ...itemView(item, 'short'),
          ...(item.kind==='assign'?tracking:{}),
          courseId: course.id, courseName: course.name,
          classLabel: course.classLabel, professor: course.professor,
        });
      }
    }
    let personal={available:false,states:{},pending:0,error:false};
    const refs=entries.filter(item=>item.kind==='assign'&&me.courses.includes(String(item.courseId))).slice(0,100).map(item=>({courseId:item.courseId,itemId:item.id}));
    if(callerId)try{
      const response=await fetch('https://kntu-shared-bot.arsamalaei90.workers.dev/personal-homework',{method:'POST',headers:{Authorization:'Bearer '+DATABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({userId:callerId,refs})});
      if(response.ok)personal=await response.json();else personal.error=true;
    }catch{personal.error=true;}
    for(const item of entries)if(item.kind==='assign'){
      const state=personal.states?.[item.courseId+':'+item.id];
      item.done=typeof state?.done==='boolean'?state.done:null;
      item.submissionStatus=state?.status??'unknown';item.submissionCheckedAt=state?.at?new Date(state.at).toISOString():null;
    }
    const filtered=entries.filter(item=>item.kind!=='assign'||matchesHomework(item,period));
    if(wantedFilter==='assign')filtered.sort((a,b)=>{
      const left=a.dueAt?Date.parse(a.dueAt):Infinity,right=b.dueAt?Date.parse(b.dueAt):Infinity;
      if(left===Infinity||right===Infinity)return left===right?0:left===Infinity?1:-1;
      return period.startsWith('past')?right-left:left-right;
    });
    const start = Math.max(0, Number(input?.offset) || 0);
    const status = await getSetting('status');
    return {
      scan: freshness(status?.checkedAt ?? null, now),
      scope,
      scoped: scope === 'mine',
      requestedScope,period,periods:HOMEWORK_PERIODS.filter(p=>personal.available||!['past_done','past_undone'].includes(p)),completionSource:'vc',needsRegistration:scope==='mine'&&!me.registered,
      submissionAvailable:personal.available,submissionPending:personal.pending,submissionError:!!personal.error,
      filter:wantedFilter,
      items: filtered.slice(start, start + PAGE_SIZE),
      total: filtered.length, offset: start, hasMore: start + PAGE_SIZE < filtered.length,
      courses: selected.length,
      coverage: coverageView(status, list.length, now, newestRead(selected)),
      me,
      ai,
      policy: policyView(),
    };
  }

  // Everything below is the caller's own data; a caller-supplied id is ignored.
  const caller = requireCaller(callerId);
  // Connecting is a credential exchange with the personal service; nothing here
  // stores, logs, echoes or forwards the password anywhere else.
  if(action==='vcConnect'){
    const username=typeof input?.username==='string'?input.username.trim():'';
    const password=typeof input?.password==='string'?input.password:'';
    const control = [...username].some(ch => ch.codePointAt(0) < 32);
    if(!username||username.length>150||control||!password||password.length>512||password.includes(String.fromCharCode(0))){
      throw new EndpointError('نام کاربری و رمز حساب دانشگاهی را کامل و درست وارد کنید.',{code:'VC_INPUT'});
    }
    const { ok, data } = await gateway('/personal-connect', { userId: caller, input: { username, password, remember: true } });
    if (!ok) throw vcFailure(data?.error);
    return { ...await payload(caller, Date.now()), result: { vc: 'connected' } };
  }
  if(action==='vcDisconnect'){
    const { ok, data } = await gateway('/personal-disconnect', { userId: caller });
    if (!ok) throw vcFailure(data?.error);
    return { ...await payload(caller, Date.now()), result: { vc: 'disconnected' } };
  }
  if(action==='setClassTime'){
    const response=await fetch('https://kntu-shared-bot.arsamalaei90.workers.dev/class-time',{method:'POST',headers:{Authorization:'Bearer '+DATABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({userId:caller,input:{courseId:Number(input.courseId),time:input.time}})});
    if(!response.ok)throw new EndpointError('ثبت زمان انجام نشد دوباره تلاش کنید',{code:'TIME_UNAVAILABLE'});
    const result=await response.json();
    if(result.error)throw new EndpointError(({TIME_LOCKED:'زمان این درس قبلاً ثبت شده و فقط مدیر می‌تواند تغییرش بدهد',INVALID_TIME:'روز و ساعت معتبر وارد کنید',UNKNOWN_COURSE:'درس پیدا نشد'})[result.error]??'ثبت زمان انجام نشد',{code:result.error});
    return {...await payload(caller,now),result:{timeSaved:true}};
  }

  if(action==='setHomeworkDone'){
    throw new EndpointError('وضعیت تحویل فقط از VC خوانده می‌شود؛ تغییر دستی وجود ندارد.',{code:'VC_SUBMISSION_ONLY'});
  }

  if (action === 'refreshRegistration') {
    await refreshRegistration(caller);
    return await payload(caller, Date.now());
  }

  if (action === 'register') {
    const result = await registerStudent(caller, input?.name);
    if (result.state === 'name-invalid') throw new EndpointError(FULL_NAME_PROMPT, { code: 'NAME_INVALID' });
    if (result.state === 'cooldown') throw new EndpointError('برای جست‌وجوی بعدی یک دقیقه صبر کنید.', { code: 'COOLDOWN' });
    if (result.state === 'busy') throw new EndpointError('جست‌وجو اکنون ممکن نیست یا جست‌وجوی دیگری در حال اجراست؛ یک دقیقه بعد دوباره تلاش کنید.', { code: 'LOOKUP_BUSY' });
    if (result.state === 'gone') throw new EndpointError('اطلاعات شما حذف شده است؛ دوباره ثبت‌نام کنید.', { code: 'DELETED' });
    return {
      ...await payload(caller, now),
      result: {
        queued: result.state === 'queued',
        registered: true,
        courses: result.found.courses.map(Number),
        ambiguous: !!result.found.ambiguous,
        incomplete: !!result.found.incomplete,
      },
    };
  }
  if (action === 'stop') {
    await stopStudent(caller);
    return { ...await payload(caller, now), result: { notifications: 'paused' } };
  }
  if (action === 'resume') {
    const resumed = await resumeStudent(caller);
    if (resumed.state === 'not-registered') throw new EndpointError('ابتدا ثبت‌نام کنید تا اعلان شخصی فعال شود.', { code: 'NOT_REGISTERED' });
    return { ...await payload(caller, now), result: { notifications: 'on', state: resumed.state } };
  }
  // Delete the short conversation memory without changing consent.
  if (action === 'aiClear') {
    const ai = await aiFacts(caller);
    let memoryCleared = false;
    try {
      await db.run(sql`DELETE FROM ai_threads WHERE scope = ${'u:' + caller}`);
      memoryCleared = true;
    } catch { /* conversation store not provisioned yet */ }
    return { ...await payload(caller, now), result: { aiChat: ai.enabled, memoryCleared } };
  }

  // The optional smart chat. Consent is per caller; turning it off also asks the
  // shared conversation store to drop this user's short memory. If that store is
  // not provisioned yet, consent still turns off and the result says so instead
  // of pretending a deletion happened.
  if (action === 'aiOn' || action === 'aiOff') {
    const enabled = action === 'aiOn';
    if (enabled && !(await aiFacts(caller)).available) {
      throw new EndpointError('گفت‌وگوی هوشمند فعلاً در دسترس نیست.', { code: 'AI_UNAVAILABLE' });
    }
    await putSetting(AI_CONSENT(caller), enabled);
    let memoryCleared = false;
    if (!enabled) {
      try {
        await db.run(sql`DELETE FROM ai_threads WHERE scope = ${'u:' + caller}`);
        memoryCleared = true;
      } catch { /* conversation store not provisioned yet; consent is still off */ }
    }
    return { ...await payload(caller, now), result: { aiChat: enabled, memoryCleared } };
  }
  if (action === 'forget') {
    // Personal-data deletion: the subscription row (Telegram id, displayed name,
    // participant id, course list and send receipts) is removed. A cooperation
    // connection contributed separately is managed on its own form and stays.
    await forgetSubscriber(caller);
    return { ...await payload(caller, now), result: { deleted: true } };
  }
  throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
}

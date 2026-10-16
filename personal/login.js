// Public login flow inspected on 2026-10-16. Never reuse a supplied OAuth URL.
import { tree, nodes, nodeText } from '../tgcloud/lib/content.js';
export const VC = 'https://vc.kntu.ac.ir';
const SSO = 'https://sso.kntu.ac.ir';
const allowed = new Set([VC, SSO]);
const fail = code => { throw new Error(code); };
export function credentialInput(input) {
  if (typeof input.username !== 'string' || !input.username.trim() || input.username.length > 150 || /[\r\n\x00]/.test(input.username)) fail('INVALID_INPUT');
  if (typeof input.password !== 'string' || !input.password || input.password.length > 512 || /[\x00]/.test(input.password)) fail('INVALID_INPUT');
  if (typeof input.remember !== 'boolean') fail('INVALID_INPUT');
  return { username: input.username.trim(), password: input.password, remember: input.remember };
}
export function sessionClient(request = fetch) {
  const jars = new Map();
  return {
    cookie() { return jars.get(VC)?.get('MoodleSession') ?? null; },
    async page(input, options = {}) {
      let url = new URL(input, VC), method = options.method ?? 'GET', body = options.body;
      const began = Date.now();
      for (let hop = 0; hop < 12; hop++) {
        if (!allowed.has(url.origin) || url.username || url.password || Date.now() - began > 55000) fail('LOGIN_FLOW_UNSUPPORTED');
        const jar = jars.get(url.origin) ?? new Map();
        const headers = { ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', Origin: url.origin } : {}) };
        if (jar.size) headers.Cookie = [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
        let res;
        try { res = await request(url.href, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(12000) }); }
        catch { fail('UNIVERSITY_UNREACHABLE'); }
        // A runtime that ignores manual redirect must never silently accept it.
        if (res.url && res.url !== url.href) fail('LOGIN_FLOW_UNSUPPORTED');
        const cookies = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? res.headers.get('set-cookie').split(/,(?=\s*[^;,=\s]+=)/) : []);
        for (const cookie of cookies) {
          const match = cookie.match(/^\s*([\w-]+)=([^;\r\n]*)/);
          if (match) {
            if (/;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(match[1]);
            else jar.set(match[1], match[2]);
          }
        }
        jars.set(url.origin, jar);
        if ([301,302,303,307,308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) fail('LOGIN_FLOW_UNSUPPORTED');
          const next = new URL(location, url);
          if (!allowed.has(next.origin)) fail('LOGIN_FLOW_UNSUPPORTED');
          if (body && [307,308].includes(res.status) && next.origin !== url.origin) fail('LOGIN_FLOW_UNSUPPORTED');
          if (res.status === 303 || ([301,302].includes(res.status) && method === 'POST')) { method = 'GET'; body = undefined; }
          url = next; continue;
        }
        if (!res.ok) fail(res.status === 429 ? 'UNIVERSITY_RATE_LIMIT' : 'UNIVERSITY_UNREACHABLE');
        return { url: url.href, html: await res.text() };
      }
      fail('LOGIN_FLOW_UNSUPPORTED');
    },
  };
}
export function dashboard(html) {
  const userId = Number(html.match(/["']userId["']\s*:\s*(\d+)/)?.[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0 || /id=["']page-login-index/.test(html)) fail('LOGIN_REQUIRED');
  const doc = tree(html);
  const select = nodes(doc, n => n.tag === 'select' && /^calendar-course-filter-/.test(n.attrs.id ?? ''))[0];
  if (!select) fail('DASHBOARD_LAYOUT');
  const courses = nodes(select, n => n.tag === 'option' && Number(n.attrs.value) > 1)
    .map(n => ({ id: Number(n.attrs.value), fullname: nodeText(n), origin: VC }));
  return { userId, courses };
}
export async function universityLogin(username, password, request = fetch) {
  credentialInput({ username, password, remember: false });
  const client = sessionClient(request);
  const first = await client.page(VC + '/login/index.php');
  const link = nodes(tree(first.html), n => n.tag === 'a' && /\/auth\/oauth2\/login\.php\?/.test(n.attrs.href ?? ''))[0];
  if (!link) fail('LOGIN_FLOW_UNSUPPORTED');
  const provider = await client.page(new URL(link.attrs.href, VC).href);
  if (new URL(provider.url).origin !== SSO) fail('LOGIN_FLOW_UNSUPPORTED');
  const form = nodes(tree(provider.html), n => n.tag === 'form' && n.attrs.id === 'kc-form-login')[0];
  if (!form) fail('LOGIN_FLOW_UNSUPPORTED');
  const action = new URL(form.attrs.action, provider.url);
  if (action.origin !== SSO || !action.pathname.startsWith('/realms/kntu/login-actions/')) fail('LOGIN_FLOW_UNSUPPORTED');
  const fields = new URLSearchParams();
  for (const field of nodes(form, n => n.tag === 'input' && n.attrs.type === 'hidden' && !!n.attrs.name)) fields.set(field.attrs.name, field.attrs.value ?? '');
  fields.set('username', username); fields.set('password', password); fields.set('credentialId', '');
  const result = await client.page(action.href, { method: 'POST', body: fields.toString() });
  if (new URL(result.url).origin === SSO) fail(/kc-form-login/.test(result.html) ? 'LOGIN_FAILED' : 'LOGIN_INTERACTION_REQUIRED');
  const home = await client.page(VC + '/my/index.php');
  const identity = dashboard(home.html);
  const session = client.cookie();
  if (!session || !/^[A-Za-z0-9_-]{10,256}$/.test(session)) fail('SESSION_UNAVAILABLE');
  return { session, ...identity };
}

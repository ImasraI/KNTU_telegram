import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { MINI_APP_URL, SETUP_APP_URL } from '../tgcloud/lib/config.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('web/index.html');
const script = read('web/app.js');
const css = read('web/app.css');

test('the student Mini App is a Persian RTL, mobile-first surface with usable states', () => {
  assert.match(html, /lang="fa" dir="rtl"/);
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /href="\.\/app\.css"/);
  for (const id of ['view', 'tabbar', 'sheet', 'overlay', 'toast', 'freshness']) assert.match(html, new RegExp(`id="${id}"`));
  // Loading skeleton, empty/partial/error states and a dismissible status line.
  assert.match(html, /skeleton/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion/);
  for (const state of ['در حال بارگذاری', 'درسی پیدا نشد', 'موردی ثبت نشده است', 'انجام درخواست ممکن نشد', 'پوشش این بررسی کامل نبود', 'ذخیره‌شده']) {
    assert.ok(`${script}${html}`.includes(state), state);
  }
  // Every user-visible string that comes from the server passes through the escaper.
  assert.ok(script.includes('escapeHtml('), 'rendered values are escaped');
  assert.ok(!/innerHTML\s*=\s*[a-zA-Z_$][\w$]*\s*;/.test(script), 'no raw payload assigned as HTML');
});

test('the app calls only the student endpoint through the verified serverless call', () => {
  assert.match(script, /Serverless\.call\(ENDPOINT/);
  assert.match(script, /const ENDPOINT = 'student'/);
  assert.ok(!script.includes('initDataUnsafe'), 'the client never trusts unverified init data');
  assert.ok(!/fetch\(\s*['"`]\/api/.test(script), 'no hand-rolled endpoint call');
  assert.ok(!script.includes('/api/'), 'no direct API path in the front-end');
  for (const action of ['home', 'feed', 'course', 'register', 'stop', 'resume', 'forget', 'help']) {
    assert.ok(script.includes(`'${action}'`), action);
  }
  assert.ok(!/MoodleSession|wstoken|tgcloud|app8298297292:/.test(`${html}${script}${css}`), 'no credential or CLI token in the front-end');
});

test('the cooperation form stays available as a separate protected page', () => {
  const setup = read('setup/index.html');
  assert.match(setup, /فرم خصوصی همکاری دانشگاه/);
  assert.ok(setup.includes('MoodleSession'));
  assert.ok(!setup.includes('id="mode"'), 'the form still accepts a session cookie only');
  // One push publishes both pages, and the paths cannot drift apart.
  assert.equal(SETUP_APP_URL, new URL('setup/', MINI_APP_URL).href);
  assert.equal(new URL(SETUP_APP_URL).origin, new URL(MINI_APP_URL).origin);
  const handler = read('tgcloud/handlers/message.js');
  assert.ok(handler.includes('SETUP_APP_URL'), 'the /setup button uses the cooperation path');
  assert.ok(!handler.includes('MINI_APP_URL'), 'the /setup button no longer opens the student app');
});

test('building the front-end publishes the student app at the root and the form under /setup/', () => {
  execFileSync(process.execPath, ['scripts/build-frontend.mjs'], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
  assert.equal(read('dist/index.html'), html);
  assert.equal(read('dist/app.js'), script);
  assert.equal(read('dist/app.css'), css);
  assert.equal(read('dist/setup/index.html'), read('setup/index.html'));
  assert.ok(existsSync(new URL('../dist/setup/index.html', import.meta.url)));
  const config = read('tgcloud.jsonc');
  assert.match(config, /"source"\s*:\s*"dist"/);
  assert.match(config, /no-store/);
  // The deployed page must not be framed out by Telegram Web.
  assert.ok(!/X-Frame-Options|frame-ancestors/.test(config));
});

test('the front-end JavaScript is valid standalone and never asks for a login username', () => {
  assert.doesNotThrow(() => new Script(script));
  assert.ok(!`${html}${script}`.includes('نام کاربری'), 'only the VC display name is requested');
  assert.ok(script.includes('policy.fullNamePrompt') && script.includes('policy.fullNameLabel') && script.includes('policy.fullNameHint'),
    'the field label, prompt and hint are server-driven, not restated in the client');
});

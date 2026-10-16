import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
test('Persian cooperation form has valid JavaScript and accurate participant privacy text', () => {
  const html = readFileSync(new URL('../setup/index.html', import.meta.url), 'utf8');
  assert.match(html, /lang="fa" dir="rtl"/);
  assert.doesNotMatch(html, /participant lists are never collected|without risk|Checking access/);
  assert.doesNotMatch(html, /id="mode"|value="token"|نوع اتصال را انتخاب کنید|مدیر دارای دسترسی مدیریتی/);
  // The form must never label a field «نام کاربری»; only the VC display name is used.
  assert.doesNotMatch(html, /نام کاربری/);
  assert.match(html, /فهرست کامل دانشجویان ذخیره یا منتشر نمی‌شود/);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1);
  assert.doesNotThrow(() => new Script(inline[0][1]));
});

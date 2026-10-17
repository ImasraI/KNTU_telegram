import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Persian cooperation console has valid JavaScript and accurate participant privacy text', () => {
  const html = read('setup/index.html');
  const script = read('setup/setup.js');
  const css = read('setup/setup.css');
  assert.match(html, /lang="fa" dir="rtl"/);
  assert.doesNotMatch(html, /participant lists are never collected|without risk|Checking access/);
  assert.doesNotMatch(html, /id="mode"|value="token"|نوع اتصال را انتخاب کنید|مدیر دارای دسترسی مدیریتی/);
  // The form must never label a field «نام کاربری»; only the VC display name is used.
  assert.doesNotMatch(html, /نام کاربری/);
  assert.match(html, /فهرست کامل دانشجویان ذخیره یا منتشر نمی‌شود/);

  // The logic ships as a file (no inline script), and it must parse on its own.
  assert.equal([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].length, 0, 'no inline script');
  assert.match(html, /<script src="\.\/setup\.js" defer><\/script>/);
  assert.doesNotThrow(() => new Script(script));
  assert.match(css, /\.sidenav/, 'the console layout stylesheet is present');

  // One shared design system: the console reuses the Mini App tokens and adds layout.
  assert.match(html, /href="\.\.\/app\.css"/);
  assert.match(html, /href="\.\/setup\.css"/);

  // Accessibility scaffolding the console depends on.
  assert.match(html, /class="skip"/);
  assert.match(html, /<main[^>]*id="main"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<label for="secret">/);
  assert.match(html, /<dialog id="confirm-dialog"/);

  // No credential, key or CLI state may appear in either file.
  assert.doesNotMatch(`${html}${script}`, /DATABASE_KEY|database-secret|\.tgcloud\//);
});

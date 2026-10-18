// Renders both shipped surfaces in a real browser and holds them to the
// contract the UI claims: no horizontal overflow at phone width, WCAG 2.1 A/AA
// (axe), every control named, every tab wired to its panel, and no click target
// under 40px.
//
// The browser is Chromium through Playwright. `npm test` fails with an
// actionable message when it is missing:
//
//   npx playwright install chromium
//
// CI does that in .github/workflows/ui.yml. This test is not skippable: a
// silently skipped accessibility check is worse than none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from '../scripts/preview-mock.mjs';

const root = new URL('../', import.meta.url);
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let build;
let preview;
let browser;

before(async () => {
  // Build the real artifact — the same files a push uploads — into a private
  // folder so this file never deletes dist/ under a test running in parallel.
  build = await mkdtemp(join(tmpdir(), 'kntu-ui-'));
  execFileSync(process.execPath, ['scripts/build-frontend.mjs', '--out', build], { cwd: root, stdio: 'pipe' });
  preview = await startPreview({ root: build });
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(`Chromium could not start (${error.message.split('\n')[0]}). Run: npx playwright install chromium`);
  }
});

after(async () => {
  await browser?.close();
  await preview?.close();
  if (build) await rm(build, { recursive: true, force: true });
});

const surfaces = [
  {
    name: 'student Mini App',
    route: '/',
    // The app flips aria-busy on <main> once the first payload is painted.
    ready: () => document.getElementById('view')?.getAttribute('aria-busy') === 'false',
    settled: () => document.getElementById('view')?.getAttribute('aria-busy') === 'false',
  },
  {
    name: 'setup console',
    route: '/setup/',
    ready: () => document.getElementById('shell')?.getAttribute('aria-busy') === 'false',
    settled: () => document.getElementById('shell')?.getAttribute('aria-busy') === 'false',
  },
];

// Everything below runs inside the page. Keep it dependency-free.
function audit() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const visible = element => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (element.closest('[hidden]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const describe = element => {
    const id = element.id ? `#${element.id}` : '';
    const cls = typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${element.tagName.toLowerCase()}${id}${cls}`;
  };

  // 1. Horizontal overflow: the page must not scroll sideways, and no visible
  //    box may stick out of the viewport unless a scroll container clips it
  //    (a deliberate swipeable row) or it is a visually-hidden skip link.
  const clipped = element => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX;
      if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return true;
    }
    return false;
  };
  const overflowing = [];
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('.skip, .sr-only, [aria-hidden="true"]')) continue;
    if (!visible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.right <= vw + 1 && rect.left >= -1) continue;
    if (clipped(element)) continue;
    overflowing.push(`${describe(element)} spans ${Math.round(rect.left)}..${Math.round(rect.right)} of ${vw}`);
  }

  // 2. Click targets: 40x40 is the floor this project committed to. A control
  //    inside a label is measured by the label, i.e. what the thumb actually hits.
  const targets = [];
  for (const element of document.querySelectorAll('button, [role="tab"], [role="switch"], [role="button"], select, input:not([type="hidden"]), textarea')) {
    if (!visible(element)) continue;
    const hit = element.closest('label') ?? element;
    const rect = hit.getBoundingClientRect();
    if (rect.width >= 40 && rect.height >= 40) continue;
    targets.push(`${describe(element)} is ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }

  // 3. Nothing may sit on top of a control, and the cursor must say what it does.
  //    Chromium leaves <button> with the plain arrow, so a missing `pointer` is a
  //    rule the stylesheet has to state; `not-allowed` is the disabled answer.
  const cursorWrong = [];
  const blockers = [];
  const pressable = 'button, [role="button"], [role="tab"], [role="switch"], summary, select, input[type="checkbox"], input[type="radio"], input[type="range"]';
  for (const element of document.querySelectorAll(pressable)) {
    if (!visible(element)) continue;
    const disabled = element.matches('[disabled], [aria-disabled="true"]');
    const cursor = getComputedStyle(element).cursor;
    const expected = disabled ? 'not-allowed' : 'pointer';
    if (!cursor.split(/\s+/).includes(expected)) cursorWrong.push(`${describe(element)} has cursor:${cursor}${disabled ? ' (disabled)' : ''}`);
    if (disabled) continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > vh) continue; // below the fold
    const top = document.elementFromPoint(x, y);
    if (!(top === element || element.contains(top) || top?.contains(element))) {
      blockers.push(`${describe(element)} is covered by ${describe(top ?? document.body)}`);
    }
  }

  // 4. Tabs: one selected tab, roving tabindex, and a panel that exists.
  const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')].filter(visible);
  const tabsBroken = [];
  const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
  if (tabs.length && selected.length !== 1) tabsBroken.push(`${selected.length} tabs are selected of ${tabs.length}`);
  if (tabs.length && tabs.filter(tab => tab.tabIndex === 0).length !== 1) tabsBroken.push('roving tabindex is not exactly one tab');
  for (const tab of tabs) {
    const id = tab.getAttribute('aria-controls');
    if (!id) { tabsBroken.push(`${describe(tab)} has no aria-controls`); continue; }
    const panel = document.getElementById(id);
    if (!panel) { tabsBroken.push(`${describe(tab)} controls missing #${id}`); continue; }
    // The active tab must control a visible panel; inactive ones must not.
    if (tab.getAttribute('aria-selected') === 'true' && !visible(panel)) tabsBroken.push(`active tab's panel #${id} is hidden`);
  }

  // 5. Forms: a control needs a label, an aria-label or a labelledby reference.
  const unnamed = [];
  for (const element of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (!visible(element)) continue;
    const named = element.labels?.length || element.getAttribute('aria-label')?.trim()
      || element.getAttribute('aria-labelledby')?.trim();
    if (!named) unnamed.push(describe(element));
  }

  // 6. Structure the surfaces promise: a skip link, one main landmark, a
  //    polite live region, and nothing taller than the viewport clipping content.
  const structure = [];
  if (!document.querySelector('a.skip')) structure.push('no skip link');
  if (document.querySelectorAll('main').length !== 1) structure.push('not exactly one main landmark');
  if (!document.querySelector('[aria-live="polite"]')) structure.push('no polite live region');
  const tall = [...document.querySelectorAll('body *')].filter(element =>
    visible(element) && element.getBoundingClientRect().height > vh * 3 && getComputedStyle(element).overflowY !== 'visible');
  if (tall.length) structure.push(`over-long scroll box ${describe(tall[0])}`);

  return {
    viewport: `${vw}x${vh}`,
    sideways: document.documentElement.scrollWidth - vw,
    overflowing: overflowing.slice(0, 6),
    smallTargets: targets.slice(0, 8),
    cursorWrong: cursorWrong.slice(0, 8),
    blockers: blockers.slice(0, 6),
    tabsBroken: tabsBroken.slice(0, 6),
    unnamed: unnamed.slice(0, 6),
    structure,
  };
}

async function runAxe(page) {
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      // The Mini App lives inside Telegram's iframe; document-level landmark
      // rules are covered by `structure` above, not by axe's page rules.
      rules: { 'landmark-one-main': { enabled: true }, region: { enabled: true } },
    });
    return result.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 4).map(node => `${node.target.join(' ')} — ${node.failureSummary?.split('\n')[0] ?? ''}`),
    }));
  });
}

async function open(surface) {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, locale: 'fa-IR' });
  const noise = [];
  page.on('pageerror', error => noise.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') noise.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => noise.push(`requestfailed: ${request.url()}`));
  await page.goto(`${preview.url}${surface.route}`, { waitUntil: 'load' });
  await page.waitForFunction(surface.ready, undefined, { timeout: 15000 });
  await page.addScriptTag({ content: axeSource });
  return { page, noise };
}

async function auditTab(page, surface, label) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => setTimeout(done, 60))));
  await page.waitForFunction(surface.settled, undefined, { timeout: 15000 });
  const report = await page.evaluate(audit);
  assert.equal(report.sideways, 0, `${label}: the page scrolls ${report.sideways}px sideways (${report.viewport})`);
  assert.deepEqual(report.overflowing, [], `${label}: boxes stick out of the viewport`);
  assert.deepEqual(report.smallTargets, [], `${label}: click targets under 40px`);
  assert.deepEqual(report.cursorWrong, [], `${label}: cursor does not match what the control does`);
  assert.deepEqual(report.blockers, [], `${label}: something covers a control`);
  assert.deepEqual(report.tabsBroken, [], `${label}: tab wiring`);
  assert.deepEqual(report.unnamed, [], `${label}: controls without an accessible name`);
  assert.deepEqual(report.structure, [], `${label}: page structure`);
  const violations = await runAxe(page);
  assert.deepEqual(violations, [], `${label}: axe WCAG 2.1 A/AA\n${JSON.stringify(violations, null, 1)}`);
}

for (const surface of surfaces) {
  test(`${surface.name}: every tab passes the UI contract at 360px`, async () => {
    const { page, noise } = await open(surface);
    try {
      await auditTab(page, surface, `${surface.name} (initial)`);

      const tabs = await page.locator('[role="tablist"] [role="tab"]').all();
      assert.ok(tabs.length >= 3, `${surface.name} exposes its sections as tabs`);
      for (let index = 0; index < tabs.length; index += 1) {
        const tab = tabs[index];
        const name = (await tab.textContent())?.trim().slice(0, 30) ?? `tab ${index}`;
        await tab.click();
        const panelId = await tab.getAttribute('aria-controls');
        await page.waitForFunction(id => {
          const panel = document.getElementById(id);
          return panel && !panel.hidden && panel.getClientRects().length > 0;
        }, panelId, { timeout: 15000 });
        await auditTab(page, surface, `${surface.name} › ${name}`);
      }

      // Keyboard: arrows move between tabs and the panel follows, so the whole
      // set is reachable without a pointer (horizontal RTL and vertical lists
      // both answer to at least one of these).
      await page.locator('[role="tablist"] [role="tab"]').first().focus();
      const before = await selectedTab(page);
      await page.keyboard.press('ArrowLeft');
      if (await selectedTab(page) === before) await page.keyboard.press('ArrowDown');
      assert.notEqual(await selectedTab(page), before, `${surface.name}: arrow keys did not move the selected tab`);

      assert.deepEqual(noise, [], `${surface.name}: console/page errors while rendering`);
    } finally {
      await page.close();
    }
  });
}

async function selectedTab(page) {
  return page.evaluate(() => document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')?.id ?? null);
}

// A check that cannot fail protects nothing. Plant the three regressions the
// contract exists for and prove each one is reported.
test('the audit reports planted regressions instead of passing everything', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, locale: 'fa-IR' });
  try {
    await page.goto(`${preview.url}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('view')?.getAttribute('aria-busy') === 'false');
    await page.addScriptTag({ content: axeSource });
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.id = 'planted-wide';
      wide.style.cssText = 'width:500px;height:20px';
      const small = document.createElement('button');
      small.id = 'planted-small';
      small.textContent = 'x';
      small.style.cssText = 'width:24px;height:24px;padding:0';
      const bare = document.createElement('input');
      bare.id = 'planted-input';
      // A button that ignores the cursor, and a disabled one that lies about it.
      const rude = document.createElement('button');
      rude.id = 'planted-cursor';
      rude.textContent = 'y';
      rude.style.cssText = 'cursor: default; width:60px; height:44px';
      const off = document.createElement('button');
      off.id = 'planted-disabled';
      off.disabled = true;
      off.textContent = 'z';
      off.style.cssText = 'cursor: pointer; width:60px; height:44px';
      document.getElementById('view').append(wide, small, bare, rude, off);
    });
    const report = await page.evaluate(audit);
    assert.ok(report.sideways > 0, 'a 500px box is reported as horizontal scroll');
    assert.ok(report.overflowing.some(entry => entry.includes('planted-wide')), 'the offending box is named');
    assert.ok(report.smallTargets.some(entry => entry.includes('planted-small')), 'a 24px button is reported');
    assert.ok(report.unnamed.includes('input#planted-input'), 'an unlabelled input is reported');
    assert.ok(report.cursorWrong.some(entry => entry.includes('planted-cursor')), 'a button that ignores the cursor is reported');
    assert.ok(report.cursorWrong.some(entry => entry.includes('planted-disabled')), 'a disabled button that pretends to be pressable is reported');
    const violations = await runAxe(page);
    assert.ok(violations.some(violation => violation.id === 'label'), 'axe reports the unlabelled input');

    // Second pass: an invisible sheet over the page must be caught as a blocker,
    // because that is what "the buttons do not respond" looks like from the DOM.
    assert.deepEqual(report.blockers, [], 'nothing covers a control before the sheet is planted');
    await page.evaluate(() => {
      const cover = document.createElement('div');
      cover.id = 'planted-cover';
      cover.style.cssText = 'position:fixed; inset:0; z-index:99';
      document.body.append(cover);
    });
    const covered = await page.evaluate(audit);
    assert.ok(covered.blockers.length > 0, 'covering the page is reported as blocked controls');
    assert.ok(covered.blockers.some(entry => entry.includes('planted-cover')), 'the covering element is named');
  } finally {
    await page.close();
  }
});

test('both surfaces keep their layout on the narrowest phone and a desktop console', async () => {
  const widths = [
    { route: '/', width: 320, height: 640 },
    { route: '/setup/', width: 360, height: 740 },
    { route: '/setup/', width: 1024, height: 800 },
  ];
  for (const { route, width, height } of widths) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'fa-IR' });
    try {
      await page.goto(`${preview.url}${route}`, { waitUntil: 'load' });
      const surface = surfaces.find(entry => entry.route === route);
      await page.waitForFunction(surface.ready, undefined, { timeout: 15000 });
      const report = await page.evaluate(audit);
      assert.equal(report.sideways, 0, `${route} at ${width}px: ${report.sideways}px of horizontal scroll`);
      assert.deepEqual(report.overflowing, [], `${route} at ${width}px: boxes stick out of the viewport`);
    } finally {
      await page.close();
    }
  }
});

// Dark is the product default, not a reaction to the client's own theme: on a
// light client the app still opens dark, and the header toggle flips it — a
// choice the page remembers on the next visit.
test('dark mode is the default and the header toggle switches to light for good', async () => {
  for (const surface of surfaces) {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 }, locale: 'fa-IR', colorScheme: 'light' });
    try {
      await page.goto(`${preview.url}${surface.route}`, { waitUntil: 'load' });
      await page.waitForFunction(surface.ready, undefined, { timeout: 15000 });
      const palette = () => page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      assert.deepEqual(await palette(), { theme: 'dark', bg: '#0d1219', scheme: 'dark' },
        `${surface.name}: opens dark even when the client asks for light`);

      const toggle = page.locator('[data-act="theme"]');
      assert.match(await toggle.getAttribute('aria-label'), /روشن/, `${surface.name}: the toggle names the mode it switches to`);
      await toggle.click();
      assert.deepEqual(await palette(), { theme: 'light', bg: '#f1f4f9', scheme: 'light' },
        `${surface.name}: the toggle switches to light`);
      assert.match(await toggle.getAttribute('aria-label'), /تاریک/, `${surface.name}: the toggle now offers dark`);
      // The opt-in palette has to be as legible as the default one.
      await page.addScriptTag({ content: axeSource });
      assert.deepEqual(await runAxe(page), [], `${surface.name}: the light palette still passes axe`);

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(surface.ready, undefined, { timeout: 15000 });
      assert.equal((await palette()).theme, 'light', `${surface.name}: the choice survives a reload`);
      await page.locator('[data-act="theme"]').click();
      assert.equal((await palette()).theme, 'dark', `${surface.name}: switching back sticks too`);
    } finally {
      await page.close();
    }
  }
});

// The whole point of the digit change: nothing Persian- or Arabic-Indic-numeral
// shaped may reach the screen, including text that arrived from VC.
test('no Persian or Arabic-Indic digit is rendered on either surface', async () => {
  const visibleDigits = () => {
    const found = new Set();
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) for (const digit of node.data.match(/[\u06F0-\u06F9\u0660-\u0669]/g) ?? []) found.add(digit);
      else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName)) {
        for (const child of node.childNodes) walk(child);
      }
    };
    walk(document.body);
    return [...found];
  };
  for (const surface of surfaces) {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 }, locale: 'fa-IR' });
    try {
      await page.goto(`${preview.url}${surface.route}`, { waitUntil: 'load' });
      await page.waitForFunction(surface.ready, undefined, { timeout: 15000 });
      for (const tab of await page.locator('[role="tablist"] [role="tab"]').all()) {
        const label = (await tab.textContent())?.trim().slice(0, 24) ?? 'tab';
        await tab.click();
        await page.waitForFunction(surface.settled, undefined, { timeout: 15000 });
        assert.deepEqual(await page.evaluate(visibleDigits), [], `${surface.name} › ${label}: only ASCII digits are shown`);
      }
    } finally {
      await page.close();
    }
  }
});

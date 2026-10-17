// Runs the real `endpoints/aiAdmin` module against a fake platform: the settings
// store and the role lookup are the only things stubbed. What is exercised is the
// shipped owner gate, the validation ranges shared with `/ai` and `/persona`, and
// the fact that no media identifier or model key can appear in a response.
import assert from 'node:assert/strict';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../tgcloud/', import.meta.url);
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const settings = new Map();
let role = 'owner';

const stubs = new Map([
  ['sdk', { EndpointError: class EndpointError extends Error { constructor(message, parameters) { super(message); this.parameters = parameters; } } }],
  [new URL('lib/accounts.js', root).href, { roleOf: async () => role }],
  [new URL('lib/settings.js', root).href, {
    getSetting: async key => plain(settings.get(key)),
    putSetting: async (key, value) => { settings.set(key, plain(value)); },
    delSetting: async key => { settings.delete(key); },
  }],
]);

const context = createContext({ console, JSON, Math, Number, String, Array, Object });
const modules = new Map();
async function load(id) {
  if (modules.has(id)) return modules.get(id);
  let mod;
  if (stubs.has(id)) {
    const exports = stubs.get(id);
    mod = new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context, identifier: id });
  } else {
    mod = new SourceTextModule(await readFile(fileURLToPath(id), 'utf8'), { context, identifier: id });
  }
  modules.set(id, mod);
  return mod;
}

const entry = await load(new URL('endpoints/aiAdmin.js', root).href);
await entry.link((specifier, parent) => load(specifier.startsWith('.') ? new URL(specifier, parent.identifier).href : specifier));
await entry.evaluate();
const admin = entry.namespace.default;
const ctx = id => ({ initData: { user: { id } } });

async function refuses(run, pattern) {
  try { await run(); } catch (error) { assert.match(String(error?.message ?? error), pattern); return; }
  assert.fail(`expected a refusal matching ${pattern}`);
}

/* ------------------------------------------------------------- owner gate */
role = 'contributor';
await refuses(() => admin({ action: 'state' }, ctx(12345)), /مخصوص مدیر/);
await refuses(() => admin({ action: 'save', enabled: false }, ctx(12345)), /مخصوص مدیر/);
await refuses(() => admin({ action: 'media', op: 'clear' }, ctx(12345)), /مخصوص مدیر/);
assert.equal(settings.has('ai:config'), false, 'a refused caller changes nothing');
role = 'owner';

/* --------------------------------------------------------------- defaults */
const initial = await admin({ action: 'state' }, ctx(747977517));
assert.equal(initial.config.enabled, true, 'chat is on by default');
assert.equal(initial.config.provider, null);
assert.equal(initial.traits.length, 5);
assert.equal(initial.media.count, 0);
assert.equal(initial.providers.length, 2);
assert.ok(initial.disclosure.includes('اختیاری'), 'the student disclosure is served from one place');

/* ------------------------------------------------------------- validation */
await refuses(() => admin({ action: 'save', provider: 'openai' }, ctx(1)), /Groq یا Gemini/);
await refuses(() => admin({ action: 'save', model: 'bad model!' }, ctx(1)), /نام مدل/);
await refuses(() => admin({ action: 'save', dailyUser: 'ten' }, ctx(1)), /سقف روزانهٔ هر کاربر/);

const saved = await admin({ action: 'save', enabled: false, provider: 'gemini', model: 'gemini-2.0-flash', dailyUser: 25, dailyGlobal: 900 }, ctx(1));
assert.equal(saved.config.enabled, false);
assert.equal(saved.config.provider, 'gemini');
assert.deepEqual(plain(settings.get('ai:config')), { enabled: false, provider: 'gemini', model: 'gemini-2.0-flash', dailyUser: 25, dailyGlobal: 900 });

// Out-of-range numbers clamp instead of being stored as-is.
const clamped = await admin({ action: 'save', dailyUser: 500, dailyGlobal: 99999 }, ctx(1));
assert.equal(clamped.config.dailyUser, 100);
assert.equal(clamped.config.dailyGlobal, 5000);
// An empty value returns the field to the service default.
assert.equal((await admin({ action: 'save', provider: '' }, ctx(1))).config.provider, null);
assert.equal((await admin({ action: 'save', model: '' }, ctx(1))).config.model, null);

/* --------------------------------------------------------------- persona */
const high = await admin({ action: 'persona', trait: 'sarcasm', value: 99 }, ctx(1));
assert.equal(high.traits.find(trait => trait.key === 'sarcasm').value, 10);
const low = await admin({ action: 'persona', trait: 'warmth', value: -4 }, ctx(1));
assert.equal(low.traits.find(trait => trait.key === 'warmth').value, 0);
await refuses(() => admin({ action: 'persona', trait: 'unknown', value: 5 }, ctx(1)), /ویژگی/);
await refuses(() => admin({ action: 'persona', trait: 'sarcasm', value: 'lots' }, ctx(1)), /عدد/);
assert.equal(settings.get('ai:traits').sarcasm, 10, 'a rejected value leaves the stored one alone');

/* ------------------------------------------------------------------ media */
settings.set('ai:media', [{ kind: 'gif', fileId: 'PRIVATE-FILE-ID' }]);
assert.equal((await admin({ action: 'state' }, ctx(1))).media.count, 1);
assert.equal((await admin({ action: 'media', op: 'clear' }, ctx(1))).media.count, 0);
await refuses(() => admin({ action: 'media', op: 'nope' }, ctx(1)), /شناخته نشد/);
await refuses(() => admin({ action: 'nonsense' }, ctx(1)), /شناخته نشد/);
assert.ok(!JSON.stringify(await admin({ action: 'state' }, ctx(1))).includes('PRIVATE-FILE-ID'), 'no media identifiers in a response');

console.log('AI admin endpoint: owner gate, validation, clamping, persona and media passed.');

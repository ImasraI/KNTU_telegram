import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { AI_TRAIT_KEYS, normalizeConfig, normalizeTraits } from '../tgcloud/lib/ai-policy.js';

test('the AI console is owner-only and validates everything it writes', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'tests/fixtures/ai-admin-endpoint.mjs'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('AI defaults are conservative and share one trait list with the chat commands', () => {
  assert.deepEqual(normalizeConfig(undefined), { enabled: true, provider: null, model: null, dailyUser: null, dailyGlobal: null });
  // Unknown provider and malformed model are dropped rather than trusted; limits clamp.
  assert.deepEqual(
    normalizeConfig({ enabled: false, provider: 'nope', model: 'bad model', dailyUser: 0, dailyGlobal: 0 }),
    { enabled: false, provider: null, model: null, dailyUser: 1, dailyGlobal: 1 },
  );
  assert.deepEqual(AI_TRAIT_KEYS, ['sarcasm', 'ego', 'toxicity', 'talkative', 'warmth']);
  assert.deepEqual(normalizeTraits({ sarcasm: 30, warmth: 'x' }), { sarcasm: 10, ego: null, toxicity: null, talkative: null, warmth: null });
});

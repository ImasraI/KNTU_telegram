import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('public bot and personal subscriptions work without contributor approval', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'tests/fixtures/public-runtime.mjs'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

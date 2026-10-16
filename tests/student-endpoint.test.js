import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// The runtime fixture asserts internally and prints one line on success; a non-zero
// exit means an isolation, authorization or registration rule broke.
test('the student endpoint scopes data to the authenticated caller and reuses the bot services', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'tests/fixtures/student-endpoint.mjs'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Student endpoint:/);
});

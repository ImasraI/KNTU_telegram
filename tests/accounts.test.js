import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFrom, canConnect, canManageAccount, validCredential, accountLabel, ownAccounts, scopeHealth } from '../tgcloud/lib/authorize.js';

const OWNER = 747977517;
const A = { id: 'acc_a', ownerId: 111 };
const B = { id: 'acc_b', ownerId: 222 };

test('only the owner and approved contributors may connect an account', () => {
  assert.equal(roleFrom(OWNER, undefined, OWNER), 'owner');
  assert.equal(roleFrom(OWNER, undefined, 111), 'none');
  assert.equal(roleFrom(OWNER, { approved: true }, 111), 'contributor');
  assert.equal(roleFrom(OWNER, { approved: false }, 111), 'none');
  assert.equal(roleFrom(OWNER, { approved: true }, 0), 'none');
  assert.ok(canConnect('owner') && canConnect('contributor'));
  assert.ok(!canConnect('none'));
});

test('an account is isolated to its holder, while the owner manages all', () => {
  assert.ok(canManageAccount('owner', OWNER, A));
  assert.ok(canManageAccount('contributor', 111, A));
  assert.ok(!canManageAccount('contributor', 222, A)); // someone else's account
  assert.ok(!canManageAccount('contributor', 111, B));
  assert.ok(!canManageAccount('none', 111, A));
  assert.ok(!canManageAccount('contributor', 111, null));
});

test('a contributor only sees and lists their own accounts', () => {
  const rows = [A, B];
  assert.deepEqual(ownAccounts('owner', OWNER, rows), rows);
  assert.deepEqual(ownAccounts('contributor', 222, rows).map(r => r.id), ['acc_b']);
  assert.deepEqual(ownAccounts('none', 111, rows), []);
});

test('credentials are opaque tokens: no spaces, no urls, no short values', () => {
  assert.ok(validCredential('session', 'a'.repeat(32)));
  assert.ok(validCredential('token', 'AbC-123_xyz7890'));
  assert.ok(!validCredential('session', 'short'));
  assert.ok(!validCredential('session', 'cookie: MoodleSession=abc'));
  assert.ok(!validCredential('session', 'a b c d e f g h i j k'));
  assert.ok(!validCredential('password', 'a'.repeat(32)));
  assert.ok(!validCredential('session', null));
  assert.ok(!validCredential('session', 'a'.repeat(300)));
});

test('account labels are bounded single lines and never derived from a credential', () => {
  assert.equal(accountLabel('  Alireza\nmath  ', 1), 'Alireza math');
  assert.equal(accountLabel('', 3), 'حساب 3');
  assert.equal(accountLabel(undefined, undefined), 'حساب 1');
  assert.equal(accountLabel('x'.repeat(200), 1).length, 60);
});

test('a shared status document is scoped before it reaches a contributor', () => {
  const health = [
    { id: 'acc_a', ownerId: 111, label: 'A', state: 'ok' },
    { id: 'acc_b', ownerId: 222, label: 'B', state: 'auth' },
  ];
  assert.deepEqual(scopeHealth(health, OWNER, true).map(h => h.id), ['acc_a', 'acc_b']);
  assert.deepEqual(scopeHealth(health, 222, false).map(h => h.id), ['acc_b']);
  assert.deepEqual(scopeHealth(health, 333, false), []);
  assert.deepEqual(scopeHealth(undefined, 111, false), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_HELP, PUBLIC_COMMANDS, identityText, selectedIds, consented, unseenItems, itemReceipt } from '../tgcloud/lib/student-policy.js';
import { signature } from '../tgcloud/lib/content.js';
import { matchingParticipants } from '../tgcloud/lib/participants.js';

test('public welcome and menu expose no administrator commands or approval gate', () => {
  assert.doesNotMatch(PUBLIC_HELP, /\/approve|\/revoke|\/setup|\/bind|\/admin|\/check/);
  for (const name of ['courses', 'assignments', 'exams', 'stop', 'cooperate']) assert.ok(PUBLIC_COMMANDS.some(c => c.command === name));
  assert.ok(PUBLIC_COMMANDS.every(c => /[\u0600-\u06ff]/.test(c.description)));
});
test('selection accepts only known course ids and notification consent is explicit', () => {
  assert.deepEqual(selectedIds(['۳', '3', '82', '999', 'bad'], [{ id: 3 }, { id: 82 }]), ['3', '82']);
  assert.equal(consented({ pending: { courses: ['3'] } }), false);
  assert.equal(consented({ confirmed: true, courses: [] }), false);
  assert.equal(consented({ confirmed: true, courses: ['3'] }), true);
});
test('matching ignores initials, normalizes Persian letters and never matches substrings or Moodle ids as usernames', () => {
  const html = '<table id="participants"><tr><th class="c1"><a href="/user/view.php?id=42&amp;course=3"><span role="img">AR</span>علي رضايي</a></th><td class="c2">شاگرد</td></tr></table>';
  assert.deepEqual(matchingParticipants(html, 'علی رضایی'), [{ id: '42', name: 'علي رضايي' }]);
  assert.deepEqual(matchingParticipants(html, '42'), []);
  assert.deepEqual(matchingParticipants(html, 'رضایی'), []);
  assert.equal(identityText('  Arsam   Alaei '), 'arsam alaei');
});
test('personal receipts suppress history and repeat sends while retaining genuine updates', () => {
  const item = { id: 9, name: 'تکلیف', kind: 'assign', files: [], dates: 'جمعه' };
  const seen = { [itemReceipt(3, item)]: signature(item) };
  assert.deepEqual(unseenItems(3, [item], seen), []);
  assert.equal(unseenItems(3, [{ ...item, dates: 'شنبه' }], seen).length, 1);
  assert.equal(unseenItems(82, [item], seen).length, 1);
});

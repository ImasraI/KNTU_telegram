import test from 'node:test';
import assert from 'node:assert/strict';
import { participantProfessors } from '../tgcloud/lib/participants.js';
import { connector } from '../tgcloud/lib/moodle.js';

// Reduced from KNTU's actual participants table. Names are fictional.
const row = (name, role) => `<tr><td class="cell c0"><input></td><th class="cell c1" scope="row"><a href="https://vc.kntu.ac.ir/user/view.php?id=42&amp;course=3"><span role="img" class="userinitials">XX</span>${name}</a></th><td class="cell c2">${role}</td></tr>`;
const page = body => `<table id="participants">${body}</table>`;

test('only the exact professor role yields a name, without avatar initials or student data', () => {
  const result = participantProfessors(page(row('Student Name', 'شاگرد') + row('Professor Name', 'استاد') + row('Assistant Name', 'دستیار استاد')));
  assert.deepEqual(result.names, ['Professor Name']);
  assert.throws(() => participantProfessors('<body>Access denied</body>'), /PARTICIPANTS_LAYOUT/);
});

test('professor lookup follows pagination and keeps the session out of URLs', async () => {
  const calls = [];
  const moodle = connector(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Cookie, 'MoodleSession=TEST');
    const html = url.includes('page=1') ? page(row('Professor Name', 'استاد')) :
      page(row('Student Name', 'شاگرد')) + '<a href="/user/index.php?id=3&amp;page=1">Next</a>';
    return { ok: true, text: async () => html };
  }, { mode: 'session', secret: 'TEST' });
  assert.equal(await moodle.professor({ id: 3 }), 'Professor Name');
  assert.equal(calls.length, 2);
});

test('zero or multiple professors are never guessed and token accounts do not send cookies', async () => {
  const moodle = connector(async () => ({ ok: true, text: async () => page(row('One', 'استاد') + row('Two', 'استاد')) }), { mode: 'session', secret: 'TEST' });
  assert.equal(await moodle.professor({ id: 3 }), null);
  const api = connector(() => assert.fail('no cookie request'), { mode: 'token', secret: 'TEST' });
  assert.equal(await api.professor({ id: 3 }), null);
});

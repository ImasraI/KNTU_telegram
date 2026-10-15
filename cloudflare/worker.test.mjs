import test from 'node:test';
import assert from 'node:assert/strict';
await import('./build.mjs');
const { default: worker, check } = await import('./worker.js');

test('cron sends the authenticated owner check to Telegram without logging secrets', async () => {
  let calls = 0;
  await check({ TGCLOUD_TOKEN: 'app123:test-secret' }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://cloud.telegram.org/app123/manage/run');
    const body = JSON.parse(options.body);
    assert.equal(body.module, 'endpoints/check');
    assert.equal(body.args.scheduled, true);
    assert.equal(body.ctx.initData.user.id, 747977517);
    assert.ok(body.sources['endpoints/check']);
    assert.equal(options.headers.Authorization, 'Bearer app123:test-secret');
    return Response.json({ ok: true, result: { result: { ok: true }, log: [] } });
  });
  assert.equal(calls, 1);
  assert.equal(worker.fetch().status, 404);
});

test('remote failures and incomplete course coverage fail the scheduled invocation', async () => {
  const env = { TGCLOUD_TOKEN: 'app123:test-secret' };
  for (const result of [
    { ok: false, description: 'private remote details' },
    { ok: true, result: { log: ['SCHEDULED_CHECK_PROBLEMS'] } },
  ]) {
    await assert.rejects(check(env, async () => Response.json(result)), error => {
      assert.doesNotMatch(error.message, /private remote details|test-secret/);
      return true;
    });
  }
  await assert.rejects(check({}, () => assert.fail('must not fetch')), /secret/);
});

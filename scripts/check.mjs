import './prepare-database.mjs';
// External-scheduler entry point (the GitHub Actions "Course checks" workflow).
//
// It invokes tgcloud/endpoints/check through the authenticated CLI, which runs this
// repository's local source on Telegram WITHOUT deploying it, with an owner
// init-data context. University credentials stay inside the authenticated D1 backend, so
// nothing here can copy them to the scheduler.
//
// Required environment:
//   TGCLOUD_TOKEN  the app<id>:<secret> CLI token (repository secret, never argv)
//   BOT_OWNER_ID   optional; must equal OWNER_ID in tgcloud/lib/config.js if set
//
// Exits non-zero on: a failed endpoint, a scheduled partial failure, an expired
// university session, or a timeout — so the schedule surfaces the problem.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OWNER_ID } from '../tgcloud/lib/config.js';

const TIMEOUT_MS = 5 * 60 * 1000;
const token = process.env.TGCLOUD_TOKEN ?? '';

// Screen scraping is the CLI's only output channel; make sure a stray echo of the
// credential can never reach a public workflow log.
const scrub = text => [token,process.env.DATABASE_KEY].filter(Boolean).reduce((value,secret)=>value.split(secret).join('[REDACTED]'),String(text??''));
function fail(message) {
  process.stderr.write(`\ncheck failed: ${scrub(message)}\n`);
  process.exit(1);
}

if (!token) fail('TGCLOUD_TOKEN is not set. Add the CLI access token as a repository secret.');
if (!Number.isSafeInteger(OWNER_ID) || OWNER_ID <= 0) fail('OWNER_ID is not configured in tgcloud/lib/config.js.');
const configured = process.env.BOT_OWNER_ID?.trim();
if (configured && Number(configured) !== OWNER_ID) {
  fail(`BOT_OWNER_ID (${configured}) does not match OWNER_ID (${OWNER_ID}) in tgcloud/lib/config.js.`);
}

// Use the package's declared bin rather than assuming its internal layout.
const pkgUrl = new URL('../node_modules/@tgcloud/cli/package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tgcloud;
const binPath = fileURLToPath(new URL(bin, pkgUrl));

// The token travels in the environment only; the arguments hold no secret.
const args = ['run', 'endpoints/check', '{"scheduled":true}', '--ctx', JSON.stringify({ initData: { user: { id: OWNER_ID } } })];
const result = spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8', timeout: TIMEOUT_MS, env: process.env });

const stdout = scrub(result.stdout ?? '');
const stderr = scrub(result.stderr ?? '');
process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.error?.code === 'ETIMEDOUT') fail(`the check did not finish within ${TIMEOUT_MS / 1000}s.`);
if (result.error) fail(`could not start the CLI: ${result.error.message}`);
const output = stdout + stderr;
if (result.status !== 0) fail(`the check endpoint exited with code ${result.status}.`);
if (output.includes('SCHEDULED_CHECK_PROBLEMS')) {
  const detail = output.match(/SCHEDULED_CHECK_PROBLEMS[^\n]*/)?.[0] ?? 'SCHEDULED_CHECK_PROBLEMS';
  fail(`partial course coverage: ${detail}`);
}
if (/ALL_ACCOUNTS_UNAVAILABLE/.test(output)) fail('no university account could be read; at least one session must be renewed.');
if (/UNIVERSITY_LOGIN_REQUIRED|MOODLE_API_ACCESS_DENIED/.test(output)) fail('a university session expired; renew it in the Mini App.');

process.stdout.write('\ncheck completed without reported problems\n');

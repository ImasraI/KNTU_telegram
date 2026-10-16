# The public student Mini App

A Persian, mobile-first RTL page that any student can open from the bot. It is the
same course data as the chat commands, in a browsable form, plus self-registration
and notification controls. It needs **no contributor approval and no university
credential**.

- **Student app** (public): `https://app8298297292.tgcloud.ai/`
- **Cooperation form** (approved contributors and the owner only):
  `https://app8298297292.tgcloud.ai/setup/`, reached through `/setup` in the chat.

Both are published by one `push`: `tgcloud.jsonc` serves `dist/`, which
[`scripts/build-frontend.mjs`](../scripts/build-frontend.mjs) assembles from
[`web/`](../web) (student app at the root) and [`setup/index.html`](../setup/index.html)
(the protected form under `/setup/`). `push` never builds, so run `npm run deploy`
(build + push) or `npm run build` before `tgcloud push`.

## How it opens

- A private `/start` or `/help` sends an inline **باز کردن مینیاپ درسها** button. This is
  the entry point that always works, for every student.
- `/setup` still sends the cooperation-form button, now pointing at `/setup/`.
- [`scripts/configure-bot.mjs`](../scripts/configure-bot.mjs) (via `endpoints/configureBot`,
  owner only) requests the app as the **chat menu button** and reports what is actually in
  effect. Checked on the live bot on 2026-10-16: the per-chat button takes effect, while the
  **bot-wide default stays `commands`** even though `setChatMenuButton` answers `true` — that
  default belongs to BotFather for this bot. To get the blue button next to the message box
  for everyone, set it once in BotFather: `/mybots` → the bot → **Bot Settings** →
  **Menu Button** → the app URL `https://app8298297292.tgcloud.ai/`. Only the bot owner can
  do this, and it is a profile setting, not code.

## Server side: one endpoint

`tgcloud/endpoints/student.js` — the front-end calls it with
`Telegram.WebApp.Serverless.call('student', { action, … }, …)`, so the platform
verifies the init data before the module runs.

| action | who | what it returns |
|---|---|---|
| `home` (default) | anyone | coverage health, every covered course, the caller's own state, policy text |
| `courses` | anyone | the same coverage summary and course list |
| `course` | anyone | one course with a filtered, paged list of its activities |
| `feed` | anyone | assignments/exams/files across all courses, or only the caller's |
| `help` | anyone | privacy text, chat commands, contact |
| `register` | the caller | exact-name matching for the displayed VC name, then a fresh payload |
| `stop` / `resume` | the caller | the same notification controls as `/stop` and `/resume` |
| `forget` | the caller | deletes the caller's subscription row (Telegram id, name, courses, receipts) |

Notes that matter:

- **Isolation.** Personal actions read and write only `ctx.initData.user.id`. A
  `tgId`/`userId`/`chatId` in the request body is ignored — the test asserts a forged id
  cannot touch another subscriber. Without a caller, personal actions are refused with
  `NO_USER`; public actions still work (and create no row).
- **Nothing sensitive leaves.** Responses never contain a credential, an account id, a
  participant roster, a Moodle participant id, the long university code, `codeFromName`
  or `siteCode`. `lib/student-view.js` builds every course/item view and drops
  credential-bearing or foreign links (`universityUrl`), the same rule the notification
  formatter applies.
- **Class identity.** A class is shown as its weekly time if one is configured,
  otherwise its two-digit class number, plus the professor taken from Participants
  `استاد` rows (`directorySummary`). Course `counts` come from the saved baseline.
- **Freshness.** Every payload carries `coverage.check` (`fresh` / `aging` / `stale` /
  `unknown`, with the scan time) and `coverage.partial` when the last scan missed
  courses. The per-course `scan` uses the snapshot's own `updated_at` (unknown for
  baselines written before that column existed). The UI says "stored information" rather
  than showing an old scan as if it had just run.
- **Two clocks, kept apart.** `coverage.check` follows the *newest* per-course reading,
  so the header badge cannot contradict the per-course times, while
  `coverage.recorded` reports the last scan that finished and stored its summary — its
  own time, failures and lost coverage — with `recorded.olderThanReads` marking the two
  apart. This is the real shape of the data while the number of connected accounts is
  still growing: on 2026-10-16 a scan read courses at 13:35 but the summary on record was
  from 11:10, and the app must not call a 3-hour-old summary "fresh" *or* hide the fact
  that reads are newer.
- **Reuse, not duplication.** Registration (`registerStudent`), exact participant
  matching, coverage refresh, notification seeding and the pause/resume/delete controls
  all live in `lib/subscriptions.js` and are the same code the chat commands call — the
  chat's `/register`, `/stop` and `/resume` were refactored onto them so the two surfaces
  cannot drift.
- **No schema change**, so no migration is needed for this app.

## Front end: `web/`

Plain ES modules (no npm packages, no bundler, nothing to keep in step). Five tabs —
خانه (coverage, my courses, registration), درسها (search + course detail), تکلیفها
(feed with kind and scope filters), من (registration state, notification toggle,
deletion), راهنما (steps, privacy, cooperation, contact).

- Calls only `Serverless.call('student', …)`; it never reads `initDataUnsafe` and never
  hand-rolls an API request.
- Renders server text through `escapeHtml`; no payload is assigned as raw HTML.
- Follows the Telegram theme (`themeParams`, `themeChanged`) with light/dark fallbacks,
  safe-area insets, and reduced-motion support.
- States: loading skeletons, empty lists, partial coverage, stale/unknown scans, a
  retryable error banner, and a blocking overlay with an explanation while a
  registration lookup runs (it can take up to a minute).
- The field, prompt and hint for the VC display name come from the server payload, so the
  client never restates policy and no login username is ever requested.

## Reviewing the UI without Telegram

`.freebuff/ui-preview/` holds a mock Telegram client (not deployed, not in `dist/`):

```
node .freebuff/ui-preview/server.mjs
# then open http://127.0.0.1:<printed port>/.freebuff/ui-preview/index.html
#   ?state=registered (default) | unregistered | stale | split | error | empty | registering
```

`?state=split` is the two-clocks case above: a completed scan 12 hours old next to
course reads 11 minutes old.

## Tests

- `tests/student-view.test.js` — pure view rules: freshness, link filtering, class
  labels, buckets/paging, caller state, coverage health.
- `tests/fixtures/student-endpoint.mjs` (run by `tests/student-endpoint.test.js`) — the
  real endpoint against a fake platform: public browsing creates no row, registration
  detects only matched courses, ambiguous names register nothing, one caller cannot read
  or stop another, a forged id is ignored, stop/resume/dedupe/delete behave, new coverage
  matches registered users without reactivating a stopped one, and no payload leaks a
  credential, roster or long code.
- `tests/student-app.test.js` — the UI is RTL Persian with usable states, calls only the
  student endpoint through the verified call, never asks for a login username, and the
  build output plus the `/setup/` URL coupling are correct.
- `tests/fixtures/public-runtime.mjs` — the chat still offers the app button and keeps
  working after the shared-service refactor.

## Limitations

- A registration lookup reads Participants course by course and can take up to a minute;
  a second lookup inside a minute is refused (cooldown).
- Name matching is not identity verification: an exact displayed-name match registers the
  courses, ambiguous names are rejected and need `@Arsam_alaei`.
- The feed's order is course order, then module order — KNTU exposes deadlines as text, so
  items are not sorted by deadline.
- A course whose baseline predates `snapshots.updated_at` shows no per-course check time;
  the header still shows the last scan.
- The 30-minute schedule is driven from outside Telegram, and the Cloudflare Worker sends
  its **own bundled copy** of `tgcloud/` with each scheduled call
  ([docs/cloudflare-setup.md](cloudflare-setup.md)). Redeploy that Worker after changing
  checker or notification code, otherwise scheduled runs keep the previous logic while
  the Mini App already serves the new one.

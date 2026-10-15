# KNTU Aid Bot

Telegram Serverless bot for [@KNTU_aidbot](https://t.me/KNTU_aidbot). It follows enrolled
Moodle courses at <https://vc.kntu.ac.ir> for a small set of university accounts and
posts new/changed course activities into one chosen group/topic.

- Telegram Serverless app: `app8298297292`
- Setup Mini App: <https://app8298297292.tgcloud.ai/>
- Bot owner (`OWNER_ID`): `747977517`, set in [`tgcloud/lib/config.js`](tgcloud/lib/config.js)

## Current state (verified 2026-10-15)

- Code deployed, database migrated **additively** (three new tables, two new columns);
  message webhook in sync. No table or credential was dropped or rewritten.
- The single legacy credential was migrated into account `acc_legacy_owner`
  (owner `747977517`, label «حساب اصلی») by a one-time, idempotent step that runs on
  the first scan. `settings.university` is left untouched and is no longer read.
- A live scan read **all nine** enrolled courses through that account with **0 baselined
  and 0 sent**, proving the existing baselines survived the key change and nothing was
  announced again. 0 failures, 0 lost coverage.
- Destination is still the preserved legacy chat `-5539552606` (main topic). It has
  **not** been changed; the owner binds the new group/topic with `/bind`.
- Class/professor directory deployed (two more additive tables). Every one of the nine
  courses' full 13-digit codes was discovered automatically from the site in a single
  request; professor names were confirmed to be absent from the site (see below).
- Automatic checks are **not active yet** — the workflow exists, the repository secret
  and the scheduled run are the remaining step (below).
- 37 local tests pass (`npm test`); they use reduced site markup and mocked API responses,
  and they never touch the network.

## How a check works

1. Every **enabled** account is read with its own credential; a failure only removes that
   account from the run. Accounts the owner approved connect their own session.
2. Enrollment is discovered per account (calendar course selector in session mode,
   `core_enrol_get_users_courses` in token mode) and merged into one plan.
3. A course is identified by **university origin + Moodle course id**, so overlapping
   enrollment is counted once; courses with the same name but different ids (other
   section/professor) stay separate. Activities are identified by their module id within
   the course. Readers are tried in discovery order: if one account's session expired or
   it cannot read a course, the next account that covers it is used.
4. **One shared baseline per course** (`snapshots`, key `origin#courseId`), independent of
   which account read it. Baselines written by the single-account version (plain course id)
   are still honoured.
5. New items and content changes are announced into the destination; an "update" that only
   *removes* information (missing dates/description/fewer attachments) is what a
   less-privileged account sees for the same activity, so it is absorbed silently
   (`absorbed` in `/status`) instead of producing a false update. The richer observation is
   kept, so switching accounts cannot make a baseline flap.
6. **A newly discovered course is recorded silently** and added to the pending-digest list.
   The owner can publish its current contents once with `/digest` (or `/digest <courseId>`).
7. Per-account health, pending digests and the run summary are stored in `settings.status`
   and shown by `/status` and the Mini App.

## Classes, professors and weekly times

**What the site does and does not expose** (checked against the live site on 2026-10-15,
with the connected session, plus the public pages):

- The **class number is on the site**, as the trailing two digits of the 13-digit code.
  The enrolled course's own name carries only the group code (`آز فيزيك2 [4051]`), but the
  **«درس‌های من» sidebar block** — rendered on the dashboard and on every course page — lists
  each course as `آز فيزيك2 [4051-1110274-23]`, and the public course categories do the same.
  One page therefore yields a `Moodle course id → full code` map for the whole enrollment,
  which `/class <id> detect` and the Mini App store as the class's number.
- The **professor's name is nowhere on the site**: course pages mark no teacher
  (`teachers: []` on every course), no course contacts are rendered, public listings show
  only the code, and the only user link on a course page is the logged-in student. That is
  why the professor comes from this bot's own directory, not from scraping.
- Codes are printed `<group>-<course>-<section>`, e.g. `4051-1110274-23`; a code read
  right-to-left (as it appears to the eye in an RTL line) looks like `23-1110274-4051`.
  The class/section is the field that differs per professor, and `deriveLabel` uses the
  trailing 2-digit field, falling back to the leading field. Override per course with
  `/class <id> label <x>` if you prefer a different label.

The nine courses read on 2026-10-15, with the codes the site returned (auto-discovered, so
nothing here has to be typed):

| Moodle id | Course (site name) | Site code | Class |
|---|---|---|---|
| 120 | آز فيزيك2 `[4051]` | 4051-1110274-23 | 23 |
| 39 | آزمدارهاي الكتريكي و اندازه گيري `[4051]` | 4051-1110242-22 | 22 |
| 80 | الكترومغناطيس مهندسي `[4051]` | 4051-1110258-12 | 12 |
| 82 | الكترونيك 1 `[4051]` | 4051-1110259-11 | 11 |
| 3 | رياضيات مهندسي `[4051]` | 4051-1110001-11 | 11 |
| 20 | سيستمهاي ديجيتال 1 `[4051]` | 4051-1110239-11 | 11 |
| 168 | كارگاه برق `[4051]` | 4051-1112034-12 | 12 |
| 25 | مدارهاي الكتريكي 2 `[4051]` | 4051-1110241-11 | 11 |
| 861 | مهارتهاي زندگي دانشجويي `[4051]` | 4051-5505050-52 | 52 |

Because one course *name* is taught by many professors in different sections, and a section
is exactly one Moodle course, the binding is **per course id**: two professors of the same
course are two separate rows, never merged.

### Binding it

Owner-only, in the bot's private chat:

```
/classes                          # every covered course: site code, class, professor, times
/class 120                        # one course: name code, site code, current binding
/class 120 detect                 # read the course page and record what the site shows
/class 120 code 4051-1110274-23   # set/override the code (also derives the label)
/class 120 label 23               # set the class label
/class 120 prof استاد طباطبایی     # professor name…
/class 120 prof 4051              # …or a professor code resolved through /prof
/class 120 slots یک‌شنبه 10:00-11:30، سه‌شنبه 8:00-9:30
/class 120 clear                  # remove the binding
/prof 4051 استاد طباطبایی          # professor code → name
/prof del 4051                    # remove the mapping
/prof                             # list the mapping
```

Class times are all-or-nothing: a half-parsed schedule is rejected rather than stored, and
Persian digits, `تا`/`-` ranges and Persian weekday spellings (with or without ZWNJ) are
accepted. The Mini App has the same editor under **Classes & professors**, with a
**بررسی سایت** button per course that shows exactly what the site returned.

The same owner-only rules apply as for accounts: `/class`, `/classes` and `/prof` work only in
the private chat of the configured owner, and only the endpoint's `list` action is available
to a regular approved account holder (a student needs to know which class a notice belongs
to, but must not edit the directory).

### What a notice looks like

Every group notice and digest leads with the class identity, so a student can tell at a
glance whether the activity is for their class:

```
مورد جدید — 📝 تکلیف
🏫 کلاس 22 — کد 4051-1110242-22 — استاد طباطبایی — یکشنبه 10:00-11:30
آزمدارهاي الكتريكي و اندازه گيري [4051]
پیش‌گزارش آزمایش اول
مهلت: سه‌شنبه، 21 مهر 1405، 9:00 صبح
https://vc.kntu.ac.ir/mod/assign/view.php?id=3570
```

The class line appears whenever any part is known: the site code alone already names the
class (`🏫 کلاس 23 — کد 4051-1110274-23`), a professor name is added when bound, and weekly
times are appended when set. `/assignments` and `/exams` use the same composer, so their
lists are attributable too. Only course *teaching* information is stored — no grades,
submissions, attempts or participant lists.

## Accounts

Model: `accounts` (stable `id`, `owner_id` Telegram id, `label`, `mode`, credential,
`enabled`, `health`) plus `contributors` (the Telegram users the owner approved).
A contributor can only create/update **their own** connection; the owner manages all.

1. **Holder asks for access.** They open the bot in private and send `/start`. The bot
   replies with their numeric ID and notifies the owner once (30-minute cooldown).
2. **Owner approves.** In the bot's private chat: `/approve <telegram id> [label]`
   (revoke later with `/revoke <id>`; revocation disables that person's connections and
   deletes nothing).
3. **Holder connects their own account.** `/setup` → **University connection** → pick
   *Moodle API token* (preferred when the university enables web services) or *Moodle
   session*, paste only that value, press **Test connection and save**. The credential is
   verified against the university, then stored in the bot's private Telegram database.
   Nothing is saved if the test fails.
4. **Renewal.** Same page: **Renew** on the account row, or `/setup` again. Session
   credentials expire; a `MoodleSession` value also cannot be obtained by logging in to the
   browser — it must be copied from the browser's cookies for `vc.kntu.ac.ir` while logged in.
5. **Disable / delete.** The Mini App can disable, enable, rename or delete a connection.
   Deleting an account never deletes baselines, so re-adding it cannot re-announce the course.

**Credentials are never accepted in a chat and never leave Telegram.** They are sent to the
endpoint over Telegram's verified Mini App call, stored in the bot's database, returned
nowhere (`hasCredential: true/false` only) and printed nowhere. The bot only ever talks to
`https://vc.kntu.ac.ir`: any other origin is refused before a request is made.

## Destination group and topic

Only the configured owner may bind it, and only a chat the bot can actually post to.

- Send `/bind` **inside the target group or its topic** (as the owner). The bot sends a
  confirmation to that exact chat/topic first — that proves send access — and only then
  replaces the stored destination. `/bind` in a topic stores `chat_id` **and**
  `message_thread_id`; every notification and digest then carries `message_thread_id`.
- `/destination` shows the effective target and its source (`bind` or the preserved `legacy`
  value). `/unbind` clears it (notifications stop until the next `/bind`).
- Ordinary group message privacy stays enabled: the bot reads only commands addressed to it,
  never group conversation.

## Commands

| Command | Where | Who |
|---|---|---|
| `/start`, `/help` | private | anyone (unapproved users get instructions) |
| `/id` | anywhere | anyone |
| `/setup` | private | owner and approved account holders |
| `/check` | private | owner |
| `/status` | private | owner — account health, destination, last run, pending digests |
| `/accounts` | private | owner (all accounts) / holder (their own) |
| `/approve <id> [label]`, `/revoke <id>` | private | owner |
| `/bind` | destination group/topic | owner |
| `/destination`, `/unbind` | private | owner |
| `/digest [courseId …]` | private | owner — publish pending initial digests |
| `/classes` | private | owner — covered courses with class code, professor, weekly times |
| `/class <courseId> …` | private | owner — bind code/label/professor/slots, `detect`, or `clear` |
| `/prof <code> <name>` | private | owner — professor code → name (delete with `/prof del <code>`) |
| `/courses`, `/assignments`, `/exams` | destination group or owner private | anyone in that group |

## Automatic checks (GitHub Actions)

Telegram Serverless 0.2 has **no** timer/cron trigger — rechecked against
<https://core.telegram.org/bots/serverless> (October 2026): it documents update handlers and
Mini App endpoint calls only, and `tgcloud run` as a manual/CI entry point. So the schedule
lives outside Telegram in [`.github/workflows/check.yml`](.github/workflows/check.yml) while
the bot and its database stay on Telegram.

What the workflow does: `workflow_dispatch` plus `cron: '4,19,34,49 * * * *'` (every 15
minutes, offset from minute zero), `contents: read`, a serialized `concurrency` group so two
checks never overlap, a 12-minute job timeout, `npm ci`, `npm test`, then
`node scripts/check.mjs`.

`scripts/check.mjs` runs `endpoints/check` in the cloud through the authenticated CLI with an
owner init-data context. Note that **`tgcloud run` executes this repository's local source on
Telegram without deploying it** — so keep the workflow's checkout and the deployed code in
sync. It fails the job (non-zero) when the endpoint fails, when the run had partial failures,
lost coverage or an expired session, or when it exceeds its own 5-minute bound, and it scrubs
the token from anything it prints.

### One-time setup

1. Create a **private** GitHub repository and push this project (see below). Never commit
   `.tgcloud/`, cookies, tokens or `.env` files — [`.gitignore`](.gitignore) already excludes them.
2. Add the repository secret **`TGCLOUD_TOKEN`**: GitHub → *Settings → Secrets and variables →
   Actions → New repository secret*. The value is the `app<id>:<secret>` **CLI access token**
   from BotFather → @KNTU_aidbot → *Serverless*, **not** the Bot API token. Enter it directly
   in GitHub's form — it must never be typed into a chat, a file or a command line.
3. The workflow sets `BOT_OWNER_ID: '747977517'`; `scripts/check.mjs` refuses to run when it
   disagrees with `OWNER_ID` in [`tgcloud/lib/config.js`](tgcloud/lib/config.js).
4. Enable Actions, then run the workflow once from *Actions → Course checks → Run workflow*.
   Confirm it is green, then leave the schedule on.
5. Verify the schedule: after ~15 minutes open the latest scheduled run. GitHub delays
   scheduled runs under load (often 5–20 minutes) and disables them after long repository
   inactivity; the interval also consumes that account's Actions minutes, so keep the repo
   private and check *Settings → Billing* if runs stop.

### ⚠️ What the token grants

`TGCLOUD_TOKEN` can read and change this bot's **code and database**. Store it only as a
repository secret of a private repository and rotate it in BotFather if it leaks. University
cookies are deliberately **not** copied to GitHub: credentials stay in Telegram's database.

### Runbook

- Job red with `COVERAGE_LOST` / `ACCOUNTS_FAILED`: `/status` in the bot shows which account
  is `auth` (expired) — that holder renews their session in the Mini App. Account holders get
  a private warning (6-hour cooldown); the owner gets one for lost coverage (3-hour cooldown).
  The public group never sees authentication errors.
- Job red with `ALL_ACCOUNTS_UNAVAILABLE`: every account is unreadable — renew at least one.
- Deliveries already sent are not repeated after a failure; see "Limits".

## Coverage and limits (honest)

- Read per course: modules, visible descriptions and dates, assignment introduction
  attachments, and quiz open/close from the API. **Not** read: forum replies, folder
  internals, PDF contents, and binary files replaced at an unchanged URL. That limitation is
  unchanged by the multi-account work — expanding it is future work, not a claim.
- Only course teaching information is collected. Grades, submissions, private messages, quiz
  attempts and participant lists are never read or published, and no submission or
  quiz-attempt operation exists in this codebase.
- Professor names and weekly class times are **entered by the owner**, not scraped: the site
  does not publish them (verified per course). Auto-detected codes come from the site and are
  stored as `settings.siteCourseCodes`; a manual `/class … code` binding always wins.
- Class labels are a display aid derived from the code's trailing field. They do not change
  course identity, which remains university origin + Moodle course id.
- Persian text and dates are preserved. Published links are normal university links with any
  `token`/`wstoken`/`sesskey`/`password` query parameter stripped; the reader may still need
  to log in to the university to open them.
- A course's read failure leaves its previous snapshot intact and is reported per account (one
  failing account/course never stops the others). Deleted activities leave the snapshot silently.
- Delivery is **at least once**: a message is acknowledged only after Telegram accepts it, so a
  crash or a failed save after a successful send can duplicate one message. A database lease
  (`leases.scan`, 10 minutes) prevents overlapping scans and is released in a `finally` block.
- Absorbing "reduced" updates means a real *removal* of information (for example a teacher
  deleting the description or an attachment) is not announced; only genuinely new or changed
  content is. `/status` counts these as `absorbed`.
- First scans of newly enrolled courses are silent by design — use `/digest` to announce them
  on purpose. No deadline-reminder service and no per-user completion tracking are implemented.

## Development

```
npm test                     # 37 unit tests: parsing, change detection, accounts, routing
npx.cmd tgcloud status       # what differs locally vs the cloud
npx.cmd tgcloud push         # deploy modules + the setup/ static site
npx.cmd tgcloud migrate --safe   # apply additive schema changes (separate from push)
npx.cmd tgcloud webhook      # confirm the webhook matches handlers/
```

Windows note: the `tgcloud` `.cmd` shim mangles quoted JSON arguments, so run a module with
the CLI's JS entry instead:

```
node node_modules/@tgcloud/cli/bin/tgcloud.js run endpoints/accounts '{"action":"list"}' --ctx '{"initData":{"user":{"id":747977517}}}'
```

`docs/tgcloud-sdk.md` is the official SDK reference for the deployed runtime (`sdk`, `sdk/db`).

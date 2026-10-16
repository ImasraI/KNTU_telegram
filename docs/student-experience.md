# Public student experience

All student-facing responses and the cooperation Mini App are Persian.
Public `/start`, `/help`, `/courses`, `/assignments` (alias `/assignment`) and
`/exams` do not require contributor approval. They show only shared course
material, not credentials or participant rosters. Private activity lists use a
confirmed personal course selection when one exists. An optional course id and
page number paginate activity results: `/assignments 3 2`; `0` means all/selected.
The owner uses `/admin` for administration; those commands are absent from the
public help and default command menu. `/setup` and account management remain
restricted to approved contributors and the owner.

## Personal opt-in

`/register` collects a VC username, then asks for the exact displayed full name.
KNTU's Participants page exposes names and Moodle user ids, not login usernames.
The bot does not pretend that a Moodle id is a username. Exact normalized full
name matches (including later participant pages) propose courses for review.
Ambiguous matches are rejected; unavailable lists are reported as incomplete.
Only covered courses can be found. A name match is not identity verification.
The lookup reads rosters transiently and retains no complete roster.

`/select 3 82` also proposes covered courses manually. `/confirm` within 30
minutes is required before delivery starts. `/cancel` discards a pending change.
`/mycourses` shows the user's settings. `/stop` immediately disables future
private sends (an already in-flight send may finish). `/resume` starts with the
current baseline, avoiding a flood of paused history. `/forget` deletes the
subscription; it does not silently delete a separately contributed connection.

Subscriptions have their own per-item receipts. Every successful scan checks
saved course snapshots for unseen new/updated activities. Initial confirmation
seeds existing items without sending them. Failed private sends are retried on a
future scan; a blocked bot deactivates that subscription. Each scan attempts up
to 100 private messages and stops on rate limits. Under load, pending updates
can take additional scan intervals. Intermediate edits can coalesce into the
latest version. Telegram sending and recording a receipt are not transactional:
a crash after delivery but before recording can cause a repeat. Membership is
not reselected silently; students re-register or select again when courses change.

## Cooperation and deployment

`/cooperate` explains voluntary sharing, approval by @Arsam_alaei, cookie/API
token entry through the private Mini App, renewal, removal and the access risks.
It makes no zero-risk or anonymity guarantee. University passwords are not used.
The bot does not collect grades, submissions or private messages. The bot owner
with administrative access can access stored credentials; normal users cannot.

Deploy the additive `subscriptions` table with `tgcloud migrate --safe` as well
as pushing the modules/static page. Run `node scripts/configure-bot.mjs` once to
install Persian public menus and the owner's scoped `/admin` command. The
Cloudflare source bundle must rebuild after these changes before scheduled
checks use the subscription delivery logic. Tests include a mocked runtime
covering public access, opt-in, retries, isolation, stop/resume and deletion.

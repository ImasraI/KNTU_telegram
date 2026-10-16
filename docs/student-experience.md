# Public student experience

All student-facing responses are Persian. The public **student Mini App**
(<https://app8298297292.tgcloud.ai/>, see [docs/student-app.md](student-app.md)) shows the
same course data in a browsable RTL page and performs the same registration and
notification controls through shared services, so chat and app agree by construction. The
cooperation form keeps its own protected path at `/setup/`.
Public `/start`, `/help`, `/courses`, `/assignments` (alias `/assignment`) and
`/exams` do not require contributor approval. They show only shared course
material, not credentials or participant rosters. Private activity lists use a
automatically detected personal course list when one exists. An optional course id and
page number paginate activity results: `/assignments 3 2`; `0` means all/selected.
The owner uses `/admin` for administration; those commands are absent from the
public help and default command menu. `/setup` and account management remain
restricted to approved contributors and the owner.

## Personal registration

`/register` asks for exactly one thing: the name the university shows for you in
VC Participants, for example `Arsam Alaei`. The requested field is labelled
«نام کامل در VC» so it is never confused with login credentials; no login
username, student number, password, cookie or token is asked for, validated or
stored. The same full name can be sent directly with `/register Arsam Alaei` in one
message. Someone still waiting at the removed login-username stage of an earlier
version is asked only for the displayed full name, so an in-progress registration
never gets stuck; the old value is dropped rather than kept.
KNTU's Participants page exposes names and Moodle user ids, not login usernames.
The bot does not pretend that a Moodle id is a username. Exact normalized full
name matches (including later participant pages) activate courses automatically.
No selection or confirmation step is shown. Ambiguous matches are rejected;
unavailable lists are reported as incomplete, with a note to contact @Arsam_alaei.
Only covered courses can be found. A name match is not identity verification.
The lookup matches against a server-side roster cache — one entry per course,
held in private settings, keeping only the displayed name and the Moodle
participant id. Student-facing responses never include it, and nothing is sent
to the university from inside a request.

The same registration runs in the Mini App's **من** tab: one field for the displayed VC
name, no selection screen, and the same cooldown, ambiguity and incomplete-coverage
reporting.

Legacy `/select` applies covered courses immediately; `/confirm` remains only
for compatibility with old pending registrations. Neither is requested in the
normal flow. `/cancel` cancels an in-progress registration.
`/mycourses` shows the user's settings. `/stop` immediately disables future
private sends (an already in-flight send may finish). `/resume` starts with the
current baseline, avoiding a flood of paused history. `/forget` deletes the
subscription; it does not silently delete a separately contributed connection.

Subscriptions have their own per-item receipts. Every successful scan checks
saved course snapshots for unseen new/updated activities. Initial registration
seeds existing items without sending them. Failed private sends are retried on a
future scan; a blocked bot deactivates that subscription. Each scan attempts up
to 100 private messages and stops on rate limits. Under load, pending updates
can take additional scan intervals. Intermediate edits can coalesce into the
latest version. Telegram sending and recording a receipt are not transactional:
a crash after delivery but before recording can cause a repeat. Membership is
added automatically when new coverage reveals a matching participant. Existing
courses are not removed when an account exposes a reduced roster. New connections
set a coverage-refresh marker, so the next scheduled scan rematches missing
courses. Other missing/inaccessible matches retry later; negative results cache
for a day. Matching reads each roster once for all candidate subscribers and uses
the stable Moodle participant id once known. Stopped users get updated course lists
without being reactivated. Existing activities in newly added courses are seeded
without flooding the inbox. A user with zero matches stays registered for future
coverage; homonyms require owner assistance.

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

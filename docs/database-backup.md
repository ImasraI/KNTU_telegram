# Shared database snapshot in Cloudflare

A private export of the restored Telegram database was captured on 2026-10-17
(Asia/Tehran), copied to the dedicated D1 database `kntu-shared-bot`, and verified
row-for-row against the source export. All 9 tables / 156 rows matched. The SQL
schema and explicit indexes were copied, along with credentials, cached rosters,
course snapshots, subscriptions, settings, permissions, and notification receipts.
The personal VC database is separate and was not modified.

`shared/wrangler.jsonc` deploys the authenticated shared D1 query service.
**Live shared bot storage now uses Cloudflare D1.** Telegram still runs the chat
handlers and Mini App endpoints; all application database calls import
`tgcloud/lib/database.js`, which uses the D1 service. There is no automatic
fallback to Telegram's database. The original `tgcloud/schema.js` remains the
schema/column metadata and legacy recovery reference.

A final export was captured after shared writes were paused, imported, and
compared row-for-row before enabling D1 writes. All 156 rows matched that final
snapshot. Final Telegram JSON SHA-256:
`b6b3c64b754ca4f0cdb5deecd82d649fca147b86e0008d1676d5f95d83faaa0d`.
The personal VC Worker/database and its encryption key were not changed.

Private JSON and SQL backups and the verification report are stored outside the
repository, in the sibling `KNTU_backups` directory. They contain credentials and
personal data; never commit or share them. Snapshot JSON SHA-256:
`fa9e04050bd19ca6ef405d582d4c1fc94b4ca36fe009f4ad946af582d956333e`.

To back up the live Cloudflare database through the authenticated bot CLI:

```powershell
node scripts/backup-telegram.mjs
```

The script invokes the authenticated CLI with a temporary owner-only export
module. It prints counts/checksum only, never records. Add `--telegram` to export
the legacy Telegram database instead. It removes the temporary
module afterward and does not deploy it. The export reads tables sequentially;
quiesce bot writes for an atomic cutover, or take and compare a final export.
Backups here are private plaintext files, not encrypted archives.

## Deploying after cutover

The database service and scheduler each have a Cloudflare `DATABASE_KEY` secret.
Telegram's SDK has no documented environment-secret API; its backend therefore
uses a generated, gitignored `tgcloud/lib/database-secret.js` module. It contains
the same bridge key and is never sent to Mini App clients or committed to Git.
The owner has a private recovery copy in the sibling backup directory.

A new trusted checkout needs that key in the `DATABASE_KEY` environment variable,
then `node scripts/prepare-database.mjs` or `npm run deploy`. The preparation script
writes the ignored module. Do not generate a different key on a new checkout:
it must match the service's existing secret. Never put it in source control or
command-line arguments.

The Cloudflare scheduler bundle deliberately excludes the private local module
and injects it from its Worker secret at invocation time. The active schedule is
unchanged: minutes 04 and 34 each hour. GitHub's duplicate cron is removed; its
manual workflow needs both `TGCLOUD_TOKEN` and `DATABASE_KEY` repository secrets.

Use owner-only `endpoints/checkD1Storage` to verify table counts and course data;
`{probe:true}` also inserts/reads/deletes a disposable settings record. The service
rejects unauthenticated requests and schema-changing SQL, does not log request
bodies, and returns generic errors. Set its `MAINTENANCE_MODE` variable to `1` to
pause mutations during a coordinated future import; live operation uses `0`.

Keep Telegram's old data intact for recovery. A rollback is not simply a code
revert: new D1 writes would first need to be synchronized back. All active
Telegram and scheduled deployments must use the same backend.

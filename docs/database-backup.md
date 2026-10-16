# Shared database snapshot in Cloudflare

A private export of the restored Telegram database was captured on 2026-10-17
(Asia/Tehran), copied to the dedicated D1 database `kntu-shared-bot`, and verified
row-for-row against the source export. All 9 tables / 156 rows matched. The SQL
schema and explicit indexes were copied, along with credentials, cached rosters,
course snapshots, subscriptions, settings, permissions, and notification receipts.
The personal VC database is separate and was not modified.

`shared/wrangler.jsonc` names the shared D1 database. It is not yet the live bot
backend: Telegram code still imports `db` from `sdk`. Future live cutover needs a
D1 data-access implementation and a final synchronized export before switching
writes. Do not treat this snapshot as ongoing replication.

Private JSON and SQL backups and the verification report are stored outside the
repository, in the sibling `KNTU_backups` directory. They contain credentials and
personal data; never commit or share them. Snapshot JSON SHA-256:
`fa9e04050bd19ca6ef405d582d4c1fc94b4ca36fe009f4ad946af582d956333e`.

To take another private Telegram backup while the database is accessible:

```powershell
node scripts/backup-telegram.mjs
```

The script invokes the authenticated CLI with a temporary owner-only export
module. It prints counts/checksum only, never records. It removes the temporary
module afterward and does not deploy it. The export reads tables sequentially;
quiesce bot writes for an atomic cutover, or take and compare a final export.
Backups here are private plaintext files, not encrypted archives.

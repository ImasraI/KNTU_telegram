# Free Cloudflare scheduler

The Worker triggers the existing check on Telegram every six hours. The bot,
database, and university sessions stay on Telegram. It exposes no HTTP trigger.

From the repository root, run `npx wrangler deploy --config cloudflare/wrangler.jsonc`, then
`npx wrangler secret put TGCLOUD_TOKEN --config cloudflare/wrangler.jsonc`. Enter the BotFather CLI access token
directly at the hidden prompt. Do not commit tokens or put them in wrangler config.
The build bundles only `.js` source files from `tgcloud/`, never `.tgcloud/` state.

Cron: `4 */6 * * *` UTC, or 03:34, 09:34, 15:34, 21:34 Tehran.
Cloudflare's Free plan has limits; four scheduled invocations per day should be
well within its request allowance. Monitor CPU limits and invocation failures.
No paid database, domain, or storage is required.

This adapter mirrors the management request used by `@tgcloud/cli` 0.2.0.
Telegram can change that protocol. The CLI token grants broad control of the bot;
store it only as a Worker secret. Remote response bodies are not logged.

The Worker executes its bundled copy of the Telegram code (just like CLI `run`).
Redeploy the Worker whenever checker code changes. Tests rebuild the source bundle.
Run `npm test` from the repository root before deploying.

Verify a live invocation in Cloudflare logs before disabling GitHub's schedule.
A successful check sends no group message if there are no new course items.
Expired university sessions still require renewal through the Mini App.

// Configure Persian public command menus without reading CLI credential files.
import { spawnSync } from 'node:child_process';
import { OWNER_ID } from '../tgcloud/lib/config.js';
const result = spawnSync(process.execPath, [
  'node_modules/@tgcloud/cli/bin/tgcloud.js', 'run', 'endpoints/configureBot', JSON.stringify(process.argv.includes('--verify') ? { action: 'verify' } : {}),
  '--ctx', JSON.stringify({ initData: { user: { id: OWNER_ID } } }),
], { encoding: 'utf8', timeout: 120000 });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;

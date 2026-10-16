// Owner maintenance command: detect course metadata without posting to the group.
import { spawnSync } from 'node:child_process';
import { OWNER_ID } from '../tgcloud/lib/config.js';
const result = spawnSync(process.execPath, [
  'node_modules/@tgcloud/cli/bin/tgcloud.js', 'run', 'endpoints/directory',
  JSON.stringify({ action: 'detect', limit: 100 }), '--ctx',
  JSON.stringify({ initData: { user: { id: OWNER_ID } } }),
], { encoding: 'utf8', timeout: 300000 });
// CLI uses its existing authenticated state; never access credential files.
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;

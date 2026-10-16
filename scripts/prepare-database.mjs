// Provision a private Telegram module from an environment secret. The SDK has
// no documented environment-secret API, so never commit this generated module.
import {existsSync,writeFileSync} from 'node:fs';
const path=new URL('../tgcloud/lib/database-secret.js',import.meta.url);
if(process.env.DATABASE_KEY) {
  if(!/^[a-f0-9]{64}$/.test(process.env.DATABASE_KEY)) throw new Error('DATABASE_KEY must be the provisioned bridge key.');
  writeFileSync(path,'export const DATABASE_KEY = '+JSON.stringify(process.env.DATABASE_KEY)+';\n',{mode:0o600});
} else if(!existsSync(path)) {
  throw new Error('Missing private database configuration. Supply DATABASE_KEY from the owner, then rerun deployment. Never commit it.');
}

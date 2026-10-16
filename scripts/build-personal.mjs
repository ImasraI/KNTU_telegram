// Personal and main Mini Apps share the same design tokens and components.
import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../web/app.css', import.meta.url), new URL('../personal/public/theme.css', import.meta.url));
console.log('Personal Mini App: shared main-app theme synchronized.');

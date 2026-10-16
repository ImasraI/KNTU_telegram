// Public identifiers and policy constants only. No credentials live here.
export const OWNER_ID = 747977517;
// Fallback destination; the database value (settings.destination / settings.groupId)
// wins. A zero value prevents sending until a destination is bound.
export const GROUP_ID = 0;
export const BASE = 'https://vc.kntu.ac.ir';
// Deployed setup Mini App (printed by `tgcloud push`).
export const MINI_APP_URL = 'https://app8298297292.tgcloud.ai/';
// Deploy personal/wrangler.jsonc first; set its HTTPS root URL here.
// Empty means disabled. Never place credentials in this URL.
export const PERSONAL_APP_URL = '';
// The only university origin this bot talks to. Requests to any other origin are
// refused before they are made (see lib/moodle.js).
export const ORIGIN = BASE;

// Private-warning cooldowns, in milliseconds.
export const SESSION_NOTICE_COOLDOWN_MS = 6 * 60 * 60 * 1000;   // account holder, expired session
export const COVERAGE_NOTICE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // bot owner, lost course coverage
export const APPROVAL_NOTICE_COOLDOWN_MS = 30 * 60 * 1000;     // bot owner, new user wants to connect

// Initial-digest message bound (items per course, items per message).
export const DIGEST_MAX_ITEMS = 15;
// Upper bound of accounts the scan will read, to keep a check within its lease.
export const MAX_ACCOUNTS = 8;

// The nine reference courses of the single-account era. Kept only as a fallback
// label source; every scan discovers enrollment afresh.
export const COURSES = [
  [120, 'آز فيزيك2'], [39, 'آزمدارهاي الكتريكي و اندازه گيري'],
  [80, 'الكترومغناطيس مهندسي'], [82, 'الكترونيك 1'],
  [3, 'رياضيات مهندسي'], [20, 'سيستمهاي ديجيتال 1'],
  [168, 'كارگاه برق'], [25, 'مدارهاي الكتريكي 2'], [861, 'مهارتهاي زندگي دانشجويي'],
].map(([id, fullname]) => ({ id, fullname }));

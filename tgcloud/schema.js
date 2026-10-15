import { table, integer, text, json, boolean, index, sql } from 'sdk/db';

// --- single-value stores (pre-existing, unchanged) -------------------------
export const settings = table('settings', {
  key: text('key').primaryKey(), value: json('value').notNull(),
});
export const leases = table('leases', {
  key: text('key').primaryKey(), until: integer('until').notNull(),
});

// --- one shared baseline per course (pre-existing table, new columns) ------
// `value` keeps the item array shape written by the single-account version, so
// the existing nine baselines stay valid. `reader`/`updatedAt` were added
// additively to attribute a baseline to the account that produced it.
export const snapshots = table('snapshots', {
  key: text('key').primaryKey(), value: json('value').notNull(),
  reader: text('reader'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// --- university accounts (one row per connected account holder) ------------
export const accounts = table('accounts', {
  id: text('id').primaryKey(),                 // stable account id, e.g. acc_legacy_owner
  ownerId: integer('owner_id').notNull(),      // Telegram id of the account holder
  label: text('label').notNull().default(''),
  mode: text('mode').notNull().default('session'), // 'session' | 'token'
  secret: text('secret'),                      // credential; never leaves the server
  enabled: boolean('enabled').notNull().default(true),
  health: json('health'),                      // { state, code, courses, readFailures, at }
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({ ownerIdx: index('idx_accounts_owner').on(t.ownerId) }));

// --- Telegram users the bot owner approved to connect their own account ----
export const contributors = table('contributors', {
  tgId: integer('tg_id').primaryKey(),
  label: text('label').default(''),
  approved: boolean('approved').notNull().default(false),
  approvedBy: integer('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// --- professor directory: the university code segment → a professor name ----
export const professors = table('professors', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  updatedBy: integer('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// --- per-class binding, keyed by the course (origin#courseId) ---------------
// A section is one Moodle course, so two professors of the same-named course are
// two different rows. The site shows the code and the course, never the professor,
// so this table is how a student recognises which class a notice belongs to.
export const classBindings = table('class_bindings', {
  key: text('key').primaryKey(),      // canonical course key
  code: text('code'),                 // 13-digit course code, canonical a-b-c
  label: text('label'),               // class label, e.g. '17'
  professorCode: text('professor_code'),
  professorName: text('professor_name'),
  slots: json('slots'),               // [{ weekday: 0-6, from: 'HH:MM', to: 'HH:MM' }]
  source: text('source'),             // 'manual' | 'detected'
  updatedBy: integer('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// --- notification bookkeeping: dedupe/cooldown for private warnings -------
export const notices = table('notices', {
  key: text('key').primaryKey(),
  sentAt: integer('sent_at').notNull().default(0),
  count: integer('count').notNull().default(0),
  info: json('info'),
});

// Your database tables go here as named exports. Deploying this file registers the
// schema; applying the changes (a migration) updates the database.

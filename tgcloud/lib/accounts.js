import { db } from './database.js';
import { eq } from './database.js';
import { accounts, contributors } from '../schema.js';
import { OWNER_ID, MAX_ACCOUNTS } from './config.js';
import { getSetting, putSetting } from './settings.js';
import { roleFrom, canManageAccount, canConnect, accountLabel, ownAccounts } from './authorize.js';

// The credential of the single-account era lives in settings.university. The
// migration below copies it into a normal account row exactly once and leaves the
// old setting untouched (inert) so nothing is dropped or exposed.
const MIGRATION_KEY = 'accountsMigration';
const LEGACY_ACCOUNT_ID = 'acc_legacy_owner';

export function newAccountId() {
  return `acc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Never hand a credential to a caller: strip it.
export function redactAccount(row) {
  if (!row) return null;
  return {
    id: row.id, ownerId: row.ownerId, label: row.label, mode: row.mode,
    enabled: !!row.enabled, health: row.health ?? null,
    hasCredential: !!row.secret, updatedAt: row.updatedAt ?? null,
  };
}

export async function allAccounts() {
  return await db.select().from(accounts).all();
}

export async function enabledAccounts() {
  return (await allAccounts()).filter(row => row.enabled && !!row.secret).slice(0, MAX_ACCOUNTS);
}

export async function accountById(id) {
  return (await db.select().from(accounts).where(eq(accounts.id, id)).get()) ?? null;
}

export async function roleOf(tgId) {
  if (!tgId) return 'none';
  if (OWNER_ID && tgId === OWNER_ID) return 'owner';
  const row = await db.select().from(contributors).where(eq(contributors.tgId, tgId)).get();
  return roleFrom(OWNER_ID, row, tgId);
}

export async function visibleAccounts(role, callerId) {
  const rows = await allAccounts();
  return (role === 'owner' ? rows : ownAccounts(role, callerId, rows)).map(redactAccount);
}

export async function approveContributor(tgId, contributorLabel, by = OWNER_ID) {
  const existing = await db.select().from(contributors).where(eq(contributors.tgId, tgId)).get();
  const set = { approved: true, approvedBy: by, approvedAt: new Date(), label: accountLabel(contributorLabel ?? existing?.label, 1) };
  await db.insert(contributors).values({ tgId, ...set }).onConflictDoUpdate({ target: contributors.tgId, set }).run();
  return { tgId, ...set };
}

// Revoking keeps the row (so re-approval restores history) but disables that
// person's connections: an unapproved contributor can neither read nor renew.
export async function revokeContributor(tgId) {
  await db.insert(contributors).values({ tgId, approved: false, label: '' })
    .onConflictDoUpdate({ target: contributors.tgId, set: { approved: false } }).run();
  const rows = await allAccounts();
  const owned = rows.filter(row => row.ownerId === tgId && row.enabled);
  for (const row of owned) await setEnabled(row.id, false);
  return { tgId, disabled: owned.length };
}

export async function setEnabled(id, enabled) {
  await db.update(accounts).set({ enabled: !!enabled, updatedAt: new Date() }).where(eq(accounts.id, id)).run();
}

export async function setLabel(id, text) {
  await db.update(accounts).set({ label: accountLabel(text, 1), updatedAt: new Date() }).where(eq(accounts.id, id)).run();
}

export async function deleteAccount(id) {
  // Baselines are shared per course and independent of accounts, so they stay.
  await db.delete(accounts).where(eq(accounts.id, id)).run();
}

export async function setHealth(id, health) {
  await db.update(accounts).set({ health, updatedAt: new Date() }).where(eq(accounts.id, id)).run();
}

function healthFor(state, code, extra = {}) {
  return { state, code: code ?? null, at: new Date().toISOString(), ...extra };
}

// Connect or renew an account for its holder. `courses` is the count verified by
// the caller's own test request, so health starts honest.
export async function connectAccount({ callerId, role, accountId, mode, secret, label: text, courses }) {
  if (!canConnect(role)) throw new Error('NOT_APPROVED');
  const health = healthFor('ok', null, { courses: Number(courses) || 0, verified: true });
  if (accountId) {
    const row = await accountById(accountId);
    if (!row) throw new Error('ACCOUNT_NOT_FOUND');
    if (!canManageAccount(role, callerId, row)) throw new Error('FORBIDDEN');
    await db.update(accounts).set({
      mode, secret, enabled: true, health,
      label: text ? accountLabel(text, 1) : row.label, updatedAt: new Date(),
    }).where(eq(accounts.id, accountId)).run();
    return await accountById(accountId);
  }
  const mine = (await allAccounts()).filter(row => row.ownerId === callerId).length;
  const id = newAccountId();
  await db.insert(accounts).values({
    id, ownerId: callerId, label: accountLabel(text, mine + 1), mode, secret, enabled: true, health,
  }).run();
  return await accountById(id);
}

// Additive, idempotent. Copies the legacy credential into an account row owned by
// the configured bot owner and normalizes the legacy destination, then records a
// marker so it never runs twice. Nothing is deleted.
export async function ensureMigrated() {
  const done = await getSetting(MIGRATION_KEY);
  if (done) return { migrated: false, accountId: done.accountId ?? null };

  let accountId = null;
  const legacy = await getSetting('university');
  if (legacy?.secret && legacy?.mode && (await allAccounts()).length === 0) {
    await db.insert(accounts).values({
      id: LEGACY_ACCOUNT_ID, ownerId: OWNER_ID, label: 'حساب اصلی', mode: legacy.mode,
      secret: legacy.secret, enabled: true,
      health: healthFor('unknown', null, { migratedFrom: 'settings.university' }),
    }).onConflictDoNothing({ target: accounts.id }).run();
    accountId = (await accountById(LEGACY_ACCOUNT_ID)) ? LEGACY_ACCOUNT_ID : null;
  }

  // Normalize the destination that the single-account version stored in
  // settings.groupId, so the Mini App can display it. Same chat, no silent change.
  const bound = await getSetting('destination');
  const legacyGroup = await getSetting('groupId');
  if (bound === undefined && Number(legacyGroup) !== 0 && Number.isSafeInteger(Number(legacyGroup))) {
    await putSetting('destination', {
      chatId: Number(legacyGroup), threadId: null, boundBy: OWNER_ID,
      boundAt: new Date().toISOString(), source: 'legacy',
    });
  }

  await putSetting(MIGRATION_KEY, {
    at: new Date().toISOString(), accountId,
    source: accountId ? 'settings.university' : null,
  });
  return { migrated: true, accountId };
}

export function healthSummary(rows) {
  const list = rows ?? [];
  const byState = {};
  for (const row of list) {
    const state = row.health?.state ?? 'unknown';
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return {
    total: list.length,
    enabled: list.filter(r => r.enabled).length,
    byState,
    accounts: list.map(r => ({ id: r.id, label: r.label, ownerId: r.ownerId, enabled: !!r.enabled, state: r.health?.state ?? 'unknown', code: r.health?.code ?? null, courses: r.health?.courses ?? null, at: r.health?.at ?? null })),
  };
}

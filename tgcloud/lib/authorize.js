// Pure authorization rules — no SDK imports, so they run under `node --test`.
// "Approved" means: the bot owner, or a Telegram id the bot owner approved as a
// contributor. Only the holder of an account (or the bot owner) may change it.

export const MODES = ['session', 'token'];
// Credentials are opaque strings (MoodleSession value or wstoken). Reject
// anything that is not a plain token so nothing weird can be stored.
export const CREDENTIAL_RE = /^[a-zA-Z0-9_-]{10,256}$/;

export function roleFrom(ownerId, contributorRow, tgId) {
  if (!tgId) return 'none';
  if (ownerId && tgId === ownerId) return 'owner';
  return contributorRow?.approved ? 'contributor' : 'none';
}

export function canConnect(role) {
  return role === 'owner' || role === 'contributor';
}

// The bot owner manages every account; a contributor only their own.
export function canManageAccount(role, callerId, account) {
  if (role === 'owner') return true;
  if (role !== 'contributor' || !account) return false;
  return account.ownerId === callerId;
}

export function validCredential(mode, secret) {
  return MODES.includes(mode) && typeof secret === 'string' && CREDENTIAL_RE.test(secret);
}

// Display label: single line, bounded, never derived from the credential.
export function accountLabel(label, index) {
  const clean = String(label ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return clean || `حساب ${Math.max(1, Number(index) || 1)}`;
}

// A contributor must not learn which other accounts exist, so a shared status
// document is trimmed to the caller's own accounts before it leaves the server.
export function scopeHealth(health, callerId, isOwner) {
  const list = Array.isArray(health) ? health : [];
  if (isOwner) return list;
  return list.filter(entry => entry?.ownerId === callerId);
}

// Which of the caller's accounts may be connected right now.
export function ownAccounts(role, callerId, rows) {
  const all = Array.isArray(rows) ? rows : [];
  if (role === 'owner') return all;
  if (role !== 'contributor') return [];
  return all.filter(row => row.ownerId === callerId);
}

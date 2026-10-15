// Pure dedupe/cooldown decision for private warnings. No SDK imports.
// A failure must not spam an account holder: the first warning goes out, later
// identical warnings wait for the cooldown to elapse.

export function cooldownActive(sentAt, now, cooldownMs) {
  const at = Number(sentAt);
  if (!Number.isFinite(at) || at <= 0) return false;
  return Number(now) - at < Number(cooldownMs);
}

export function noticePlan(existing, { now, cooldownMs }) {
  const sentAt = Number(existing?.sentAt ?? 0);
  if (cooldownActive(sentAt, now, cooldownMs)) {
    return { send: false, sentAt, count: Number(existing?.count ?? 0), nextEligibleAt: sentAt + Number(cooldownMs) };
  }
  return { send: true, sentAt: Number(now), count: Number(existing?.count ?? 0) + 1, nextEligibleAt: Number(now) + Number(cooldownMs) };
}

export function noticeKey(kind, subject) {
  return `${kind}:${subject}`;
}

// Pure routing rules for the single group/channel destination. No SDK imports.
// Course notifications and digests are the only things sent to that chat; account
// errors never are.

export function parseThreadId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// `value` is settings.destination. A stored literal `null` means "explicitly
// unbound", which must not silently fall back to the legacy settings.groupId.
export function destinationFrom(value, legacyGroupId) {
  if (value === null) return null;
  if (value && typeof value === 'object') {
    const chatId = Number(value.chatId ?? value.chat_id);
    if (Number.isSafeInteger(chatId) && chatId !== 0) {
      return { chatId, threadId: parseThreadId(value.threadId ?? value.message_thread_id), source: value.source ?? 'bound' };
    }
  }
  const legacy = Number(legacyGroupId);
  return Number.isSafeInteger(legacy) && legacy !== 0 ? { chatId: legacy, threadId: null, source: 'legacy' } : null;
}

// Bot API params for one message. `message_thread_id` is only present when a
// topic (message_thread_id) was captured at bind time.
export function sendTarget(destination) {
  if (!destination?.chatId) return null;
  const target = { chat_id: destination.chatId };
  if (destination.threadId) target.message_thread_id = destination.threadId;
  return target;
}

export function describeDestination(destination) {
  if (!destination?.chatId) return 'No destination bound. Run /bind in the target group topic as the bot owner.';
  const topic = destination.threadId ? ` topic ${destination.threadId}` : ' main topic';
  return `chat ${destination.chatId} ·${topic} · source: ${destination.source}`;
}

export function sameTarget(a, b) {
  return !!a && !!b && a.chatId === b.chatId && (a.threadId ?? null) === (b.threadId ?? null);
}

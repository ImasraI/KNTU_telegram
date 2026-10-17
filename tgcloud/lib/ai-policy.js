// AI chat: what the owner may tune, and what a student is told before opting in.
//
// Pure — no SDK imports — so it runs under `node --test`, and so the student
// endpoint, the owner console and the chat handler can describe the same feature
// from one source instead of restating it. Values stored here are the ones
// `lib/ai-bot.js` writes with `/ai` and `/persona`; ranges match its commands.
export const AI_TRAITS = [
  { key: 'sarcasm', label: 'طعنه و کنایه', low: 'بی‌کنایه', high: 'پر از کنایه' },
  { key: 'ego', label: 'اعتمادبه‌نفس', low: 'فروتن', high: 'مغرور' },
  { key: 'toxicity', label: 'تندی لحن', low: 'مؤدب', high: 'تند' },
  { key: 'talkative', label: 'پرحرفی', low: 'کوتاه', high: 'پرحرف' },
  { key: 'warmth', label: 'گرمی لحن', low: 'رسمی', high: 'خودمانی' },
];

export const AI_TRAIT_KEYS = AI_TRAITS.map(trait => trait.key);

export const AI_PROVIDERS = [
  { value: 'groq', label: 'Groq' },
  { value: 'gemini', label: 'Gemini' },
];

// Ranges are the ones `/ai` and `/persona` enforce, so both paths agree.
export const AI_LIMITS = { trait: [0, 10], dailyUser: [1, 100], dailyGlobal: [1, 5000] };
export const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,120}$/;

export const AI_DISCLOSURE = [
  'گفت‌وگوی هوشمند اختیاری است و فقط پس از روشن‌کردن آن فعال می‌شود.',
  'با روشن‌بودن آن، متن پیام شما و اطلاعات عمومی درس‌ها (نام درس، استاد، تکلیف و زمان‌ها) به ارائه‌دهندهٔ مدل (Groq یا Gemini) فرستاده می‌شود.',
  'رمز، کوکی، نمره، فهرست دانشجویان و شمارهٔ بلند درس هرگز فرستاده نمی‌شود.',
  'حافظهٔ کوتاه گفت‌وگو حداکثر ۷ روز نگه داشته می‌شود و با خاموش‌کردن، پاک می‌شود.',
].join(' ');

export const AI_MEDIA_MAX = 100;

const clampInt = (value, [low, high]) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(low, Math.min(high, Math.round(number)));
};

// Stored config → the shape both surfaces read. Missing values stay null so the
// console can say «پیش‌فرض سرویس» instead of inventing a model name.
export function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: value.enabled !== false,
    provider: AI_PROVIDERS.some(provider => provider.value === value.provider) ? value.provider : null,
    model: typeof value.model === 'string' && MODEL_RE.test(value.model) ? value.model : null,
    dailyUser: clampInt(value.dailyUser, AI_LIMITS.dailyUser),
    dailyGlobal: clampInt(value.dailyGlobal, AI_LIMITS.dailyGlobal),
  };
}

// A patch from the console: only the fields it names are touched, and every value
// is validated before anything is written.
export function mergeConfig(raw, patch = {}) {
  const value = patch && typeof patch === 'object' ? patch : {};
  const config = normalizeConfig(raw);
  const errors = [];

  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') errors.push('وضعیت گفت‌وگو نامعتبر است.');
    else config.enabled = value.enabled;
  }
  if (value.provider !== undefined) {
    // An empty value clears the choice so the service default applies again.
    if (value.provider === null || value.provider === '') config.provider = null;
    else if (!AI_PROVIDERS.some(provider => provider.value === value.provider)) errors.push('ارائه‌دهنده باید Groq یا Gemini باشد.');
    else config.provider = value.provider;
  }
  if (value.model !== undefined) {
    const model = String(value.model ?? '').trim();
    if (!model) config.model = null;
    else if (!MODEL_RE.test(model)) errors.push('نام مدل فقط می‌تواند شامل حرف، رقم و . _ : / - باشد (حداکثر ۱۲۰ نویسه).');
    else config.model = model;
  }
  for (const key of ['dailyUser', 'dailyGlobal']) {
    if (value[key] === undefined) continue;
    const limit = clampInt(value[key], AI_LIMITS[key]);
    if (limit === null) errors.push(key === 'dailyUser' ? 'سقف روزانهٔ هر کاربر باید عدد باشد.' : 'سقف روزانهٔ کل باید عدد باشد.');
    else config[key] = limit;
  }
  return { config, errors };
}

export function normalizeTraits(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const traits = {};
  for (const key of AI_TRAIT_KEYS) traits[key] = clampInt(value[key], AI_LIMITS.trait);
  return traits;
}

export function applyTrait(raw, key, value) {
  const traits = normalizeTraits(raw);
  if (!AI_TRAIT_KEYS.includes(key)) return { traits, error: 'ویژگی شناخته نشد.' };
  const score = clampInt(value, AI_LIMITS.trait);
  if (score === null) return { traits, error: 'مقدار ویژگی باید عددی بین ۰ تا ۱۰ باشد.' };
  traits[key] = score;
  return { traits, error: null };
}

// Everything the owner console renders, with no credential and no message text.
export function adminView({ config, traits, media } = {}) {
  const normalized = normalizeTraits(traits);
  return {
    config: normalizeConfig(config),
    traits: AI_TRAITS.map(trait => ({ ...trait, value: normalized[trait.key] })),
    media: { count: Array.isArray(media) ? media.length : 0, max: AI_MEDIA_MAX },
    providers: AI_PROVIDERS,
    limits: AI_LIMITS,
    disclosure: AI_DISCLOSURE,
  };
}

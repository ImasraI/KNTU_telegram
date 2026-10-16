// Class/professor directory logic. No SDK imports, so it runs under `node --test`.
//
// Why this exists: Moodle at KNTU puts a 13-digit course code in the course name
// (`[4051-1111166-17]`) but never the professor's name, and the same course name is
// offered by many professors in different sections. A section is one Moodle course
// (one course id), so the binding is per course; the code and the weekly class times
// are what let a student recognise which class an activity belongs to.

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const WEEKDAY_ALIASES = {
  saturday: 0, sat: 0, shanbe: 0, sun: 1, sunday: 1, yekshanbe: 1,
  mon: 2, monday: 2, doshanbe: 2, tue: 3, tuesday: 3, seshanbe: 3,
  wed: 4, wednesday: 4, chaharshanbe: 4, thu: 5, thursday: 5, panjshanbe: 5,
  fri: 6, friday: 6, jome: 6, jomeh: 6,
};

// Moodle renders Persian/Arabic-Indic digits in Persian pages; accept all of them
// plus the Arabic yeh/kaf so owner input and site text compare equal.
export function toAsciiDigits(text) {
  return String(text ?? '')
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}
export function normalizeSpaces(text) {
  return String(text ?? '').replace(/[\u200c\u200e\u200f]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
}

export function courseTitle(text) {
  return String(text ?? '').replace(/\s*\[[\d\u06f0-\u06f9\u0660-\u0669\s-]+\]/g, '').trim();
}

// `[4051-1111166-17]`, `22-1110274-4051`, `۲۲-۱۱۱۰۲۷۴-۴۰۵۱` → canonical a-b-c.
export function parseCourseCode(text) {
  const value = normalizeSpaces(toAsciiDigits(text));
  const separated = value.match(/\b(\d{1,4})\s*-\s*(\d{7})\s*-\s*(\d{1,4})\b/);
  if (separated) return { code: `${separated[1]}-${separated[2]}-${separated[3]}`, fields: [separated[1], separated[2], separated[3]] };
  const bare = value.match(/\b(\d{13})\b/);
  if (bare) {
    // No separators: the university writes the class/section first, then the
    // 7-digit course number, then the group code (see README).
    const digits = bare[1];
    return { code: `${digits.slice(0, 2)}-${digits.slice(2, 9)}-${digits.slice(9)}`, fields: [digits.slice(0, 2), digits.slice(2, 9), digits.slice(9)] };
  }
  return null;
}

// Observed KNTU format is `<group>-<course>-<section>` (e.g. 4051-1111166-17), where
// the trailing 2-digit field is what changes per class. Fall back to the leading
// field when the code does not follow that shape. The owner can always override it.
export function deriveLabel(code) {
  const parsed = typeof code === 'string' ? parseCourseCode(code) : code;
  if (!parsed) return null;
  const [first, , last] = parsed.fields;
  return /^\d{1,2}$/.test(last) ? last : first;
}

export function weekdayIndex(name) {
  const key = normalizeSpaces(name).replace(/\s/g, '').toLowerCase();
  if (!key) return null;
  for (let i = 0; i < WEEKDAYS.length; i++) if (normalizeSpaces(WEEKDAYS[i]).replace(/\s/g, '') === key) return i;
  return Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, key) ? WEEKDAY_ALIASES[key] : null;
}

function parseClock(text) {
  const m = normalizeSpaces(toAsciiDigits(text)).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${m[2]}`;
}

// "یکشنبه 10:00-11:30" / "سه‌شنبه 8:00 تا 9:30، پنجشنبه 14:00-15:30"
export function parseSlots(text, max = 10) {
  const parts = String(text ?? '').split(/[,;،\n]+/).map(part => part.trim()).filter(Boolean);
  const slots = [];
  for (const part of parts) {
    // Normalise digits first: JS `\d` only matches ASCII, and Moodle renders ۱۰:۰۰.
    const ascii = normalizeSpaces(toAsciiDigits(part));
    const dayText = ascii.replace(/\s*\d.*$/, '').trim();
    const weekday = dayText ? weekdayIndex(dayText) : null;
    const times = ascii.match(/(\d{1,2}:\d{2})\s*(?:-|تا|to)\s*(\d{1,2}:\d{2})/);
    if ((dayText && weekday === null) || !times || times[0] !== ascii.slice(dayText.length).trim()) return null;
    const from = parseClock(times[1]);
    const to = parseClock(times[2]);
    if (!from || !to || from >= to) return null;
    slots.push({ weekday, from, to });
    if (slots.length > max) return null;
  }
  return slots.length ? slots : null;
}

export function formatSlot(slot) {
  const day = WEEKDAYS[slot?.weekday] ?? '';
  if (!slot?.from) return day;
  return `${day ? day + ' ' : ''}${slot.from}${slot.to ? ' - ' + slot.to : ''}`;
}

export function formatSlots(slots, max = 4) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return '';
  const shown = list.slice(0, max).map(formatSlot);
  return shown.join('، ') + (list.length > shown.length ? ` و ${list.length - shown.length} زمان دیگر` : '');
}

// No `\b` here: JS word boundaries do not apply to Persian letters.
const TITLE_RE = /^(استاد|دکتر|دكتر|مهندس|آقای|خانم|سرکار\s*خانم|dr\.?|prof\.?)(\s|$)/i;
// "استاد طباطبایی" should not become "استاد استاد طباطبایی".
export function professorLabel(name) {
  const clean = normalizeSpaces(name);
  return !clean ? null : (TITLE_RE.test(clean) ? clean : `استاد ${clean}`);
}

export function professorFor(binding, professors) {
  if (binding?.professorName) return binding.professorName;
  const code = binding?.professorCode;
  if (!code) return null;
  const map = professors instanceof Map ? professors : new Map(Object.entries(professors ?? {}));
  return map.get(String(code)) ?? null;
}

// The line that makes a notification identifiable: which class, which professor,
// which weekly time. Returns '' when nothing is bound yet.
export function classLine(binding, professors, siteCode = null) {
  // The site code alone already identifies the class, so a notice can name the
  // class before the owner binds a professor or a weekly time.
  const code = binding?.code ?? parseCourseCode(siteCode)?.code ?? null;
  const label = binding?.label ?? (code ? deriveLabel(code) : null);
  if (!binding && !code) return null;
  const parts = [];
  const slots = formatSlots(binding?.slots);
  if (slots) parts.push(slots);
  else if (label) parts.push(`کلاس ${label}`);
  const professor = professorFor(binding, professors);
  if (professor) parts.push(professorLabel(professor));
  return parts.length ? '🏫 ' + parts.join(' — ') : null;
}

// Parses `/prof [del] <code> [name…]`. The delete keyword comes first, which is easy
// to get backwards — hence a tested parser rather than inline argument handling.
export function parseProfCommand(args) {
  const [first, ...others] = (args ?? []).map(x => String(x));
  if (!first) return { action: 'list' };
  const clean = value => normalizeSpaces(toAsciiDigits(value)).slice(0, 60);
  if (['del', 'delete', 'حذف', '-'].includes(first.toLowerCase())) {
    const code = clean(others[0] ?? '');
    return code ? { action: 'delete', code } : { error: 'PROFESSOR_CODE' };
  }
  const name = clean(others.join(' '));
  if (['del', 'delete', 'حذف'].includes(name.toLowerCase())) return { action: 'delete', code: clean(first) };
  return name ? { action: 'set', code: clean(first), name } : { error: 'PROFESSOR_NAME' };
}

// Parses `/class <courseId> <sub> <value…>` into a plain instruction.
export function parseClassCommand(args) {
  const [courseId, sub, ...rest] = (args ?? []).map(x => String(x));
  const value = rest.join(' ').trim();
  const id = Number(toAsciiDigits(courseId));
  if (!Number.isSafeInteger(id) || id <= 0) return { error: 'COURSE_ID' };
  if (!sub) return { courseId: id, action: 'show' };
  const key = sub.toLowerCase();
  if (key === 'clear' || key === 'del' || key === 'حذف') return { courseId: id, action: 'clear' };
  if (['code', 'کد'].includes(key)) {
    const parsed = parseCourseCode(value);
    return parsed ? { courseId: id, action: 'code', code: parsed.code, label: deriveLabel(parsed) } : { error: 'CODE' };
  }
  if (['label', 'کلاس'].includes(key)) {
    const label = normalizeSpaces(toAsciiDigits(value)).slice(0, 20);
    return label ? { courseId: id, action: 'label', label } : { error: 'LABEL' };
  }
  if (['prof', 'professor', 'استاد'].includes(key)) {
    const clean = normalizeSpaces(value).slice(0, 60);
    if (!clean) return { error: 'PROFESSOR' };
    return /^\d{1,6}$/.test(toAsciiDigits(clean))
      ? { courseId: id, action: 'professor', professorCode: toAsciiDigits(clean) }
      : { courseId: id, action: 'professor', professorName: clean };
  }
  if (['time', 'slots', 'slot', 'زمان', 'ساعت'].includes(key)) {
    if (['clear', 'none', 'حذف'].includes(value.toLowerCase())) return { courseId: id, action: 'slots', slots: [] };
    const slots = parseSlots(value);
    return slots ? { courseId: id, action: 'slots', slots } : { error: 'SLOTS' };
  }
  return { error: 'SUBCOMMAND' };
}

// `show b` → "b" when bound, "(بدون تنظیم)" otherwise.
export function describeBinding(binding, professors) {
  if (!binding) return 'بدون تنظیم';
  const professor = professorFor(binding, professors);
  return [
    binding.slots?.length ? formatSlots(binding.slots, 6) : (binding.label || deriveLabel(binding.code) ? `کلاس ${binding.label || deriveLabel(binding.code)}` : null),
    professor ? professorLabel(professor) : null,
    binding.source ? `منبع: ${binding.source}` : null,
  ].filter(Boolean).join(' — ') || 'بدون تنظیم';
}

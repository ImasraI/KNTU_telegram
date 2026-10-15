// handlers/message.js — runs on each `message` update. The platform calls the
// default export with the Message payload; the full update is `ctx.update`.
//
// Group privacy is untouched: the bot reads only the commands addressed to it and
// never ordinary group conversation. University credentials are never accepted in
// a chat — only through the private setup Mini App.

import { api, db } from 'sdk';
import { OWNER_ID, MINI_APP_URL, APPROVAL_NOTICE_COOLDOWN_MS } from '../lib/config.js';
import { getSetting, putSetting } from '../lib/settings.js';
import { snapshots } from '../schema.js';
import { notification } from '../lib/content.js';
import { courseKey, courseIdFromKey } from '../lib/plan.js';
import { describeDestination, parseThreadId } from '../lib/destination.js';
import { roleOf, visibleAccounts, approveContributor, revokeContributor, healthSummary } from '../lib/accounts.js';
import { notifyOnce } from '../lib/notify.js';
import { noticeKey } from '../lib/notice-policy.js';
import { scan, publishDigests, resolveDestination, directorySummary, detectClassInfo } from '../lib/monitor.js';
import { parseClassCommand, parseProfCommand, describeBinding, parseCourseCode } from '../lib/classes.js';
import { setBinding, deleteBinding, setProfessor, deleteProfessor, getBinding, professorMap } from '../lib/directory.js';

const COMMANDS = new Set(['/start', '/help', '/setup', '/check', '/status', '/courses',
  '/assignments', '/exams', '/accounts', '/approve', '/revoke', '/bind', '/unbind',
  '/destination', '/digest', '/id', '/classes', '/class', '/prof']);

const CLASS_HELP = ['تنظیم کلاس و استاد برای هر درس (فقط مالک ربات، در چت خصوصی):',
  '/classes — فهرست درس‌ها با کلاس، استاد و ساعت کلاس',
  '/class <شماره درس> — نمایش تنظیم فعلی و اطلاعات سایت',
  '/class <شماره درس> code 4051-1111166-17 — ثبت کد درس',
  '/class <شماره درس> label 17 — تعیین نام کلاس',
  '/class <شماره درس> prof استاد طباطبایی — ثبت نام استاد',
  '/class <شماره درس> prof 4051 — ثبت کد استاد (نگاشت با /prof)',
  '/class <شماره درس> slots یک‌شنبه 10:00-11:30، سه‌شنبه 8:00-9:30 — ساعت کلاس‌ها',
  '/class <شماره درس> clear — حذف تنظیم',
  '/prof 4051 استاد طباطبایی — نگاشت کد استاد به نام',
  '/prof del 4051 — حذف نگاشت'].join('\n');

const HELP = ['KNTU course monitor',
  '/courses — courses covered right now',
  '/assignments — saved homework from the last scan',
  '/exams — quizzes and exam announcements',
  '',
  'Owner: /setup /check /status /accounts /classes /class /prof /approve /revoke /bind /unbind /destination /digest',
  'Account holders: /setup — connect or renew your own university account',
  'Anyone: /id — show your Telegram ID'].join('\n');

const HEALTH_LABELS = { ok: '✅', auth: '🔒 expired', partial: '⚠️ partial', unreachable: '🌐 unreachable', layout: '❓ layout', error: '⚠️ error', unknown: '• unknown' };

function accountLines(rows) {
  return rows.map(row => {
    const health = row.health ?? {};
    const state = HEALTH_LABELS[health.state ?? 'unknown'] ?? '•';
    const courses = Number.isFinite(Number(health.courses)) ? ` · ${health.courses} courses` : '';
    const code = health.code ? ` · ${health.code}` : '';
    return `${state} ${row.label || row.id}${row.enabled ? '' : ' (disabled)'} — ${row.mode}${courses}${code}`;
  });
}

export default async function (message, ctx) {
  const chat = message?.chat ?? {};
  const fromId = message?.from?.id;
  const [raw, ...args] = String(message?.text ?? '').trim().split(/\s+/);
  const command = (raw ?? '').replace(/@\w+$/, '');
  if (!COMMANDS.has(command)) return;

  const isPrivate = chat.type === 'private';
  const role = await roleOf(fromId);
  const owner = role === 'owner';
  const reply = async (text, extra = {}) => {
    try { return await api.sendMessage({ chat_id: chat.id, text, link_preview_options: { is_disabled: true }, ...extra }); }
    catch { return null; } // e.g. no send rights in the group; never fatal
  };

  if (command === '/id') return await reply(`Your Telegram ID: ${fromId}\nSend this to the bot owner to be approved.`);

  // An unapproved user in private: explain, and tell the owner once per cooldown.
  if (isPrivate && role === 'none') {
    if (command === '/start') {
      await reply(['This bot follows KNTU course updates for a small number of approved account holders.',
        `Your Telegram ID: ${fromId}`,
        'Ask the bot owner to approve it, then open /setup to connect your own university account.',
        'Never send your university password, cookie or token in a chat.'].join('\n'));
      await notifyOnce({
        key: noticeKey('approval', fromId), tgId: OWNER_ID, cooldownMs: APPROVAL_NOTICE_COOLDOWN_MS,
        text: `👤 A user wants to connect an account.\nID: ${fromId}\nName: ${message.from?.first_name ?? ''} ${message.from?.username ? '@' + message.from.username : ''}\nApprove with: /approve ${fromId} [label]`,
      });
    }
    return;
  }

  // Destination binding: only the configured owner, only where the bot can send.
  if (command === '/bind') {
    if (!owner || !['group', 'supergroup'].includes(chat.type)) return;
    const threadId = parseThreadId(message.message_thread_id ?? message.reply_to_message?.message_thread_id);
    const target = threadId ? { chat_id: chat.id, message_thread_id: threadId } : { chat_id: chat.id };
    try {
      await api.sendMessage({ ...target, text: `این مقصد برای اطلاع‌رسانی ثبت شد.\nchat ${chat.id}${threadId ? ` · topic ${threadId}` : ' · main topic'}`, link_preview_options: { is_disabled: true } });
    } catch (e) {
      return await reply(`Could not send to that target: ${e?.description ?? 'error'}. Add the bot to the group/topic with send permission and retry.`);
    }
    // Confirmation above proves send access; only then replace the destination
    // and mirror it into the legacy groupId setting other commands still consult.
    await putSetting('destination', { chatId: chat.id, threadId, boundBy: fromId, boundAt: new Date().toISOString(), source: 'bind' });
    if (!threadId) await putSetting('groupId', chat.id);
    return;
  }

  const destination = await resolveDestination();
  const inDestination = !!destination && chat.id === destination.chatId;
  if (!isPrivate && !inDestination) return; // ignore commands in unrelated groups

  if (command === '/start' || command === '/help') return await reply(HELP);

  if (command === '/setup') {
    if (!isPrivate) return;
    return await api.sendMessage({
      chat_id: chat.id,
      text: ['Connect or renew your own university account.',
        'The credential is sent straight to the bot over Telegram\'s Mini App call and stored only in the bot\'s private database.',
        'Never paste a cookie or token into a chat.'].join('\n'),
      reply_markup: { inline_keyboard: [[{ text: 'University connection', web_app: { url: MINI_APP_URL } }]] },
    });
  }

  if (command === '/check') {
    if (!isPrivate || !owner) return;
    try {
      const result = await scan({ reason: 'command' });
      if (result.busy) return await reply('A check is already running.');
      return await reply([`Checked ${result.courses} courses across ${result.accounts.total} accounts.`,
        `${result.sent} updates sent; ${result.baselined} courses newly baselined; ${result.failures.length} courses failed; ${result.lost.length} lost coverage.`,
        result.accounts.failed ? `${result.accounts.failed} account(s) could not read everything — see /status.` : ''].filter(Boolean).join('\n'));
    } catch (e) {
      return await reply(`Check failed: ${e?.message === 'GROUP_NOT_CONFIGURED' ? 'no destination bound — run /bind in the target group or topic.' : 'open setup to check the university connections.'}`);
    }
  }

  if (command === '/status') {
    if (!isPrivate || !owner) return;
    const list = await visibleAccounts('owner', fromId);
    const summary = healthSummary(list);
    const status = await getSetting('status');
    const pending = ((await getSetting('pendingDigests')) ?? []).length;
    return await reply([
      `Accounts: ${summary.enabled}/${summary.total} enabled`,
      ...accountLines(list),
      '',
      `Destination: ${describeDestination(destination)}`,
      status ? `Last check: ${status.checkedAt} (${status.reason}) · ${status.courses} courses · ${status.sent} sent · ${status.failures?.length ?? 0} failed · ${status.lost?.length ?? 0} lost` : 'No completed scan yet.',
      pending ? `${pending} initial digest(s) pending — publish with /digest` : '',
    ].filter(Boolean).join('\n'));
  }

  if (command === '/accounts') {
    const rows = await (owner ? visibleAccounts('owner', fromId) : visibleAccounts(role, fromId));
    const lines = accountLines(rows);
    return await reply([role === 'owner' ? 'University accounts:' : 'Your university account:', ...(lines.length ? lines : ['none yet — open /setup']),
      '', `Destination: ${describeDestination(destination)}`,
      owner ? 'Approve someone with /approve <id> [label]; revoke with /revoke <id>.' : ''].filter(Boolean).join('\n'));
  }

  if (command === '/classes' || command === '/class' || command === '/prof') {
    if (!isPrivate || !owner) return;

    if (command === '/classes') {
      const summary = await directorySummary();
      if (!summary.courses.length) return await reply('هنوز درسی ثبت نشده است. ابتدا /check را اجرا کنید.');
      const lines = summary.courses.map(course => {
        const code = course.binding?.code ?? course.siteCode ?? course.codeFromName;
        return [`#${course.id} ${course.name}`, code ? `   کد ${code}` : '   کد نامشخص (با /class ' + course.id + ' detect بررسی کنید)',
          `   ${course.text}`, ''].join('\n');
      });
      const chunks = [];
      let current = 'تنظیم کلاس‌ها (برای تغییر: /class <شماره درس> …):\n';
      for (const block of lines) {
        if (current.length + block.length > 3200) { chunks.push(current); current = ''; }
        current += block;
      }
      chunks.push(current);
      const limited = chunks.slice(0, 4);
      for (const chunk of limited.slice(0, -1)) await reply(chunk);
      // Returning the last message makes a delivery failure visible instead of silent.
      return await reply(limited.at(-1));
    }

    if (command === '/prof') {
      const parsed = parseProfCommand(args);
      if (parsed.action === 'list' || parsed.error) {
        const summary = await directorySummary();
        if (parsed.action === 'list' && !summary.professors.length) return await reply('نگاشت استادی ثبت نشده است.\n' + CLASS_HELP);
        if (parsed.action === 'list') {
          return await reply(['نگاشت کد استاد به نام:',
            ...summary.professors.slice(0, 100).map(p => `${p.code} — ${p.name}`)].join('\n'));
        }
        return await reply(`ورودی نامعتبر است.\n\n${CLASS_HELP}`);
      }
      if (parsed.action === 'delete') {
        const removed = await deleteProfessor(parsed.code);
        return await reply(`نگاشت کد ${removed.code} حذف شد.`);
      }
      const saved = await setProfessor(parsed.code, parsed.name, fromId);
      return await reply(`ثبت شد: ${saved.code} — ${saved.name}`);
    }

    // /class
    if (!args.length) return await reply(CLASS_HELP);
    const parsed = parseClassCommand(args);
    const errors = { COURSE_ID: 'شماره درس را بنویسید: /class 1413', CODE: 'کد درس باید ۱۳ رقمی مثل 4051-1111166-17 باشد.',
      LABEL: 'نام کلاس را بنویسید.', PROFESSOR: 'نام یا کد استاد را بنویسید.',
      SLOTS: 'ساعت کلاس را مثل «یک‌شنبه 10:00-11:30» بنویسید.', SUBCOMMAND: 'زیرفرمان نامعتبر است.' };
    if (parsed.error) return await reply(`${errors[parsed.error] ?? 'ورودی نامعتبر است.'}\n\n${CLASS_HELP}`);

    const courses = (await getSetting('courses')) ?? [];
    const course = courses.find(c => String(c.id) === String(parsed.courseId));
    if (!course) return await reply(`درس #${parsed.courseId} در فهرست پوشش نیست. با /classes فهرست را ببینید.`);
    const key = courseKey({ id: parsed.courseId });
    const professors = await professorMap();

    if (parsed.action === 'clear') {
      await deleteBinding(key);
      return await reply(`تنظیم درس #${parsed.courseId} حذف شد.`);
    }
    if (parsed.action === 'show') {
      const binding = await getBinding(key);
      const detection = (await getSetting('courseDetection'));
      const found = detection?.results?.find(r => Number(r.id) === Number(parsed.courseId));
      const nameCode = parseCourseCode(course.fullname)?.code ?? null;
      const siteCodes = ((await getSetting('siteCourseCodes'))?.codes) ?? {};
      return await reply([`#${course.id} ${course.fullname}`,
        `کد از نام درس: ${nameCode ?? 'نامشخص'}`,
        `کد از سایت: ${siteCodes[String(course.id)] ?? 'نامشخص'}`,
        `تنظیم فعلی: ${describeBinding(binding, professors)}`,
        found ? `بررسی صفحه: کد ${found.detected?.codes?.join('، ') || 'نامشخص'} · استاد ${found.detected?.teachers?.join('، ') || 'نامشخص'}` : '',
        `بررسی صفحه درس: /class ${course.id} detect`].filter(Boolean).join('\n'));
    }
    if (parsed.action === 'detect') {
      const record = await detectClassInfo([parsed.courseId], 1);
      const entry = record.results[0];
      return await reply([`#${entry.id} ${entry.name}`,
        `کد کامل از فهرست دروس سایت: ${entry.siteCode ?? 'نامشخص'}`,
        `کد در نام خود درس: ${entry.codeFromName ?? 'نامشخص'}`,
        entry.detected?.available
          ? `کدهای صفحه: ${entry.detected.codes?.join('، ') || 'نامشخص'} · استاد: ${entry.detected.teachers?.join('، ') || 'نامشخص'}`
          : (entry.siteCode ? '' : `صفحه درس خوانده نشد (${entry.detected?.reason ?? entry.error ?? 'نامشخص'})`)].filter(Boolean).join('\n'));
    }

    const patch = parsed.action === 'code' ? { code: parsed.code, label: parsed.label }
      : parsed.action === 'label' ? { label: parsed.label }
      : parsed.action === 'professor' ? (parsed.professorCode ? { professorCode: parsed.professorCode } : { professorName: parsed.professorName })
      : { slots: parsed.slots };
    await setBinding(key, patch, fromId);
    const saved = await getBinding(key);
    return await reply(`#${course.id} ${course.fullname}\n${describeBinding(saved, professors)}`);
  }

  if (command === '/approve' || command === '/revoke') {
    if (!isPrivate || !owner) return;
    const target = Number(args[0]);
    if (!Number.isSafeInteger(target) || target <= 0) return await reply(`Usage: ${command} <telegram id> [label]`);
    if (target === OWNER_ID) return await reply('That is the owner ID.');
    if (command === '/approve') {
      await approveContributor(target, args.slice(1).join(' '));
      try { await api.sendMessage({ chat_id: target, text: 'You are approved. Open /setup in this bot and connect your own university account.' }); } catch { /* they may not have started the bot yet */ }
      return await reply(`Approved ${target}. They can now connect their own account with /setup.`);
    }
    const result = await revokeContributor(target);
    return await reply(`Revoked ${target}. ${result.disabled} of their connections were disabled; nothing was deleted.`);
  }

  if (command === '/unbind' || command === '/destination') {
    if (!isPrivate || !owner) return;
    if (command === '/destination') return await reply(`Destination: ${describeDestination(destination)}`);
    await putSetting('destination', null);
    await putSetting('groupId', 0);
    return await reply('Destination cleared. Course notifications stop until /bind is run again.');
  }

  if (command === '/digest') {
    if (!isPrivate || !owner) return;
    try {
      const result = await publishDigests(args.length ? args : null);
      return await reply(result.sent ? `Published ${result.sent} initial digest(s). ${result.remaining} still pending.` : 'No initial digest is pending.');
    } catch (e) {
      return await reply(e?.message === 'GROUP_NOT_CONFIGURED' ? 'No destination bound yet.' : 'Could not publish the digest.');
    }
  }

  const courses = (await getSetting('courses')) ?? [];
  if (command === '/courses') {
    return await reply(courses.map(c => c.fullname).join('\n') || 'Run the first check after setup.');
  }

  const rows = await db.select().from(snapshots).all();
  // The same class identity the group notices carry, so a list entry is attributable.
  const directory = await directorySummary();
  const lines = new Map(directory.courses.map(entry => [String(entry.id), entry.line]));
  const matches = rows.flatMap(row => {
    const items = Array.isArray(row.value) ? row.value : [];
    const id = courseIdFromKey(row.key);
    const course = courses.find(c => String(c.id) === id) ?? { fullname: id };
    return items
      .filter(item => command === '/assignments' ? item.kind === 'assign' : item.kind === 'quiz' || /آزمون|امتحان|میان.?ترم|exam|midterm/i.test(item.name))
      .map(item => notification(course, { ...item, change: 'updated' }, { classLine: lines.get(String(course.id)) }));
  });
  // This is a list from the last scan, not a fresh scan and not a future-only agenda.
  if (!matches.length) return await reply('No matching activities in the last scan.');
  await reply('Activities from the last scan (may include past deadlines):');
  let delivered = 0;
  for (const text of matches.slice(0, 20)) if (await reply(text)) delivered++;
  if (matches.length > 20) await reply('Showing the first 20 activities. Open the course site for the full list.');
  // Handlers' return values are ignored by Telegram; this makes the CLI show what
  // was actually rendered, including the class line, for verification.
  return { command, activities: matches.length, delivered, sample: matches[0].slice(0, 400) };
}

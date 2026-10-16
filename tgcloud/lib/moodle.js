import { BASE, ORIGIN } from './config.js';
import { participantProfessors, matchingParticipantsMany } from './participants.js';
import { plain, safeLink, parseCourse, parseAssignment, tree, nodes, nodeText, extractCourseMeta, extractEnrollmentCodes } from './content.js';

// What a scan can and cannot see (kept honest in the README as well):
//   reads: course modules, visible descriptions/dates, assignment introduction
//          attachments, quiz open/close from the API;
//   does not read: forum replies, folder internals, PDF bytes, binary files
//          replaced at an unchanged URL.
export const READ_CAPABILITIES = Object.freeze({
  modules: true, descriptions: true, dates: true, assignmentAttachments: true,
  forumReplies: false, folderInternals: false, fileContents: false, replacedAtSameUrl: false,
});

function code(error) {
  const message = String(error?.message ?? error ?? '');
  return /^[A-Z][A-Z_0-9]*$/.test(message) ? message : 'UNIVERSITY_ERROR';
}

export function classifyCode(c) {
  if (['UNIVERSITY_LOGIN_REQUIRED', 'MOODLE_API_ACCESS_DENIED', 'UNIVERSITY_HTTP_401', 'UNIVERSITY_HTTP_403'].includes(c)) return 'auth';
  if (['UNIVERSITY_UNREACHABLE', 'MOODLE_API_UNAVAILABLE', 'UNIVERSITY_HTTP_429', 'UNIVERSITY_HTTP_500', 'UNIVERSITY_HTTP_502', 'UNIVERSITY_HTTP_503', 'UNIVERSITY_HTTP_504'].includes(c)) return 'unreachable';
  if (['COURSE_LAYOUT', 'ASSIGNMENT_LAYOUT', 'COURSE_DISCOVERY_LAYOUT', 'COURSE_DISCOVERY_EMPTY'].includes(c)) return 'layout';
  return 'error';
}

export function classifyFailure(error) {
  return classifyCode(code(error));
}

export function isAuthFailure(error) {
  return classifyFailure(error) === 'auth';
}

export function failureCode(error) {
  return code(error);
}

// One connector per account. `credentials` is { mode, secret, origin? }; the
// origin must be the configured university origin — anything else is refused
// before a request is made, so a stored account can never point elsewhere.
export function connector(fetcher, credentials) {
  const { mode, secret } = credentials;
  const origin = credentials.origin ?? ORIGIN;
  if (origin !== BASE) throw new Error('ORIGIN_NOT_ALLOWED');
  async function request(path, options = {}) {
    let res;
    try { res = await fetcher(BASE + path, options); }
    catch { throw new Error('UNIVERSITY_UNREACHABLE'); }
    if (!res.ok) throw new Error(`UNIVERSITY_HTTP_${res.status}`);
    if (res.url && !res.url.startsWith(BASE + '/')) throw new Error('UNIVERSITY_LOGIN_REQUIRED');
    return res;
  }
  async function rpc(fn, args = {}) {
    const params = { wstoken: secret, moodlewsrestformat: 'json', wsfunction: fn, ...args };
    const body = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const res = await request('/webservice/rest/server.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    let data; try { data = await res.json(); } catch { throw new Error('MOODLE_API_UNAVAILABLE'); }
    if (data.exception || data.errorcode) throw new Error('MOODLE_API_ACCESS_DENIED');
    return data;
  }
  async function html(path) {
    const res = await request(path, { headers: { Cookie: 'MoodleSession=' + secret } });
    const body = await res.text();
    if (/id=["']page-login-index|id=["']loginbtn/.test(body) || /\/login\//.test(res.url ?? '')) throw new Error('UNIVERSITY_LOGIN_REQUIRED');
    return body;
  }
  return {
    async participantDirectory(course) {
      const teachers = new Set();
      const people = await this.findParticipants(course, null, teachers);
      return {people, professorName: teachers.size === 1 ? [...teachers][0] : null};
    },
    async participants(course) {
      return await this.findParticipants(course, null);
    },
    async findParticipant(course, query) {
      return await this.findParticipants(course, [{ name: query }]);
    },
    async findParticipants(course, queries, teachers = null) {
      if (mode !== 'session') throw new Error('PARTICIPANTS_SESSION_REQUIRED');
      const id = Number(course.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('COURSE_ID_REQUIRED');
      const matches = new Map(), visited = new Set(), pending = [0];
      while (pending.length) {
        const page = pending.shift();
        if (visited.has(page)) continue;
        if (visited.size >= 20) throw new Error('PARTICIPANTS_PAGE_LIMIT');
        visited.add(page);
        const body = await html('/user/index.php?id=' + id + '&perpage=5000&page=' + page);
        matchingParticipantsMany(body, queries).forEach(person => matches.set(person.id, person));
        const { pages, names } = participantProfessors(body);
        if (teachers) names.forEach(name => teachers.add(name));
        pending.push(...pages.filter(p => !visited.has(p)));
      }
      return [...matches.values()];
    },
    async professor(course) {
      if (mode !== 'session') return null;
      const id = Number(course.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('COURSE_ID_REQUIRED');
      const first = participantProfessors(await html('/user/index.php?id=' + id + '&perpage=5000'));
      const names = new Set(first.names);
      const pending = [...first.pages], visited = new Set([0]);
      while (pending.length) {
        const page = pending.shift();
        if (visited.has(page)) continue;
        if (visited.size >= 20) throw new Error('PARTICIPANTS_PAGE_LIMIT');
        visited.add(page);
        const next = participantProfessors(await html('/user/index.php?id=' + id + '&perpage=5000&page=' + page));
        next.names.forEach(name => names.add(name));
        pending.push(...next.pages.filter(p => !visited.has(p)));
      }
      // Do not guess when the course has zero or multiple professors.
      return names.size === 1 ? [...names][0] : null;
    },
    async courses() {
      if (mode === 'token') {
        const info = await rpc('core_webservice_get_site_info');
        if (!info.userid) throw new Error('MOODLE_API_ACCESS_DENIED');
        const result = await rpc('core_enrol_get_users_courses', { userid: info.userid });
        if (!Array.isArray(result)) throw new Error('MOODLE_COURSES_INVALID');
        return result.map(c => ({ id: c.id, fullname: plain(c.fullname), origin: BASE }));
      }
      // Calendar's server-rendered course selector includes all enrolled courses.
      const doc = tree(await html('/my/index.php'));
      const select = nodes(doc, n => n.tag === 'select' && /^calendar-course-filter-/.test(n.attrs.id ?? ''))[0];
      if (!select) throw new Error('COURSE_DISCOVERY_LAYOUT');
      const found = nodes(select, n => n.tag === 'option' && Number(n.attrs.value) > 1)
        .map(n => ({ id: Number(n.attrs.value), fullname: nodeText(n), origin: BASE }));
      if (!found.length) throw new Error('COURSE_DISCOVERY_EMPTY');
      return found;
    },
    // Every enrolled course's 13-digit code, read from the "My courses" block that
    // Moodle renders on the dashboard and on course pages. One request for all of them.
    async enrollmentCodes(courseHint = null) {
      if (mode !== 'session') return {};
      const paths = ['/my/index.php', ...(courseHint ? ['/course/view.php?id=' + courseHint] : [])];
      for (const path of paths) {
        try {
          const found = extractEnrollmentCodes(await html(path));
          if (Object.keys(found).length) return found;
        } catch { /* try the next page; a failure here is never fatal */ }
      }
      return {};
    },
    // Owner-triggered evidence: what the student-visible course page shows about the
    // class code and the professor. One extra request, so it is never part of a scan.
    async meta(course) {
      if (mode !== 'session') return { available: false, reason: 'TOKEN_MODE' };
      const body = await html('/course/view.php?id=' + course.id);
      return { available: true, ...extractCourseMeta(body) };
    },
    async items(course) {
      if (mode === 'session') {
        const items = parseCourse(await html('/course/view.php?id=' + course.id), BASE);
        for (const item of items) if (item.kind === 'assign') item.files = await parseAssignment(await html('/mod/assign/view.php?id=' + item.id), BASE);
        return items;
      }
      const sections = await rpc('core_course_get_contents', { courseid: course.id });
      if (!Array.isArray(sections)) throw new Error('MOODLE_CONTENTS_INVALID');
      const items = sections.flatMap(s => (s.modules ?? []).filter(m => m.uservisible !== false && m.visible !== 0).map(m => {
        const dates = (m.dates ?? []).filter(d => d.timestamp).map(d => `${plain(d.label)} ${new Date(d.timestamp * 1000).toISOString()} (UTC)`).join('\n');
        return { id: m.id, kind: m.modname, name: plain(m.name), description: plain(m.description), dates,
          url: safeLink(m.url, BASE) ?? BASE + '/course/view.php?id=' + course.id,
          files: (m.contents ?? []).filter(f => f.type === 'file').map(f => ({ name: f.filename, modified: f.timemodified, size: f.filesize })).sort((a,b) => a.name.localeCompare(b.name)) };
      })).filter(m => ['assign', 'quiz', 'resource', 'folder', 'forum', 'page', 'book', 'label'].includes(m.kind));
      if (items.some(m => m.kind === 'assign')) {
        const data = await rpc('mod_assign_get_assignments', { 'courseids[0]': course.id });
        if (!Array.isArray(data.courses)) throw new Error('MOODLE_ASSIGNMENTS_INVALID');
        for (const assignment of data.courses.flatMap(c => c.assignments ?? [])) {
          const item = items.find(m => m.id === assignment.cmid); if (!item) continue;
          item.dates = assignment.duedate ? 'مهلت: ' + new Date(assignment.duedate * 1000).toISOString() + ' (UTC)' : '';
          item.description = plain(assignment.intro);
          item.files = (assignment.introattachments ?? []).map(f => ({ name: f.filename, modified: f.timemodified, size: f.filesize })).sort((a,b) => a.name.localeCompare(b.name));
        }
      }
      if (items.some(m => m.kind === 'quiz')) {
        const data = await rpc('mod_quiz_get_quizzes_by_courses', { 'courseids[0]': course.id });
        if (!Array.isArray(data.quizzes)) throw new Error('MOODLE_QUIZZES_INVALID');
        for (const quiz of data.quizzes) {
          const item = items.find(m => m.id === quiz.coursemodule); if (!item) continue;
          item.dates = [quiz.timeopen ? 'شروع: ' + new Date(quiz.timeopen * 1000).toISOString() : '', quiz.timeclose ? 'پایان: ' + new Date(quiz.timeclose * 1000).toISOString() : ''].filter(Boolean).join('\n');
        }
      }
      return items;
    },
  };
}

import { changeSet, mergeBaseline } from './content.js';
import { courseKey } from './plan.js';

function failureCode(error) {
  const message = String(error?.message ?? '');
  return /^[A-Z][A-Z_0-9]*$/.test(message) ? message : 'COURSE_SCAN_FAILED';
}

// Dependencies are explicit so delivery and recovery behavior can be tested locally.
// A course carries `readers` (account ids, preferred first); a read failure moves
// on to the next account, and only when every reader failed does the course count
// as a partial failure. One failing account/course never stops the others.
export async function syncCourses({ courses, read, load, save, send, onAttemptError, onBaseline }) {
  let sent = 0, baselined = 0, readerChanges = 0, absorbed = 0;
  const failures = [], baselineKeys = [];

  async function readCourse(course) {
    const readers = course.readers?.length ? course.readers : [null];
    let last;
    for (const readerId of readers) {
      try { return { items: await read({ ...course, reader: readerId }, readerId), reader: readerId }; }
      catch (e) { last = e; if (onAttemptError) onAttemptError(course, readerId, e); }
    }
    throw last;
  }

  for (const course of courses) {
    const key = courseKey(course);
    try {
      const { items: current, reader } = await readCourse(course);
      const loaded = await load(key);
      const previous = Array.isArray(loaded) ? { items: loaded } : loaded ?? {};
      if (previous.items === undefined) {
        // Newly discovered course: record what exists now, announce nothing.
        await save(key, current, reader);
        baselined++; baselineKeys.push(key);
        if (onBaseline) await onBaseline(course, current);
        continue;
      }
      const accountChanged = !!previous.reader && previous.reader !== reader;
      if (accountChanged) readerChanges++;
      const next = mergeBaseline(previous.items, current);
      const { announce, absorbed: narrowed } = changeSet(previous.items, next, current);
      absorbed += narrowed;
      // Only changes that were actually delivered are acknowledged, so a crash or
      // a failed send is retried by the next scan instead of being lost.
      let acknowledged = [...previous.items];
      for (const item of announce) {
        await send(course, item);
        acknowledged = [...acknowledged.filter(x => x.id !== item.id), next.find(x => x.id === item.id)];
        await save(key, acknowledged, previous.reader ?? reader);
        sent++;
      }
      await save(key, next, reader);
    } catch (e) {
      failures.push({ course: key, code: failureCode(e) });
    }
  }
  return { sent, baselined, readerChanges, absorbed, baselineKeys, failures };
}

import { db } from './database.js';
import { eq } from './database.js';
import { settings } from '../schema.js';

export async function getSetting(key) {
  return (await db.select().from(settings).where(eq(settings.key, key)).get())?.value;
}
export async function putSetting(key, value) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
export async function delSetting(key) {
  await db.delete(settings).where(eq(settings.key, key)).run();
}

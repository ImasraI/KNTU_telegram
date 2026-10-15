import { db } from 'sdk';
import { eq } from 'sdk/db';
import { professors, classBindings } from '../schema.js';
import { normalizeSpaces } from './classes.js';

// The professor directory: the code segment the university prints → a name.
export async function professorMap() {
  const rows = await db.select().from(professors).all();
  return new Map(rows.map(row => [String(row.code), row.name]));
}

export async function professorRows() {
  return await db.select().from(professors).all();
}

export async function setProfessor(code, name, by = null) {
  const key = normalizeSpaces(code).slice(0, 20);
  if (!key) throw new Error('PROFESSOR_CODE_REQUIRED');
  const clean = normalizeSpaces(name).slice(0, 60);
  if (!clean) throw new Error('PROFESSOR_NAME_REQUIRED');
  const set = { name: clean, updatedBy: by, updatedAt: new Date() };
  await db.insert(professors).values({ code: key, ...set }).onConflictDoUpdate({ target: professors.code, set }).run();
  return { code: key, name: clean };
}

export async function deleteProfessor(code) {
  const key = normalizeSpaces(code).slice(0, 20);
  await db.delete(professors).where(eq(professors.code, key)).run();
  return { code: key };
}

export async function bindingMap() {
  const rows = await db.select().from(classBindings).all();
  return new Map(rows.map(row => [row.key, row]));
}

export async function getBinding(key) {
  return (await db.select().from(classBindings).where(eq(classBindings.key, key)).get()) ?? null;
}

export async function deleteBinding(key) {
  await db.delete(classBindings).where(eq(classBindings.key, key)).run();
}

// Partial update: one command changes one field without clearing the others.
export async function setBinding(key, patch = {}, by = null) {
  const existing = (await getBinding(key)) ?? {};
  const merged = {
    key,
    code: patch.code !== undefined ? (patch.code ?? null) : (existing.code ?? null),
    label: patch.label !== undefined ? (patch.label ?? null) : (existing.label ?? null),
    professorCode: patch.professorCode !== undefined ? (patch.professorCode ?? null) : (existing.professorCode ?? null),
    professorName: patch.professorName !== undefined ? (patch.professorName ?? null) : (existing.professorName ?? null),
    slots: patch.slots !== undefined ? (patch.slots ?? []) : (existing.slots ?? []),
    source: patch.source ?? existing.source ?? 'manual',
    updatedBy: by,
    updatedAt: new Date(),
  };
  await db.insert(classBindings).values(merged).onConflictDoUpdate({ target: classBindings.key, set: merged }).run();
  return merged;
}

export function bindingView(row, professorsMap) {
  if (!row) return null;
  const map = professorsMap instanceof Map ? professorsMap : new Map();
  return {
    key: row.key, code: row.code ?? null, label: row.label ?? null,
    professorCode: row.professorCode ?? null, professorName: row.professorName ?? null,
    professor: row.professorName ?? (row.professorCode ? (map.get(String(row.professorCode)) ?? null) : null),
    slots: Array.isArray(row.slots) ? row.slots : [],
    source: row.source ?? null,
  };
}

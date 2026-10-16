import { fetch } from 'sdk';
import * as schema from '../schema.js';
import { storageModel } from './storage-model.js';
import { createDatabase } from './d1-query.js';
import { DATABASE_KEY } from './database-secret.js';
export { eq, inArray, sql } from './d1-query.js';

export const DATABASE_URL = 'https://kntu-shared-bot.arsamalaei90.workers.dev/query';
export const db = createDatabase(schema, storageModel, async query => {
  let response;
  try {
    response = await fetch(DATABASE_URL, {method:'POST',headers:{Authorization:'Bearer '+DATABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify(query)});
  } catch { throw new Error('SHARED_DATABASE_UNAVAILABLE'); }
  if (!response.ok) throw new Error('SHARED_DATABASE_UNAVAILABLE');
  const result = await response.json();
  if (!result || !Array.isArray(result.rows) || !Number.isFinite(result.changes)) throw new Error('SHARED_DATABASE_INVALID_RESPONSE');
  return result;
});

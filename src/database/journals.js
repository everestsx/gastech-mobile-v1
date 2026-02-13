/**
 * Local CRUD for account_journals (Odoo account.journal - cash/bank).
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

function strOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function upsertJournals(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO account_journals (id, name, code, type, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [num(r.id), empty(r.name), strOrNull(r.code), strOrNull(r.type), now]
      );
    }
  });
}

export async function getAllJournals() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT id, name, code, type FROM account_journals ORDER BY type ASC, name ASC'
  );
  return rows || [];
}

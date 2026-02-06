/**
 * Local CRUD for account_journals (Odoo account.journal - cash/bank).
 */
import { getDb } from './db.js';
import { empty, iso } from './dbHelpers.js';

export async function upsertJournals(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO account_journals (id, name, code, type, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [r.id != null ? r.id : 0, empty(r.name), r.code != null && r.code !== '' ? r.code : null, r.type != null && r.type !== '' ? r.type : null, now]
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

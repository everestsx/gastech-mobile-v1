/**
 * Local SQLite space recovery.
 * SQLITE_FULL happens when the phone has no free storage OR the WAL / leftover
 * synced rows grew until the app data folder cannot accept another write.
 * All helpers take the already-open DB (never getDb) so they can run inside the
 * serialized write queue without deadlocking.
 */

export function isSqliteFullError(err) {
  const raw = String(err?.message || err || '');
  return /SQLITE_FULL|database or disk is full|disk is full|ENOSPC|no space left/i.test(raw);
}

export function sqliteFullUserMessage() {
  return 'This phone is out of storage, so the app could not save. Free space (photos, WhatsApp, downloads), then try again.';
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(1, Number(days) || 7));
  return d.toISOString();
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function deleteByIds(db, table, ids) {
  const list = (ids || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  const CHUNK = 80;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    await db.runAsync(`DELETE FROM ${table} WHERE id IN (${ph})`, chunk);
  }
}

/** Uploaded delivery/inventory/cancel payloads are leftover JSON; payment rows stay (duplicate-pay guard). */
async function deleteOldSyncedNonPaymentQueue(db, { aggressive = false } = {}) {
  let rows;
  try {
    rows = await db.getAllAsync(
      `SELECT id, action_type, created_at, synced_at
       FROM sync_queue
       WHERE action_type != 'payment'
         AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)`
    );
  } catch (_) {
    return;
  }
  const cutoffMs = Date.now() - (aggressive ? 0 : 3 * 24 * 60 * 60 * 1000);
  const ids = [];
  for (const row of rows || []) {
    const t = Date.parse(String(row.synced_at || row.created_at || ''));
    if (!Number.isFinite(t) || t <= cutoffMs) ids.push(row.id);
  }
  await deleteByIds(db, 'sync_queue', ids);
}

async function pruneSyncLog(db) {
  try {
    await db.runAsync(
      `DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 80)`
    );
  } catch (_) {
    /* table may be missing on very old DBs */
  }
}

async function pruneDeliveryQtyAudit(db) {
  try {
    await db.runAsync('DELETE FROM delivery_qty_audit WHERE created_at < ?', [daysAgoIso(14)]);
  } catch (_) {
    /* table added in later migrations */
  }
}

/** image_1920 is no longer pulled on routine sync; leftover base64 is dead weight. */
async function clearStoredProductImages(db) {
  try {
    await db.runAsync(
      `UPDATE products SET image_1920 = NULL
       WHERE image_1920 IS NOT NULL AND TRIM(image_1920) != ''`
    );
  } catch (_) {
    /* column may be missing */
  }
}

/** Last-resort: drop reprint signatures on invoices already uploaded. */
async function clearSyncedInvoiceSignatures(db) {
  try {
    await db.runAsync(
      `UPDATE local_invoices
       SET customer_signature_data = '', driver_signature_data = ''
       WHERE synced_at IS NOT NULL AND TRIM(synced_at) != ''
         AND (
           LENGTH(COALESCE(customer_signature_data, '')) > 200
           OR LENGTH(COALESCE(driver_signature_data, '')) > 200
         )`
    );
  } catch (_) {
    /* columns may be missing */
  }
}

async function deleteSyncedAttachmentRows(db) {
  try {
    await db.runAsync(
      `DELETE FROM offline_attachments
       WHERE sync_status IN ('synced', 'failed')
         AND created_at < ?`,
      [daysAgoIso(7)]
    );
  } catch (_) {
    /* ignore */
  }
}

async function checkpointWal(db) {
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (_) {
    try {
      await db.execAsync('PRAGMA wal_checkpoint(PASSIVE)');
    } catch (e) {
      console.warn('[DB] wal_checkpoint', e?.message ?? e);
    }
  }
}

/**
 * Free local SQLite / WAL space. Safe to run after a successful sync or on SQLITE_FULL.
 * @param {object} db raw expo-sqlite connection
 */
export async function reclaimSqliteSpaceOnDb(db, { aggressive = false } = {}) {
  await deleteOldSyncedNonPaymentQueue(db, { aggressive });
  await pruneSyncLog(db);
  await pruneDeliveryQtyAudit(db);
  await clearStoredProductImages(db);
  await deleteSyncedAttachmentRows(db);
  if (aggressive) {
    await clearSyncedInvoiceSignatures(db);
  }
  await checkpointWal(db);
  if (aggressive) {
    try {
      await db.execAsync('VACUUM');
    } catch (e) {
      console.warn('[DB] VACUUM skipped', e?.message ?? e);
    }
  }
}

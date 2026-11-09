/**
 * Local SQLite / AsyncStorage space recovery.
 *
 * SQLITE_FULL (code 13) happens when:
 * 1) The phone has no free storage, OR
 * 2) App data grew (WAL, synced queue JSON, product image base64, invoice signatures,
 *    checkout signature keys in AsyncStorage) until the app sandbox cannot accept another write.
 *
 * AsyncStorage on Android is itself SQLite-backed, so a full app sandbox surfaces as
 * SQLITE_FULL even on login session writes — not only on gastech.db.
 *
 * Helpers that take `db` must run inside the serialized write queue (never call getDb).
 */

export function isSqliteFullError(err) {
  const raw = String(err?.message || err || '');
  return /SQLITE_FULL|database or disk is full|disk is full|ENOSPC|no space left/i.test(raw);
}

export function sqliteFullUserMessage() {
  return 'This phone is low on storage, so the app could not save. Free some space (photos, WhatsApp, downloads), then try again. The app also cleared old local cache automatically.';
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(1, Number(days) || 7));
  return d.toISOString();
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
  const cutoffMs = Date.now() - (aggressive ? 0 : 24 * 60 * 60 * 1000);
  const ids = [];
  for (const row of rows || []) {
    const t = Date.parse(String(row.synced_at || row.created_at || ''));
    if (!Number.isFinite(t) || t <= cutoffMs) ids.push(row.id);
  }
  await deleteByIds(db, 'sync_queue', ids);
}

/** Synced payment queue JSON is large; keep a short window for duplicate-pay guards only. */
async function deleteOldSyncedPaymentQueue(db, { aggressive = false } = {}) {
  let rows;
  try {
    rows = await db.getAllAsync(
      `SELECT id, created_at, synced_at
       FROM sync_queue
       WHERE action_type = 'payment'
         AND (COALESCE(is_uploaded, 0) = 1 OR synced_at IS NOT NULL)`
    );
  } catch (_) {
    return;
  }
  const keepDays = aggressive ? 3 : 14;
  const cutoffMs = Date.now() - keepDays * 24 * 60 * 60 * 1000;
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
    await db.runAsync(
      `DELETE FROM delivery_qty_audit WHERE id NOT IN (SELECT id FROM delivery_qty_audit ORDER BY id DESC LIMIT 80)`
    );
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

/**
 * Drop reprint signatures on invoices already uploaded.
 * These PNG data-URLs are often the largest rows in the DB.
 * Unsynced invoices keep signatures so Complete/upload still works.
 */
async function clearSyncedInvoiceSignatures(db, { aggressive = false } = {}) {
  try {
    if (aggressive) {
      await db.runAsync(
        `UPDATE local_invoices
         SET customer_signature_data = '', driver_signature_data = ''
         WHERE synced_at IS NOT NULL AND TRIM(synced_at) != ''`
      );
    } else {
      await db.runAsync(
        `UPDATE local_invoices
         SET customer_signature_data = '', driver_signature_data = ''
         WHERE synced_at IS NOT NULL AND TRIM(synced_at) != ''
           AND (
             LENGTH(COALESCE(customer_signature_data, '')) > 200
             OR LENGTH(COALESCE(driver_signature_data, '')) > 200
           )`
      );
    }
  } catch (_) {
    /* columns may be missing */
  }
}

async function deleteSyncedAttachmentRows(db, { aggressive = false } = {}) {
  try {
    await db.runAsync(
      `DELETE FROM offline_attachments
       WHERE sync_status IN ('synced', 'failed')
         AND created_at < ?`,
      [daysAgoIso(aggressive ? 1 : 7)]
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
 * Free local SQLite / WAL space. Safe after sync or on SQLITE_FULL.
 * @param {object} db raw expo-sqlite connection
 */
export async function reclaimSqliteSpaceOnDb(db, { aggressive = false } = {}) {
  await deleteOldSyncedNonPaymentQueue(db, { aggressive });
  await deleteOldSyncedPaymentQueue(db, { aggressive });
  await pruneSyncLog(db);
  await pruneDeliveryQtyAudit(db);
  await clearStoredProductImages(db);
  await deleteSyncedAttachmentRows(db, { aggressive });
  // Signatures on synced invoices: always strip large ones; wipe all when aggressive.
  await clearSyncedInvoiceSignatures(db, { aggressive: true });
  await checkpointWal(db);
  if (aggressive) {
    try {
      await db.execAsync('VACUUM');
    } catch (e) {
      console.warn('[DB] VACUUM skipped', e?.message ?? e);
    }
  }
}

const CHECKOUT_SIG_PREFIX = 'gastech_checkout_sig_v1_';
const CUSTOMER_PARTY_PREFIX = '@gastech_invoice_customer_party_v1:';
const PORTERS_CACHE_KEY = '@gastech_porters_cache_v1';
const DATA_USAGE_EVENTS_KEY = '@gastech_data_usage_events_v1';
const CHECKOUT_RESUME_KEY = 'gastech_checkout_resume_v1';

/**
 * Clear large / stale AsyncStorage keys that share the phone's app sandbox with SQLite.
 * Safe for login recovery: keeps core session keys; drops orphan checkout signatures and caches.
 */
export async function clearStaleAsyncStorageBloat({ aggressive = false } = {}) {
  let AsyncStorage;
  try {
    AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  } catch (_) {
    return { removed: 0 };
  }

  let keys = [];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch (_) {
    return { removed: 0 };
  }

  let resumeIds = new Set();
  try {
    const raw = await AsyncStorage.getItem(CHECKOUT_RESUME_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      if (map && typeof map === 'object') {
        resumeIds = new Set(Object.keys(map));
      }
    }
  } catch (_) {
    /* ignore */
  }

  const toRemove = [];
  for (const k of keys || []) {
    if (typeof k !== 'string') continue;
    if (k.startsWith(CHECKOUT_SIG_PREFIX)) {
      const soId = k.slice(CHECKOUT_SIG_PREFIX.length);
      // Keep signatures for in-progress checkout; drop orphans (biggest AsyncStorage bloat).
      if (aggressive || !resumeIds.has(soId)) toRemove.push(k);
      continue;
    }
    if (aggressive && k.startsWith(CUSTOMER_PARTY_PREFIX)) {
      toRemove.push(k);
    }
  }

  if (toRemove.length > 0) {
    try {
      await AsyncStorage.multiRemove(toRemove);
    } catch (e) {
      console.warn('[DB] AsyncStorage multiRemove', e?.message ?? e);
    }
  }

  // Porters cache can hold dozens of image_1920 base64 blobs — strip images, keep roster.
  try {
    const raw = await AsyncStorage.getItem(PORTERS_CACHE_KEY);
    if (raw && (aggressive || raw.length > 200_000)) {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      const slim = rows.map((p) =>
        p && typeof p === 'object' ? { ...p, imageBase64: null } : p
      );
      await AsyncStorage.setItem(
        PORTERS_CACHE_KEY,
        JSON.stringify({ savedAt: parsed?.savedAt || Date.now(), rows: slim })
      );
    }
  } catch (_) {
    /* ignore */
  }

  // Trim data-usage event log if it ballooned.
  try {
    const raw = await AsyncStorage.getItem(DATA_USAGE_EVENTS_KEY);
    if (raw && raw.length > 150_000) {
      const events = JSON.parse(raw);
      if (Array.isArray(events) && events.length > 40) {
        await AsyncStorage.setItem(DATA_USAGE_EVENTS_KEY, JSON.stringify(events.slice(-40)));
      }
    }
  } catch (_) {
    /* ignore */
  }

  return { removed: toRemove.length };
}

const WEEKLY_MAINTENANCE_KEY = '@gastech_weekly_storage_maintenance_v1';
const WEEKLY_MAINTENANCE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Once per week (per device): prune expired delivery history, aggressively reclaim SQLite/WAL,
 * and clear orphan AsyncStorage signature/cache bloat so SQLITE_FULL does not block login.
 * Safe to call often — no-ops until 7 days have passed (unless force=true).
 */
export async function runWeeklyStorageMaintenanceIfDue({ force = false } = {}) {
  let AsyncStorage;
  try {
    AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  } catch (_) {
    return { ran: false, reason: 'no_async_storage' };
  }

  let lastAt = 0;
  try {
    const raw = await AsyncStorage.getItem(WEEKLY_MAINTENANCE_KEY);
    lastAt = raw ? Date.parse(String(raw)) : 0;
  } catch (_) {
    lastAt = 0;
  }
  if (!force && Number.isFinite(lastAt) && lastAt > 0 && Date.now() - lastAt < WEEKLY_MAINTENANCE_MS) {
    return { ran: false, reason: 'not_due' };
  }

  let pruned = 0;
  try {
    const { pruneExpiredLocalDeliveryHistory } = await import(
      '../services/vehicleHistoryRetention.service.js'
    );
    const result = await pruneExpiredLocalDeliveryHistory({});
    pruned = Number(result?.deleted) || 0;
  } catch (e) {
    console.warn('[DB] weekly retention prune', e?.message ?? e);
  }

  try {
    const { reclaimSqliteSpace } = await import('./db.js');
    await reclaimSqliteSpace({ aggressive: true });
  } catch (e) {
    console.warn('[DB] weekly sqlite reclaim', e?.message ?? e);
  }

  let asyncRemoved = 0;
  try {
    const r = await clearStaleAsyncStorageBloat({ aggressive: true });
    asyncRemoved = Number(r?.removed) || 0;
  } catch (e) {
    console.warn('[DB] weekly AsyncStorage reclaim', e?.message ?? e);
  }

  try {
    await AsyncStorage.setItem(WEEKLY_MAINTENANCE_KEY, new Date().toISOString());
  } catch (_) {
    /* ignore — next launch will retry */
  }

  return { ran: true, pruned, asyncRemoved };
}

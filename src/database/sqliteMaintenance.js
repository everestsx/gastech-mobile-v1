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
const CUSTOMER_PARTY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Clear large / stale AsyncStorage keys that share the phone's app sandbox with SQLite.
 * Safe for login recovery: keeps core session keys; drops orphan checkout signatures and caches.
 */
export async function clearStaleAsyncStorageBloat({ aggressive = false, recordHistory = true } = {}) {
  // Monitoring only (Storage Management screen) — counts what the rules below actually did.
  const startedAt = Date.now();
  const report = newCleanupReport();
  let before = null;
  let mutated = false;
  const beforeMutation = async () => {
    mutated = true;
    if (before == null) before = await safeMeasureAsyncStorage();
  };
  const finish = (result) => {
    if (recordHistory && (mutated || report.errors.length > 0)) {
      recordCleanupInBackground({
        trigger: aggressive ? 'emergency' : 'automatic',
        startedAt,
        before,
        measureAfter: mutated,
        report,
      });
    }
    return { ...result, report, before };
  };

  let AsyncStorage;
  try {
    AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  } catch (e) {
    report.errors.push(`AsyncStorage unavailable: ${e?.message ?? e}`);
    return finish({ removed: 0 });
  }

  let keys = [];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch (e) {
    report.errors.push(`Could not list AsyncStorage keys: ${e?.message ?? e}`);
    return finish({ removed: 0 });
  }

  // null = resume map could not be read → we cannot tell which checkouts are in progress,
  // so no signature is deleted this run.
  let resumeIds = null;
  try {
    const raw = await AsyncStorage.getItem(CHECKOUT_RESUME_KEY);
    resumeIds = new Set();
    if (raw) {
      const map = JSON.parse(raw);
      if (map && typeof map === 'object') {
        resumeIds = new Set(Object.keys(map));
      }
    }
  } catch (_) {
    resumeIds = null;
  }

  const toRemove = [];
  const partyKeys = [];
  for (const k of keys || []) {
    if (typeof k !== 'string') continue;
    if (k.startsWith(CHECKOUT_SIG_PREFIX)) {
      const soId = k.slice(CHECKOUT_SIG_PREFIX.length);
      // Orphan signatures only (checkout finished / abandoned). Never an in-progress checkout,
      // even in aggressive mode — Invoice / Payment Proof still read them after an app restart.
      if (resumeIds && !resumeIds.has(soId)) {
        toRemove.push(k);
        report.items.signatures++;
      }
      continue;
    }
    if (aggressive && k.startsWith(CUSTOMER_PARTY_PREFIX)) {
      partyKeys.push(k);
    }
  }

  // Customer invoice-party cache (address / TIN for offline invoice print): drop only entries
  // not refreshed for CUSTOMER_PARTY_MAX_AGE_MS. Recent customers stay so offline print keeps working.
  if (partyKeys.length > 0) {
    const cutoff = Date.now() - CUSTOMER_PARTY_MAX_AGE_MS;
    for (let i = 0; i < partyKeys.length; i += 100) {
      const chunk = partyKeys.slice(i, i + 100);
      let pairs = [];
      try {
        pairs = await AsyncStorage.multiGet(chunk);
      } catch (_) {
        continue;
      }
      for (const [k, v] of pairs || []) {
        let cachedAt = NaN;
        try {
          cachedAt = Number(JSON.parse(v)?._cachedAt);
        } catch (_) {
          /* unparseable → treated as stale */
        }
        if (!Number.isFinite(cachedAt) || cachedAt < cutoff) {
          toRemove.push(k);
          report.items.customerCache++;
        }
      }
    }
  }

  if (toRemove.length > 0) {
    await beforeMutation();
    try {
      await AsyncStorage.multiRemove(toRemove);
    } catch (e) {
      console.warn('[DB] AsyncStorage multiRemove', e?.message ?? e);
      report.errors.push(`Remove signatures / customer cache failed: ${e?.message ?? e}`);
      report.items.signatures = 0;
      report.items.customerCache = 0;
    }
  }

  // Porters cache can hold dozens of image_1920 base64 blobs — strip images, keep roster.
  let portersRaw = null;
  let portersReadable = true;
  try {
    portersRaw = await AsyncStorage.getItem(PORTERS_CACHE_KEY);
  } catch (e) {
    // Android cannot read a single AsyncStorage row larger than ~2 MB (CursorWindow).
    // An all-porters image_1920 cache crosses that, after which neither this cleanup nor
    // employee.service readPortersCache() (returns []) can use it — it only occupies the
    // 6 MB AsyncStorage DB. Drop it; the next online login re-fetches the roster.
    portersReadable = false;
    console.warn('[DB] porters cache unreadable — removing', e?.message ?? e);
  }
  if (portersReadable && portersRaw && (aggressive || portersRaw.length > 200_000)) {
    let parsed = null;
    try {
      parsed = JSON.parse(portersRaw);
    } catch (_) {
      portersReadable = false; // corrupt — readPortersCache() already treats it as empty
    }
    if (parsed) {
      try {
        const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
        const photoCount = rows.filter((p) => p && typeof p === 'object' && p.imageBase64).length;
        if (photoCount > 0) await beforeMutation();
        const slim = rows.map((p) =>
          p && typeof p === 'object' ? { ...p, imageBase64: null } : p
        );
        await AsyncStorage.setItem(
          PORTERS_CACHE_KEY,
          JSON.stringify({ savedAt: parsed?.savedAt || Date.now(), rows: slim })
        );
        report.items.porterPhotos += photoCount;
      } catch (e) {
        report.errors.push(`Shrink porter cache failed: ${e?.message ?? e}`);
      }
    }
  }
  if (!portersReadable) {
    await beforeMutation();
    try {
      await AsyncStorage.removeItem(PORTERS_CACHE_KEY);
      report.items.porterCacheRemoved = true;
    } catch (e) {
      report.errors.push(`Remove unreadable porter cache failed: ${e?.message ?? e}`);
    }
  }

  // Trim data-usage event log if it ballooned. Events are stored newest-first
  // (dataUsage.service: [event, ...current]) so keep the head, not the tail.
  try {
    const raw = await AsyncStorage.getItem(DATA_USAGE_EVENTS_KEY);
    if (raw && raw.length > 150_000) {
      const events = JSON.parse(raw);
      if (Array.isArray(events) && events.length > 40) {
        await beforeMutation();
        await AsyncStorage.setItem(DATA_USAGE_EVENTS_KEY, JSON.stringify(events.slice(0, 40)));
        report.items.usageEvents += events.length - 40;
      }
    }
  } catch (e) {
    report.errors.push(`Trim data-usage log failed: ${e?.message ?? e}`);
  }

  return finish({ removed: toRemove.length });
}

/* ---------- Storage Management monitoring (does not change what is cleaned) ---------- */

function newCleanupReport() {
  return {
    items: {
      signatures: 0,
      customerCache: 0,
      porterPhotos: 0,
      porterCacheRemoved: false,
      usageEvents: 0,
      deliveryHistoryRows: 0,
    },
    errors: [],
  };
}

async function safeMeasureAsyncStorage() {
  try {
    const { measureAsyncStorageUsage } = await import('../services/storageMonitor.service.js');
    return await measureAsyncStorageUsage({ includeFile: false });
  } catch (_) {
    return null;
  }
}

function summarizeMeasure(m) {
  if (!m) return null;
  return { dataBytes: m.dataBytes, keyCount: m.keyCount, unreadableKeys: (m.unreadableKeys || []).length };
}

function cleanupStatus(report) {
  const i = report.items;
  const changed =
    i.signatures > 0 ||
    i.customerCache > 0 ||
    i.porterPhotos > 0 ||
    i.porterCacheRemoved ||
    i.usageEvents > 0 ||
    i.deliveryHistoryRows > 0;
  if (report.errors.length > 0) return changed ? 'partial' : 'failed';
  return changed ? 'success' : 'nothing_to_clean';
}

/**
 * Measures AsyncStorage after the run and appends the real result to the history.
 * Fire-and-forget: never awaited by cleanup callers (the SQLITE_FULL path runs inside the
 * gastech.db write queue, and the history write itself goes through that queue).
 */
function recordCleanupInBackground({ trigger, startedAt, before, measureAfter, report }) {
  void (async () => {
    try {
      const after = measureAfter ? await safeMeasureAsyncStorage() : null;
      const freedBytes = before && after ? Math.max(0, before.dataBytes - after.dataBytes) : null;
      const { appendCleanupHistory } = await import('../services/storageMonitor.service.js');
      await appendCleanupHistory({
        at: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: cleanupStatus(report),
        freedBytes,
        before: summarizeMeasure(before),
        after: summarizeMeasure(after),
        items: { ...report.items },
        errors: report.errors.slice(0, 10).map((s) => String(s).slice(0, 300)),
      });
    } catch (_) {
      /* monitoring must never affect cleanup */
    }
  })();
}

const WEEKLY_MAINTENANCE_KEY = '@gastech_weekly_storage_maintenance_v1';
const WEEKLY_MAINTENANCE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Once per week (per device): prune expired delivery history, aggressively reclaim SQLite/WAL,
 * and clear orphan AsyncStorage signature/cache bloat so SQLITE_FULL does not block login.
 * Safe to call often — no-ops until 7 days have passed (unless force=true).
 */
// Splash, app-resume and post-sync all call this at startup; lastAt is only written at the end,
// so without this guard several aggressive runs (each with VACUUM) overlapped login / Start Day.
let _weeklyMaintenanceInFlight = null;

export function runWeeklyStorageMaintenanceIfDue(options = {}) {
  if (_weeklyMaintenanceInFlight) return _weeklyMaintenanceInFlight;
  _weeklyMaintenanceInFlight = runWeeklyStorageMaintenanceOnce(options).finally(() => {
    _weeklyMaintenanceInFlight = null;
  });
  return _weeklyMaintenanceInFlight;
}

async function runWeeklyStorageMaintenanceOnce({ force = false } = {}) {
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

  const startedAt = Date.now();
  const report = newCleanupReport();
  const before = await safeMeasureAsyncStorage();

  let pruned = 0;
  try {
    const { pruneExpiredLocalDeliveryHistory } = await import(
      '../services/vehicleHistoryRetention.service.js'
    );
    const result = await pruneExpiredLocalDeliveryHistory({});
    pruned = Number(result?.deleted) || 0;
  } catch (e) {
    console.warn('[DB] weekly retention prune', e?.message ?? e);
    report.errors.push(`Delivery history prune failed: ${e?.message ?? e}`);
  }
  report.items.deliveryHistoryRows = pruned;

  try {
    const { reclaimSqliteSpace } = await import('./db.js');
    await reclaimSqliteSpace({ aggressive: true });
  } catch (e) {
    console.warn('[DB] weekly sqlite reclaim', e?.message ?? e);
    report.errors.push(`App database reclaim failed: ${e?.message ?? e}`);
  }

  let asyncRemoved = 0;
  try {
    const r = await clearStaleAsyncStorageBloat({ aggressive: true, recordHistory: false });
    asyncRemoved = Number(r?.removed) || 0;
    if (r?.report) {
      const { deliveryHistoryRows } = report.items;
      Object.assign(report.items, r.report.items, { deliveryHistoryRows });
      report.errors.push(...r.report.errors);
    }
  } catch (e) {
    console.warn('[DB] weekly AsyncStorage reclaim', e?.message ?? e);
    report.errors.push(`AsyncStorage cleanup failed: ${e?.message ?? e}`);
  }

  try {
    await AsyncStorage.setItem(WEEKLY_MAINTENANCE_KEY, new Date().toISOString());
  } catch (e) {
    /* ignore — next launch will retry */
    report.errors.push(`Could not save weekly cleanup time: ${e?.message ?? e}`);
  }

  recordCleanupInBackground({ trigger: 'weekly', startedAt, before, measureAfter: true, report });

  return { ran: true, pruned, asyncRemoved };
}

/** For the Storage Management screen. */
export async function getStorageMaintenanceState() {
  let lastWeeklyAt = null;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(WEEKLY_MAINTENANCE_KEY);
    const t = raw ? Date.parse(String(raw)) : NaN;
    if (Number.isFinite(t)) lastWeeklyAt = new Date(t).toISOString();
  } catch (_) {
    /* unknown */
  }
  return {
    running: _weeklyMaintenanceInFlight != null,
    lastWeeklyAt,
    intervalMs: WEEKLY_MAINTENANCE_MS,
  };
}

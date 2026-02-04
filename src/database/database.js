/**
 * Local SQLite database for offline cache.
 * Rolling 48-hour cache for orders; full cache for customers.
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'gastech_cache.db';
const CACHE_HOURS = 48;

let dbInstance = null;

/**
 * Get database instance (opens once, then reuses).
 */
export async function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
  await initSchema(dbInstance);
  return dbInstance;
}

async function initSchema(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT,
      phone TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_orders (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT,
      partner_id INTEGER,
      state TEXT,
      date_order TEXT,
      amount_total REAL,
      order_line TEXT,
      payload TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_order_details (
      order_id INTEGER PRIMARY KEY NOT NULL,
      order_payload TEXT,
      lines_payload TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sale_orders_date ON sale_orders(date_order);
  `);
}

/**
 * Returns ISO date string for (now - hours).
 */
function getCutoffDate(hours = CACHE_HOURS) {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

/**
 * Save customers to local DB (replace all).
 * Uses exclusive transaction when available; falls back to simple writes (e.g. web).
 */
export async function saveCustomers(customers) {
  const db = await getDb();
  const syncedAt = new Date().toISOString();
  const run = async (d) => {
    await d.runAsync('DELETE FROM customers');
    const stmt = await d.prepareAsync(
      'INSERT INTO customers (id, name, phone, synced_at) VALUES ($id, $name, $phone, $synced_at)'
    );
    try {
      for (const c of customers || []) {
        await stmt.executeAsync({
          $id: c.id,
          $name: c.name ?? null,
          $phone: c.phone ?? null,
          $synced_at: syncedAt,
        });
      }
    } finally {
      await stmt.finalizeAsync();
    }
  };
  if (typeof db.withExclusiveTransactionAsync === 'function') {
    await db.withExclusiveTransactionAsync(run);
  } else {
    await run(db);
  }
}

/**
 * Get all customers from local DB. Returns [] on any error.
 */
export async function getCustomersFromDb() {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync('SELECT id, name, phone FROM customers ORDER BY name');
    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name ?? '',
      phone: r.phone ?? '',
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Save sale orders to local DB. Keeps only last 48h by date_order; replaces in that window.
 * Uses exclusive transaction when available; falls back to simple writes (e.g. web).
 */
export async function saveSaleOrders(orders) {
  const db = await getDb();
  const syncedAt = new Date().toISOString();
  const cutoff = getCutoffDate(CACHE_HOURS);

  const run = async (d) => {
    for (const o of orders || []) {
      const dateOrder = o.date_order ?? '';
      if (dateOrder < cutoff) continue;
      const partnerId = Array.isArray(o.partner_id) ? o.partner_id[0] : o.partner_id;
      const orderLine = JSON.stringify(o.order_line || []);
      const payload = JSON.stringify(o);
      await d.runAsync(
        `INSERT OR REPLACE INTO sale_orders (id, name, partner_id, state, date_order, amount_total, order_line, payload, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.id,
        o.name ?? null,
        partnerId ?? null,
        o.state ?? null,
        dateOrder,
        o.amount_total ?? null,
        orderLine,
        payload,
        syncedAt
      );
    }
    await pruneOrdersOlderThan(d, cutoff);
  };

  if (typeof db.withExclusiveTransactionAsync === 'function') {
    await db.withExclusiveTransactionAsync(run);
  } else {
    await run(db);
  }
}

/**
 * Remove orders older than cutoff date.
 */
async function pruneOrdersOlderThan(db, cutoffDate) {
  await db.runAsync('DELETE FROM sale_orders WHERE date_order < ?', cutoffDate);
  await db.runAsync(
    'DELETE FROM sale_order_details WHERE order_id NOT IN (SELECT id FROM sale_orders)'
  );
}

/**
 * Get sale orders from local DB (last 48h only). Returns [] on any error.
 */
export async function getSaleOrdersFromDb() {
  try {
    const db = await getDb();
    const cutoff = getCutoffDate(CACHE_HOURS);
    const rows = await db.getAllAsync(
      'SELECT payload FROM sale_orders WHERE date_order >= ? ORDER BY date_order DESC',
      cutoff
    );
    return (rows || []).map((r) => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Save order details (header + lines) for offline read.
 */
export async function saveOrderDetails(orderId, order, lines) {
  const db = await getDb();
  const syncedAt = new Date().toISOString();
  await db.runAsync(
    `INSERT OR REPLACE INTO sale_order_details (order_id, order_payload, lines_payload, synced_at)
     VALUES (?, ?, ?, ?)`,
    orderId,
    JSON.stringify(order || {}),
    JSON.stringify(lines || []),
    syncedAt
  );
}

/**
 * Get order details from local DB. Returns { order, lines } or null.
 */
export async function getOrderDetailsFromDb(orderId) {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync(
      'SELECT order_payload, lines_payload FROM sale_order_details WHERE order_id = ?',
      orderId
    );
    if (!row) return null;
    return {
      order: JSON.parse(row.order_payload),
      lines: JSON.parse(row.lines_payload),
    };
  } catch {
    return null;
  }
}

/**
 * Update order details lines in SQLite (e.g. after offline qty change).
 * Keeps order_payload as-is; updates lines_payload so full details stay in sync.
 */
export async function updateOrderDetailsLines(orderId, lines) {
  try {
    const db = await getDb();
    const syncedAt = new Date().toISOString();
    const row = await db.getFirstAsync(
      'SELECT order_payload FROM sale_order_details WHERE order_id = ?',
      orderId
    );
    if (!row) return;
    await db.runAsync(
      'UPDATE sale_order_details SET lines_payload = ?, synced_at = ? WHERE order_id = ?',
      JSON.stringify(lines || []),
      syncedAt,
      orderId
    );
  } catch (e) {
    console.warn('updateOrderDetailsLines failed:', e?.message);
  }
}

/**
 * Set metadata value.
 */
export async function setMetadata(key, value) {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
    key,
    value
  );
}

/**
 * Get metadata value.
 */
export async function getMetadata(key) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT value FROM metadata WHERE key = ?', key);
  return row?.value ?? null;
}

/**
 * Enqueue an offline action for later sync.
 */
export async function enqueueOfflineAction(action, payload) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO offline_queue (action, payload, created_at, retry_count) VALUES (?, ?, ?, 0)',
    action,
    JSON.stringify(payload),
    new Date().toISOString()
  );
}

/**
 * Get pending offline queue items.
 */
export async function getOfflineQueue() {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT id, action, payload, created_at, retry_count FROM offline_queue ORDER BY id'
  );
}

/**
 * Remove queue item after successful sync.
 */
export async function removeOfflineQueueItem(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM offline_queue WHERE id = ?', id);
}

/**
 * Increment retry count for queue item.
 */
export async function incrementQueueRetry(id) {
  const db = await getDb();
  await db.runAsync('UPDATE offline_queue SET retry_count = retry_count + 1 WHERE id = ?', id);
}

export { CACHE_HOURS, getCutoffDate };

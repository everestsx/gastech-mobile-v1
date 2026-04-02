/**
 * GasTech offline database - expo-sqlite.
 * Single DB instance; migrations run on first open.
 * All access serialized to avoid "database is locked" errors.
 */
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';

const DB_NAME = 'gastech.db';

/** Single raw DB instance (opened once). */
let rawDbPromise = null;

/** Serialize all DB access: one operation at a time. */
let _queue = Promise.resolve();

function getRawDb() {
  if (!rawDbPromise) {
    rawDbPromise = SQLite.openDatabaseAsync(DB_NAME).then((db) =>
      runMigrations(db).then(() => db)
    );
  }
  return rawDbPromise;
}

const SALE_ORDERS_COLUMNS = [
  { name: 'name', def: 'TEXT' },
  { name: 'partner_id', def: 'INTEGER' },
  { name: 'partner_name', def: 'TEXT' },
  { name: 'state', def: 'TEXT' },
  { name: 'date_order', def: 'TEXT' },
  { name: 'commitment_date', def: 'TEXT' }, // for delivery-date-based sync filtering/sorting
  { name: 'amount_total', def: 'REAL' },
  { name: 'amount_untaxed', def: 'REAL' },
  { name: 'amount_tax', def: 'REAL' },
  { name: 'invoice_status', def: 'TEXT' }, // consider this to be order_status
  { name: 'order_line', def: 'TEXT' },
  { name: 'route_id', def: 'INTEGER' },
  { name: 'route_name', def: 'TEXT' },
  { name: 'vehicle_id', def: 'INTEGER' },
  { name: 'vehicle_name', def: 'TEXT' },
  { name: 'updated_at', def: 'TEXT' },
  { name: 'payload', def: 'TEXT' }, // legacy; we always write '' so NOT NULL if present is satisfied
  { name: 'payment_type', def: 'TEXT' }, // 'cash' | 'cheque' | 'credit' set when user completes payment
];

async function runMigrations(db) {
  await db.execAsync('PRAGMA journal_mode = WAL');
  const versionRow = await db.getFirstAsync('PRAGMA user_version');
  const current = versionRow?.user_version ?? 0;

  if (current < 1) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY,
      name TEXT,
      city TEXT,
      phone TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sale_orders (
      id INTEGER PRIMARY KEY,
      name TEXT,
      partner_id INTEGER,
      partner_name TEXT,
      state TEXT,
      date_order TEXT,
      commitment_date TEXT,
      amount_total REAL,
      amount_untaxed REAL,
      amount_tax REAL,
      invoice_status TEXT,
      order_line TEXT,
      route_id INTEGER,
      route_name TEXT,
      vehicle_id INTEGER,
      vehicle_name TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sale_order_lines (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      product_id INTEGER,
      product_name TEXT,
      name TEXT,
      product_uom_qty REAL,
      price_unit REAL,
      price_subtotal REAL,
      price_total REAL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stock_pickings (
      id INTEGER PRIMARY KEY,
      name TEXT,
      sale_id INTEGER,
      state TEXT,
      move_ids TEXT,
      backorder_ids TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stock_moves (
      id INTEGER PRIMARY KEY,
      picking_id INTEGER,
      product_id INTEGER,
      product_name TEXT,
      product_uom_qty REAL,
      state TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stock_move_lines (
      id INTEGER PRIMARY KEY,
      move_id INTEGER,
      qty_done REAL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS account_journals (
      id INTEGER PRIMARY KEY,
      name TEXT,
      code TEXT,
      type TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY,
      name TEXT,
      license_plate TEXT,
      model_id INTEGER,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      is_uploaded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_at TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      counts TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sale_order_lines_order_id ON sale_order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_stock_pickings_sale_id ON stock_pickings(sale_id);
    CREATE INDEX IF NOT EXISTS idx_stock_moves_picking_id ON stock_moves(picking_id);
    CREATE INDEX IF NOT EXISTS idx_stock_move_lines_move_id ON stock_move_lines(move_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_uploaded ON sync_queue(is_uploaded);
  `);
    await db.runAsync('PRAGMA user_version = 1');
  }

  if (current < 2) {
    const info = await db.getAllAsync('PRAGMA table_info(sale_orders)');
    const existing = new Set((info || []).map((c) => c.name));
    for (const col of SALE_ORDERS_COLUMNS) {
      if (!existing.has(col.name)) {
        await db.runAsync(`ALTER TABLE sale_orders ADD COLUMN ${col.name} ${col.def}`);
      }
    }
    await db.runAsync('PRAGMA user_version = 2');
  }

  if (current < 3) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS vehicle_warehouses (
      id INTEGER PRIMARY KEY,
      vehicle_id INTEGER,
      name TEXT,
      complete_name TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicle_inventories (
      id INTEGER PRIMARY KEY,
      location_id INTEGER,
      vehicle_id INTEGER,
      product_id INTEGER,
      product_name TEXT,
      quantity REAL,
      available_quantity REAL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_warehouses_vehicle_id ON vehicle_warehouses(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_inventories_vehicle_id ON vehicle_inventories(vehicle_id);
    `);
    await db.runAsync('PRAGMA user_version = 3');
  }

  if (current < 4) {
    try {

      const info = await db.getAllAsync('PRAGMA table_info(partners)');
      const hasCity = (info || []).some((c) => c.name === 'city');

      if (!hasCity) {
        await db.runAsync('ALTER TABLE partners ADD COLUMN city TEXT');
        console.log("[Migration] Added city column to partners table");
      }
    } catch (e) {
      console.warn("[Migration] Error adding city column:", e);
    }
    await db.runAsync('PRAGMA user_version = 4');
  }

  if (current < 5) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(sale_orders)');
      const hasPaymentType = (info || []).some((c) => c.name === 'payment_type');
      if (!hasPaymentType) {
        await db.runAsync('ALTER TABLE sale_orders ADD COLUMN payment_type TEXT');
      }
    } catch (e) {
      console.warn("[Migration] Error adding payment_type:", e);
    }
    await db.runAsync('PRAGMA user_version = 5');
  }


  if (current < 6) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(vehicles)');
      const hasPassword = (info || []).some((c) => c.name === 'password');
      if (!hasPassword) {
        await db.runAsync('ALTER TABLE vehicles ADD COLUMN password TEXT');
      }
    } catch (e) {
      console.warn('[Migration] Error adding password to vehicles:', e);
    }
    await db.runAsync('PRAGMA user_version = 6');
  }

  // Migration 7: Add is_locally_modified column to vehicle_inventories
  if (current < 7) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(vehicle_inventories)');
      const hasLocallyModified = (info || []).some((c) => c.name === 'is_locally_modified');
      if (!hasLocallyModified) {
        await db.runAsync('ALTER TABLE vehicle_inventories ADD COLUMN is_locally_modified INTEGER DEFAULT 0');
        console.log('[Migration] Added is_locally_modified column to vehicle_inventories');
      }
    } catch (e) {
      console.warn('[Migration] Error adding is_locally_modified:', e);
    }
    await db.runAsync('PRAGMA user_version = 7');
  }

  // Migration 8: Add offline_attachments table
  if (current < 8) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_order_id INTEGER NOT NULL,
      local_file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_attachments_sale_order ON offline_attachments(sale_order_id);
    CREATE INDEX IF NOT EXISTS idx_offline_attachments_sync_status ON offline_attachments(sync_status);
    `);
    await db.runAsync('PRAGMA user_version = 8');
  }

  if (current < 9) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(offline_attachments)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('last_error')) {
        await db.runAsync('ALTER TABLE offline_attachments ADD COLUMN last_error TEXT');
      }
      if (!names.has('synced_at')) {
        await db.runAsync('ALTER TABLE offline_attachments ADD COLUMN synced_at TEXT');
      }
    } catch (e) {
      console.warn('[Migration] offline_attachments last_error/synced_at:', e);
    }
    await db.runAsync('PRAGMA user_version = 9');
  }

  // Migration 10: Ensure vehicle_inventories has is_locally_modified (fix for DBs that skipped migration 7)
  if (current < 10) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(vehicle_inventories)');
      const hasLocallyModified = (info || []).some((c) => c.name === 'is_locally_modified');
      if (!hasLocallyModified) {
        await db.runAsync('ALTER TABLE vehicle_inventories ADD COLUMN is_locally_modified INTEGER DEFAULT 0');
        console.log('[Migration] Added is_locally_modified column to vehicle_inventories');
      }
    } catch (e) {
      console.warn('[Migration] Error adding is_locally_modified:', e);
    }
    await db.runAsync('PRAGMA user_version = 10');
  }

  // Migration 11: Add amount_credit to sale_orders (credit portion for split payments / dashboard)
  if (current < 11) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(sale_orders)');
      const hasAmountCredit = (info || []).some((c) => c.name === 'amount_credit');
      if (!hasAmountCredit) {
        await db.runAsync('ALTER TABLE sale_orders ADD COLUMN amount_credit REAL');
        console.log('[Migration] Added amount_credit column to sale_orders');
      }
    } catch (e) {
      console.warn('[Migration] Error adding amount_credit:', e);
    }
    await db.runAsync('PRAGMA user_version = 11');
  }

  // Migration 12: Local invoices and payments (offline invoicing cycle; upload to Odoo from queue)
  if (current < 12) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_order_id INTEGER NOT NULL UNIQUE,
      invoice_number TEXT NOT NULL,
      amount_total REAL NOT NULL,
      amount_untaxed REAL,
      amount_tax REAL,
      state TEXT NOT NULL DEFAULT 'posted',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced_at TEXT,
      odoo_invoice_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS local_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      sale_order_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL,
      amount REAL NOT NULL,
      journal_id INTEGER,
      check_number TEXT,
      bank_name TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      odoo_payment_id INTEGER,
      FOREIGN KEY (invoice_id) REFERENCES local_invoices(id)
    );
    CREATE INDEX IF NOT EXISTS idx_local_invoices_sale_order ON local_invoices(sale_order_id);
    CREATE INDEX IF NOT EXISTS idx_local_invoices_synced ON local_invoices(synced_at);
    CREATE INDEX IF NOT EXISTS idx_local_payments_invoice ON local_payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_local_payments_sale_order ON local_payments(sale_order_id);
    CREATE INDEX IF NOT EXISTS idx_local_payments_type ON local_payments(payment_type);
    `);
    await db.runAsync('PRAGMA user_version = 12');
  }

  // Migration 13: Vehicle-specific journals for offline Cash/Cheque payments
  if (current < 13) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(vehicles)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('cash_journal_id')) {
        await db.runAsync('ALTER TABLE vehicles ADD COLUMN cash_journal_id INTEGER');
        console.log('[Migration] Added cash_journal_id to vehicles');
      }
      if (!names.has('check_journal_id')) {
        await db.runAsync('ALTER TABLE vehicles ADD COLUMN check_journal_id INTEGER');
        console.log('[Migration] Added check_journal_id to vehicles');
      }
    } catch (e) {
      console.warn('[Migration] vehicles journal columns:', e);
    }
    await db.runAsync('PRAGMA user_version = 13');
  }

  // Migration 14: amount_cash, amount_cheque on sale_orders (backend sync split: cash + cheque + credit)
  if (current < 14) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(sale_orders)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('amount_cash')) {
        await db.runAsync('ALTER TABLE sale_orders ADD COLUMN amount_cash REAL');
        console.log('[Migration] Added amount_cash column to sale_orders');
      }
      if (!names.has('amount_cheque')) {
        await db.runAsync('ALTER TABLE sale_orders ADD COLUMN amount_cheque REAL');
        console.log('[Migration] Added amount_cheque column to sale_orders');
      }
    } catch (e) {
      console.warn('[Migration] amount_cash/amount_cheque:', e);
    }
    await db.runAsync('PRAGMA user_version = 14');
  }

  // Migration 15: Explicit uploaded flag on sync_queue for stronger idempotency
  if (current < 15) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(sync_queue)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('is_uploaded')) {
        await db.runAsync('ALTER TABLE sync_queue ADD COLUMN is_uploaded INTEGER NOT NULL DEFAULT 0');
      }
      await db.runAsync('UPDATE sync_queue SET is_uploaded = 1 WHERE synced_at IS NOT NULL');
      await db.runAsync('CREATE INDEX IF NOT EXISTS idx_sync_queue_uploaded ON sync_queue(is_uploaded)');
    } catch (e) {
      console.warn('[Migration] sync_queue is_uploaded:', e);
    }
    await db.runAsync('PRAGMA user_version = 15');
  }

  // Migration 16: Add commitment_date to sale_orders for delivery-date-based sync filtering/sorting
  if (current < 16) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(sale_orders)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('commitment_date')) {
        await db.runAsync('ALTER TABLE sale_orders ADD COLUMN commitment_date TEXT');
      }
    } catch (e) {
      console.warn('[Migration] sale_orders commitment_date:', e);
    }
    await db.runAsync('PRAGMA user_version = 16');
  }

  // Migration 17: Persist invoice signatures for re-print / navigation without route params
  if (current < 17) {
    try {
      const info = await db.getAllAsync('PRAGMA table_info(local_invoices)');
      const names = new Set((info || []).map((c) => c.name));
      if (!names.has('customer_signature_data')) {
        await db.runAsync('ALTER TABLE local_invoices ADD COLUMN customer_signature_data TEXT');
      }
      if (!names.has('driver_signature_data')) {
        await db.runAsync('ALTER TABLE local_invoices ADD COLUMN driver_signature_data TEXT');
      }
    } catch (e) {
      console.warn('[Migration] local_invoices signature columns:', e);
    }
    await db.runAsync('PRAGMA user_version = 17');
  }
}

/**
 * Run one async operation with the real DB. Serializes all access to avoid "database is locked".
 */
function enqueue(fn) {
  const p = _queue.then(async () => {
    const db = await getRawDb();
    return fn(db);
  });
  _queue = p.catch(() => { }); // keep queue moving so next op can run
  return p;
}

/**
 * Returns a wrapped database. Every method call is serialized so only one runs at a time.
 */
export async function getDb() {
  await getRawDb(); // ensure DB is open before returning wrapper
  return {
    getAllAsync: (...args) => enqueue((db) => db.getAllAsync(...args)),
    getFirstAsync: (...args) => enqueue((db) => db.getFirstAsync(...args)),
    runAsync: (...args) => enqueue((db) => db.runAsync(...args)),
    execAsync: (sql) => enqueue((db) => db.execAsync(sql)),
    withTransactionAsync: (fn) =>
      enqueue((db) => db.withTransactionAsync(() => fn(db))),
  };
}

/**
 * Delete the database completely and allow it to be recreated on next access.
 * Use for recovery from schema/state corruption or to start fresh (dev only).
 * Flow: drain queue → close DB → delete file → clear ref. Next getDb() opens a new DB and runs migrations.
 */
export async function resetDatabaseAndRecreate() {
  await _queue;
  const db = await getRawDb();
  rawDbPromise = null;
  try {
    if (typeof db.closeAsync === 'function') await db.closeAsync();
  } catch (e) {
    console.warn('[DB] close:', e?.message ?? e);
  }
  try {
    const path = db.databasePath ?? (FileSystem.documentDirectory + `SQLite/${DB_NAME}`);
    const exists = await FileSystem.getInfoAsync(path, { size: false });
    if (exists.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      console.log('[DB] Deleted', path);
    }
  } catch (e) {
    console.warn('[DB] delete file:', e?.message ?? e);
  }
  try {
    if (typeof db.deleteAsync === 'function') await db.deleteAsync();
  } catch (_) { }
}

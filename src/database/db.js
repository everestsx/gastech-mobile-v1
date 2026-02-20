/**
 * GasTech offline database - expo-sqlite.
 * Single DB instance; migrations run on first open.
 * All access serialized to avoid "database is locked" errors.
 */
import * as SQLite from 'expo-sqlite';

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
  { name: 'amount_total', def: 'REAL' },
  { name: 'amount_untaxed', def: 'REAL' },
  { name: 'amount_tax', def: 'REAL' },
  { name: 'invoice_status', def: 'TEXT' },
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
      synced_at TEXT
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
    await db.execAsync(`ALTER TABLE vehicles ADD COLUMN password TEXT;`);
    await db.runAsync('PRAGMA user_version = 5');
  }


  if (current < 5) {
    await db.execAsync(`ALTER TABLE vehicles ADD COLUMN password TEXT;`);
    await db.runAsync('PRAGMA user_version = 5');
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
  _queue = p.catch(() => {}); // keep queue moving so next op can run
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

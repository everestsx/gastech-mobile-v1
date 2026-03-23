/**
 * Local CRUD for partners (customers). Used for offline customer list.
 */
import { getDb } from './db.js';
import { empty, num, iso } from './dbHelpers.js';

/** String or null for optional TEXT; never pass object to SQLite. */
function strOrNull(v) {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function upsertPartners(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO partners (id, name, phone, street, city, vat, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [num(r.id), empty(r.name), strOrNull(r.phone), strOrNull(r.street), strOrNull(r.city), strOrNull(r.vat), iso()]
      );
    }
  });
}

export async function getAllPartners() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, phone, street, city, vat FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    street: row.street,
    city: row.city,
    vat: row.vat,
  }));
}
/**
 * Fetches unique customers (partners) assigned to a specific vehicle
 * based on the sale orders existing in the local database.
 */
export async function getCustomersByVehicle(vehicleId) {
  const db = await getDb();

  // Using a JOIN to get full partner details for any partner
  // that has at least one order assigned to this vehicle.
  const query = `
    SELECT DISTINCT p.* FROM partners p
    INNER JOIN sale_orders s ON p.id = s.partner_id
    WHERE s.vehicle_id = ?
    ORDER BY p.name ASC
  `;

  try {
    const results = await db.getAllAsync(query, [vehicleId]);
    return results || [];
  } catch (error) {
    console.error("Error fetching customers by vehicle:", error);
    return [];
  }
}

/**
 * Fetches customers (partners) for a vehicle with order count.
 * @param {string|number|null} vehicleId - Vehicle ID to filter by.
 * @param {string|null} [dateStr] - Optional date (YYYY-MM-DD). When provided, total_orders is the count of orders for that date only (e.g. today).
 */
export async function getCustomersByVehicleRoute(vehicleId, dateStr = null) {
  const db = await getDb();

  let query;
  let params;

  if (dateStr) {
    // Count only orders for the given date (e.g. today)
    const datePrefix = String(dateStr).trim().slice(0, 10) + '%';
    query = `
      SELECT 
        p.id, 
        p.name, 
        p.phone, 
        p.city, 
        SUM(CASE WHEN s.date_order LIKE ? THEN 1 ELSE 0 END) as total_orders
      FROM partners p
      INNER JOIN sale_orders s ON p.id = s.partner_id AND s.vehicle_id = ?
      GROUP BY p.id
      ORDER BY p.name ASC
    `;
    params = [datePrefix, vehicleId];
  } else {
    query = `
      SELECT 
        p.id, 
        p.name, 
        p.phone, 
        p.city, 
        COUNT(s.id) as total_orders
      FROM partners p
      INNER JOIN sale_orders s ON p.id = s.partner_id
      WHERE s.vehicle_id = ?
      GROUP BY p.id
      ORDER BY p.name ASC
    `;
    params = [vehicleId];
  }

  try {
    const results = await db.getAllAsync(query, params);
    return (results || []).map((row) => ({
      ...row,
      total_orders: Number(row.total_orders) || 0,
    }));
  } catch (error) {
    console.error("Error fetching customers with order count:", error);
    return [];
  }
}
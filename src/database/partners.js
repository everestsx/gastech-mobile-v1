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
        `INSERT OR REPLACE INTO partners (id, name, phone, city, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [num(r.id), empty(r.name), strOrNull(r.phone),strOrNull(r.city), iso()]
      );
    }
  });
}

export async function getAllPartners() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, phone,city FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    city: row.city,
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

export async function getCustomersByVehicleRoute(vehicleId) {
  const db = await getDb();

  const query = `
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

  try {
    const results = await db.getAllAsync(query, [vehicleId]);
    return results || [];
  } catch (error) {
    console.error("Error fetching customers with order count:", error);
    return [];
  }
}
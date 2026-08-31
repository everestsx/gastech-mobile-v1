/**
 * Local CRUD for partners (customers). Used for offline customer list.
 */
import { getDb } from './db.js';
import {
  coerceSqliteBindArray,
  iso,
  odooRecordId,
  odooTextOrNull,
  odooTextRequired,
} from './dbHelpers.js';

const LOG = '[partners]';

export async function upsertPartners(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r == null || typeof r !== 'object' || Array.isArray(r)) {
        console.warn(`${LOG} skip row ${i}: not a plain object`);
        continue;
      }
      const id = odooRecordId(r.id);
      if (!Number.isFinite(id) || id <= 0) {
        console.warn(`${LOG} skip row ${i}: invalid id`, r?.id);
        continue;
      }
      const rawParams = [
        id,
        odooTextRequired(r.name),
        odooTextOrNull(r.phone) ?? '',
        odooTextOrNull(r.city) ?? '',
        odooTextOrNull(r.ref) ?? '',
        odooTextOrNull(r.name_tamil) ?? '',
        odooTextOrNull(r.name_sinhala) ?? '',
        iso(),
      ];
      const params = coerceSqliteBindArray(rawParams);
      try {
        await tx.runAsync(
          `INSERT OR REPLACE INTO partners (id, name, phone, city, ref, name_tamil, name_sinhala, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params
        );
      } catch (e) {
        console.warn(`${LOG} upsert row ${i} id=${id} failed`, e?.message ?? e);
      }
    }
  });
}

export async function getAllPartners() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, phone, city, ref, name_tamil, name_sinhala FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    city: row.city,
    ref: row.ref ?? null,
    name_tamil: row.name_tamil ?? null,
    name_sinhala: row.name_sinhala ?? null,
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
        p.name_tamil,
        p.name_sinhala,
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
        p.name_tamil,
        p.name_sinhala,
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
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
        odooTextOrNull(r.name_tamil) ?? '',
        odooTextOrNull(r.name_sinhala) ?? '',
        // Invoice header fields (Purchaser's TIN / Address) — kept locally for offline printing.
        odooTextOrNull(r.vat) ?? '',
        odooTextOrNull(r.street) ?? '',
        odooTextOrNull(r.street2) ?? '',
        odooTextOrNull(r.zip) ?? '',
        iso(),
      ];
      const params = coerceSqliteBindArray(rawParams);
      try {
        await tx.runAsync(
          `INSERT OR REPLACE INTO partners (id, name, phone, city, name_tamil, name_sinhala, vat, street, street2, zip, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    `SELECT id, name, phone, city, name_tamil, name_sinhala FROM partners ORDER BY name ASC`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    city: row.city,
    name_tamil: row.name_tamil ?? null,
    name_sinhala: row.name_sinhala ?? null,
  }));
}
/**
 * Non-destructive refresh of the invoice header fields for one partner.
 * Unlike upsertPartners (INSERT OR REPLACE), this only touches the columns passed in and only
 * when the new value is non-empty, so it can never blank out data fetched by a previous sync.
 * No-op when the partner has no local row yet.
 * @param {number|string} partnerId
 * @param {{vat?:string|null, street?:string|null, street2?:string|null, city?:string|null, phone?:string|null}} fields
 */
export async function updatePartnerInvoiceFields(partnerId, fields) {
  const id = Number(partnerId);
  if (!Number.isFinite(id) || id <= 0) return;
  const allowed = ['vat', 'street', 'street2', 'city', 'phone'];
  const sets = [];
  const params = [];
  for (const col of allowed) {
    const val = odooTextOrNull(fields?.[col]);
    if (val == null) continue;
    sets.push(`${col} = ?`);
    params.push(val);
  }
  if (sets.length === 0) return;
  params.push(id);
  const db = await getDb();
  try {
    await db.runAsync(
      `UPDATE partners SET ${sets.join(', ')} WHERE id = ?`,
      coerceSqliteBindArray(params)
    );
  } catch (e) {
    console.warn(`${LOG} updatePartnerInvoiceFields id=${id} failed`, e?.message ?? e);
  }
}

/**
 * Invoice header fields for one partner (Purchaser block) from local DB — used when printing offline.
 * Returns null when the partner is not cached locally.
 * @param {number|string} partnerId
 */
export async function getPartnerInvoiceFields(partnerId) {
  const id = Number(partnerId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const db = await getDb();
  try {
    const row = await db.getFirstAsync(
      `SELECT id, name, phone, city, vat, street, street2, name_tamil, name_sinhala
       FROM partners WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || null,
      phone: row.phone || null,
      city: row.city || null,
      vat: row.vat || null,
      street: row.street || null,
      street2: row.street2 || null,
      name_tamil: row.name_tamil ?? null,
      name_sinhala: row.name_sinhala ?? null,
    };
  } catch (e) {
    // Older DB without the migration-31 columns must not break invoice printing.
    console.warn(`${LOG} getPartnerInvoiceFields id=${id} failed`, e?.message ?? e);
    return null;
  }
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
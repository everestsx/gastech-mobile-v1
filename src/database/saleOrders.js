/**
 * Local CRUD for sale_orders (Odoo sale.order mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso, jsonArr } from './dbHelpers.js';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

export async function upsertSaleOrders(rows) {
  if (!rows?.length) return;
  const db = await getDb();
  const now = iso();

  await db.withTransactionAsync(async (tx) => {
    for (const r of rows) {
      const partner = odooRel(r.partner_id);
      const route = odooRel(r.route_id);
      const vehicle = odooRel(r.vehicle_id);
      await tx.runAsync(
        `INSERT OR REPLACE INTO sale_orders (
          id, name, partner_id, partner_name, state, date_order,
          amount_total, amount_untaxed, amount_tax, invoice_status, order_line,
          route_id, route_name, vehicle_id, vehicle_name, updated_at, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id != null ? r.id : 0,
          empty(r.name),
          numOrNull(partner.id),
          empty(partner.name),
          empty(r.state),
          empty(r.date_order),
          num(r.amount_total),
          num(r.amount_untaxed),
          num(r.amount_tax),
          empty(r.invoice_status),
          jsonArr(r.order_line),
          numOrNull(route.id),
          empty(route.name),
          numOrNull(vehicle.id),
          empty(vehicle.name),
          now,
          empty(r.payload),
        ]
      );
    }
  });
}

export async function getAllSaleOrders() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT * FROM sale_orders ORDER BY date_order DESC LIMIT 500`
  );
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
    state: row.state,
    date_order: row.date_order,
    amount_total: row.amount_total,
    amount_untaxed: row.amount_untaxed,
    amount_tax: row.amount_tax,
    invoice_status: row.invoice_status,
    order_line: safeParseJson(row.order_line, []),
    route_id: row.route_id != null ? [row.route_id, row.route_name ?? ''] : null,
    vehicle_id: row.vehicle_id != null ? [row.vehicle_id, row.vehicle_name ?? ''] : null,
  }));
}

export async function getSaleOrderById(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT * FROM sale_orders WHERE id = ?', [id]);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
    state: row.state,
    date_order: row.date_order,
    amount_total: row.amount_total,
    amount_untaxed: row.amount_untaxed,
    amount_tax: row.amount_tax,
    invoice_status: row.invoice_status,
    order_line: safeParseJson(row.order_line, []),
    route_id: row.route_id != null ? [row.route_id, row.route_name ?? ''] : null,
    vehicle_id: row.vehicle_id != null ? [row.vehicle_id, row.vehicle_name ?? ''] : null,
  };
}

function safeParseJson(str, fallback) {
  if (str == null || str === '') return fallback;
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

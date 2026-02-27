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
        `INSERT INTO sale_orders (
          id, name, partner_id, partner_name, state, date_order,
          amount_total, amount_untaxed, amount_tax, invoice_status, order_line,
          route_id, route_name, vehicle_id, vehicle_name, updated_at, payload, payment_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, partner_id=excluded.partner_id, partner_name=excluded.partner_name,
          state=excluded.state, date_order=excluded.date_order,
          amount_total=excluded.amount_total, amount_untaxed=excluded.amount_untaxed, amount_tax=excluded.amount_tax,
          invoice_status=excluded.invoice_status, order_line=excluded.order_line,
          route_id=excluded.route_id, route_name=excluded.route_name,
          vehicle_id=excluded.vehicle_id, vehicle_name=excluded.vehicle_name,
          updated_at=excluded.updated_at, payload=excluded.payload,
          payment_type=CASE WHEN excluded.payment_type IS NOT NULL AND excluded.payment_type != '' THEN excluded.payment_type ELSE sale_orders.payment_type END`,
        [
          num(r.id),
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
          empty(r.payment_type ?? '')
        ]
      );
    }
  });
}

/**
 * @param {number | null} [vehicleId] - When set, return only sale orders for this vehicle.
 */
export async function getAllSaleOrders(vehicleId = null) {
  const db = await getDb();
  const sql =
    vehicleId != null
      ? `SELECT * FROM sale_orders WHERE vehicle_id = ? ORDER BY date_order DESC LIMIT 500`
      : `SELECT * FROM sale_orders ORDER BY date_order DESC LIMIT 500`;
  const args = vehicleId != null ? [vehicleId] : [];
  const rows = await db.getAllAsync(sql, args);
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
    payment_type: row.payment_type ?? null,
  }));
}

export async function getSaleOrderById(id) {
  const db = await getDb();
  try {
    const row = await db.getFirstAsync(`
      SELECT so.*, p.city as partner_city, p.phone as partner_phone
      FROM sale_orders so
      LEFT JOIN partners p ON so.partner_id = p.id
      WHERE so.id = ?
    `, [id]);

    if (!row) return null;

    return {
      ...row,
      city: row.partner_city || '',
      partner_phone: row.partner_phone ?? '',
      partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
      order_line: safeParseJson(row.order_line, []),
    };
  } catch (e) {
    console.warn("SQL Error in getSaleOrderById:", e);
    return await db.getFirstAsync('SELECT * FROM sale_orders WHERE id = ?', [id]);
  }
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

/**
 * Recompute sale order amounts from its lines (offline). Updates amount_untaxed, amount_tax, amount_total.
 */
export async function updateSaleOrderAmountsFromLines(orderId) {
  const db = await getDb();
  const lineRows = await db.getAllAsync(
    'SELECT price_subtotal, price_total FROM sale_order_lines WHERE order_id = ?',
    [num(orderId)]
  );
  let amountUntaxed = 0;
  let amountTax = 0;
  (lineRows || []).forEach((r) => {
    const sub = num(r.price_subtotal);
    const total = num(r.price_total);
    amountUntaxed += sub;
    amountTax += total - sub;
  });
  const amountTotal = amountUntaxed + amountTax;
  await db.runAsync(
    `UPDATE sale_orders SET amount_untaxed = ?, amount_tax = ?, amount_total = ?, updated_at = ? WHERE id = ?`,
    [amountUntaxed, amountTax, amountTotal, iso(), num(orderId)]
  );
}

/**
 * Update sale order invoice_status locally (offline). e.g. 'invoiced'.
 */
export async function updateSaleOrderInvoiceStatusLocal(orderId, invoiceStatus) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sale_orders SET invoice_status = ?, updated_at = ? WHERE id = ?`,
    [empty(invoiceStatus) || 'invoiced', iso(), num(orderId)]
  );
}

/**
 * Update sale order payment_type locally when user completes payment. Values: 'cash' | 'cheque' | 'credit'.
 */
export async function updateSaleOrderPaymentTypeLocal(orderId, paymentType) {
  const db = await getDb();
  const type = paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit' ? paymentType : null;
  await db.runAsync(
    `UPDATE sale_orders SET payment_type = ?, updated_at = ? WHERE id = ?`,
    [type, iso(), num(orderId)]
  );
}

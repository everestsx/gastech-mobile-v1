/**
 * Local CRUD for sale_orders (Odoo sale.order mirror).
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso, jsonArr } from './dbHelpers.js';

const LOG = '[saleOrders]';

function odooRel(idName) {
  if (Array.isArray(idName)) return { id: idName[0], name: idName[1] ?? null };
  return { id: idName, name: null };
}

function logQuery(operation, detail = '') {
  if (detail) console.log(`${LOG} ${operation} ${detail}`);
  else console.log(`${LOG} ${operation}`);
}

function logError(operation, paramsSummary, err) {
  console.warn(`${LOG} ${operation} failed`, paramsSummary, err?.message ?? err);
}

/**
 * @param {Array} rows - Orders from Odoo (or merged).
 * @param {{ preserveLocalForSaleOrderIds?: Set<number> | number[] }} [options] - When set, for these sale order ids we keep existing local invoice_status and payment_type (so sync download does not overwrite unuploaded local state). amount_credit is not synced from Odoo; it is set only locally when user completes payment.
 */
export async function upsertSaleOrders(rows, options = {}) {
  if (!rows?.length) return;
  const op = 'upsertSaleOrders';
  logQuery(op, `rows=${rows.length}`);
  const db = await getDb();
  const now = iso();
  const preserveSet = options.preserveLocalForSaleOrderIds;
  const preserveIds = (preserveSet instanceof Set ? Array.from(preserveSet) : (Array.isArray(preserveSet) ? preserveSet : [])).map((id) => num(id));
  if (preserveIds.length > 0) logQuery(op, `preserveLocalForIds=[${preserveIds.slice(0, 5).join(',')}${preserveIds.length > 5 ? '...' : ''}] (${preserveIds.length})`);

  try {
    await db.withTransactionAsync(async (tx) => {
      let localMap = {};
      const cancelledLocalRows = await tx.getAllAsync(
        `SELECT id, cancel_reason FROM sale_orders WHERE LOWER(COALESCE(state, '')) = 'cancel'`
      );
      for (const row of cancelledLocalRows || []) {
        const idKey = num(row.id);
        localMap[idKey] = {
          ...(localMap[idKey] || {}),
          state: 'cancel',
          cancel_reason: empty(row.cancel_reason),
        };
      }
      if (preserveIds.length > 0) {
        const placeholders = preserveIds.map(() => '?').join(',');
        const selectSql = `SELECT id, invoice_status, payment_type, state, cancel_reason, commitment_date FROM sale_orders WHERE id IN (${placeholders})`;
        const localRows = await tx.getAllAsync(selectSql, preserveIds);
        for (const row of localRows || []) {
          const idKey = num(row.id);
          localMap[idKey] = {
            ...(localMap[idKey] || {}),
            invoice_status: empty(row.invoice_status),
            payment_type: empty(row.payment_type),
            state: localMap[idKey]?.state || empty(row.state),
            cancel_reason: localMap[idKey]?.cancel_reason || empty(row.cancel_reason),
            commitment_date: empty(row.commitment_date),
          };
        }
        logQuery(op, `SELECT preserve local rows=${(localRows || []).length}`);
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const partner = odooRel(r.partner_id);
        const route = odooRel(r.route_id);
        const vehicle = odooRel(r.vehicle_id);
        const rid = num(r.id);
        const useLocal = localMap[rid] != null;
        const preservePayment =
          preserveIds.length > 0 && preserveIds.includes(rid) && localMap[rid];
        const invoiceStatus = preservePayment
          ? (localMap[rid].invoice_status || empty(r.invoice_status))
          : empty(r.invoice_status);
        const paymentType = preservePayment
          ? (localMap[rid].payment_type || empty(r.payment_type ?? ''))
          : empty(r.payment_type ?? '');
        const commitmentDate =
          preservePayment && localMap[rid].commitment_date
            ? localMap[rid].commitment_date
            : empty(r.commitment_date);
        const localState = useLocal ? String(localMap[rid].state || '').toLowerCase() : '';
        const state = localState === 'cancel' ? 'cancel' : empty(r.state);
        const cancelReason =
          localState === 'cancel' && localMap[rid].cancel_reason
            ? localMap[rid].cancel_reason
            : empty(r.cancel_reason);
        const amountCash = numOrNull(r.amount_cash);
        const amountCheque = numOrNull(r.amount_cheque);
        const amountCredit = numOrNull(r.amount_credit);

        const params = [
          rid,
          empty(r.name),
          numOrNull(partner.id) ?? null,
          empty(partner.name),
          state,
          empty(r.date_order),
          commitmentDate,
          num(r.amount_total),
          num(r.amount_untaxed),
          num(r.amount_tax),
          invoiceStatus,
          jsonArr(r.order_line),
          numOrNull(route.id) ?? null,
          empty(route.name),
          numOrNull(vehicle.id) ?? null,
          empty(vehicle.name),
          now,
          empty(r.payload),
          paymentType,
          amountCash,
          amountCheque,
          amountCredit,
          empty(r.invoice_number),
          cancelReason,
        ];
        try {
          await tx.runAsync(
            `INSERT INTO sale_orders (
              id, name, partner_id, partner_name, state, date_order, commitment_date,
              amount_total, amount_untaxed, amount_tax, invoice_status, order_line,
              route_id, route_name, vehicle_id, vehicle_name, updated_at, payload, payment_type,
              amount_cash, amount_cheque, amount_credit, invoice_number, cancel_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, partner_id=excluded.partner_id, partner_name=excluded.partner_name,
              state=excluded.state, date_order=excluded.date_order, commitment_date=excluded.commitment_date,
              amount_total=excluded.amount_total, amount_untaxed=excluded.amount_untaxed, amount_tax=excluded.amount_tax,
              invoice_status=excluded.invoice_status, order_line=excluded.order_line,
              route_id=excluded.route_id, route_name=excluded.route_name,
              vehicle_id=excluded.vehicle_id, vehicle_name=excluded.vehicle_name,
              updated_at=excluded.updated_at, payload=excluded.payload,
              payment_type=excluded.payment_type,
              amount_cash=excluded.amount_cash, amount_cheque=excluded.amount_cheque, amount_credit=excluded.amount_credit,
              invoice_number=COALESCE(NULLIF(excluded.invoice_number, ''), sale_orders.invoice_number),
              cancel_reason=COALESCE(NULLIF(excluded.cancel_reason, ''), sale_orders.cancel_reason)`,
            params
          );
        } catch (rowErr) {
          logError(op, `row index=${i} id=${rid} name=${empty(r.name)} paramsTypes=[${params.map((p) => typeof p).join(',')}]`, rowErr);
          throw rowErr;
        }
      }
    });
    logQuery(op, `done upserted ${rows.length} rows`);
  } catch (err) {
    logError(op, `rows=${rows.length} preserveIds=${preserveIds.length}`, err);
    throw err;
  }
}

/**
 * @param {number | null} [vehicleId] - When set, return only sale orders for this vehicle.
 */
/** Cancelled orders for history screen (includes offline-cancelled rows). */
export async function getCancelledSaleOrders(vehicleId = null, sortField = 'date_order') {
  const op = 'getCancelledSaleOrders';
  const orderColumn = sortField === 'commitment_date' ? 'commitment_date' : 'date_order';
  logQuery(op, `vehicleId=${vehicleId ?? 'null'} sortField=${orderColumn}`);
  const db = await getDb();
  const sql =
    vehicleId != null
      ? `SELECT so.*, p.name_tamil AS partner_name_tamil, p.name_sinhala AS partner_name_sinhala
         FROM sale_orders so
         LEFT JOIN partners p ON so.partner_id = p.id
         WHERE so.vehicle_id = ? AND LOWER(COALESCE(so.state, '')) = 'cancel'
         ORDER BY so.${orderColumn} DESC, so.id DESC LIMIT 1000`
      : `SELECT so.*, p.name_tamil AS partner_name_tamil, p.name_sinhala AS partner_name_sinhala
         FROM sale_orders so
         LEFT JOIN partners p ON so.partner_id = p.id
         WHERE LOWER(COALESCE(so.state, '')) = 'cancel'
         ORDER BY so.${orderColumn} DESC, so.id DESC LIMIT 1000`;
  const args = vehicleId != null ? [vehicleId] : [];
  try {
    const rows = await db.getAllAsync(sql, args);
    return (rows || []).map((row) => ({
      ...row,
      order_line: safeParseJson(row.order_line, []),
      route_id: row.route_id != null ? [row.route_id, row.route_name ?? ''] : null,
      vehicle_id: row.vehicle_id != null ? [row.vehicle_id, row.vehicle_name ?? ''] : null,
      partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
    }));
  } catch (err) {
    logError(op, `vehicleId=${vehicleId}`, err);
    throw err;
  }
}

export async function getAllSaleOrders(vehicleId = null, sortField = 'date_order') {
  const op = 'getAllSaleOrders';
  const orderColumn = sortField === 'commitment_date' ? 'commitment_date' : 'date_order';
  logQuery(op, `vehicleId=${vehicleId ?? 'null'} sortField=${orderColumn}`);
  const db = await getDb();
  const sql =
    vehicleId != null
      ? `SELECT so.*, p.name_tamil AS partner_name_tamil, p.name_sinhala AS partner_name_sinhala
         FROM sale_orders so
         LEFT JOIN partners p ON so.partner_id = p.id
         WHERE so.vehicle_id = ? ORDER BY so.${orderColumn} DESC, so.id DESC LIMIT 1000`
      : `SELECT so.*, p.name_tamil AS partner_name_tamil, p.name_sinhala AS partner_name_sinhala
         FROM sale_orders so
         LEFT JOIN partners p ON so.partner_id = p.id
         ORDER BY so.${orderColumn} DESC, so.id DESC LIMIT 1000`;
  const args = vehicleId != null ? [vehicleId] : [];
  try {
    const rows = await db.getAllAsync(sql, args);
    const result = (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
      partner_name_tamil: row.partner_name_tamil ?? null,
      partner_name_sinhala: row.partner_name_sinhala ?? null,
      state: row.state,
      date_order: row.date_order,
      commitment_date: row.commitment_date,
      amount_total: row.amount_total,
      amount_untaxed: row.amount_untaxed,
      amount_tax: row.amount_tax,
      invoice_status: row.invoice_status,
      order_line: safeParseJson(row.order_line, []),
      route_id: row.route_id != null ? [row.route_id, row.route_name ?? ''] : null,
      vehicle_id: row.vehicle_id != null ? [row.vehicle_id, row.vehicle_name ?? ''] : null,
      payment_type: row.payment_type ?? null,
      amount_credit: row.amount_credit != null ? row.amount_credit : null,
      amount_cash: row.amount_cash != null ? row.amount_cash : null,
      amount_cheque: row.amount_cheque != null ? row.amount_cheque : null,
      invoice_number: row.invoice_number != null && String(row.invoice_number).trim() !== '' ? String(row.invoice_number).trim() : null,
    }));
    logQuery(op, `done count=${result.length}`);
    return result;
  } catch (err) {
    logError(op, `vehicleId=${vehicleId} sql=${sql.slice(0, 60)}... args=${JSON.stringify(args)}`, err);
    throw err;
  }
}

/** Batch fetch orders with partner fields (My Invoices list — avoids N+1). */
export async function getSaleOrdersByIds(ids = []) {
  const wanted = [...new Set((ids || []).map((id) => num(id)).filter((id) => id > 0))];
  if (wanted.length === 0) return {};
  const db = await getDb();
  const placeholders = wanted.map(() => '?').join(',');
  try {
    const rows = await db.getAllAsync(
      `
      SELECT so.*, p.city as partner_city, p.phone as partner_phone,
        p.name_tamil as partner_name_tamil, p.name_sinhala as partner_name_sinhala
      FROM sale_orders so
      LEFT JOIN partners p ON so.partner_id = p.id
      WHERE so.id IN (${placeholders})
    `,
      wanted
    );
    const out = {};
    for (const row of rows || []) {
      out[row.id] = {
        ...row,
        city: row.partner_city || '',
        partner_phone: row.partner_phone ?? '',
        partner_name_tamil: row.partner_name_tamil ?? null,
        partner_name_sinhala: row.partner_name_sinhala ?? null,
        partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
        order_line: safeParseJson(row.order_line, []),
      };
    }
    return out;
  } catch (e) {
    logError('getSaleOrdersByIds', `ids=${wanted.length}`, e);
    const rows = await db.getAllAsync(
      `SELECT * FROM sale_orders WHERE id IN (${placeholders})`,
      wanted
    );
    const out = {};
    for (const row of rows || []) {
      out[row.id] = {
        ...row,
        partner_name_tamil: null,
        partner_name_sinhala: null,
        order_line: safeParseJson(row.order_line, []),
      };
    }
    return out;
  }
}

export async function getSaleOrderById(id) {
  const op = 'getSaleOrderById';
  logQuery(op, `id=${id}`);
  const db = await getDb();
  try {
    const row = await db.getFirstAsync(`
      SELECT so.*, p.city as partner_city, p.phone as partner_phone,
        p.name_tamil as partner_name_tamil, p.name_sinhala as partner_name_sinhala
      FROM sale_orders so
      LEFT JOIN partners p ON so.partner_id = p.id
      WHERE so.id = ?
    `, [id]);

    if (!row) return null;

    return {
      ...row,
      city: row.partner_city || '',
      partner_phone: row.partner_phone ?? '',
      partner_name_tamil: row.partner_name_tamil ?? null,
      partner_name_sinhala: row.partner_name_sinhala ?? null,
      partner_id: row.partner_id != null ? [row.partner_id, row.partner_name ?? ''] : null,
      order_line: safeParseJson(row.order_line, []),
    };
  } catch (e) {
    logError(op, `id=${id} (with JOIN)`, e);
    try {
      const row = await db.getFirstAsync('SELECT * FROM sale_orders WHERE id = ?', [id]);
      return row
        ? {
            ...row,
            partner_name_tamil: null,
            partner_name_sinhala: null,
            order_line: safeParseJson(row.order_line, []),
          }
        : null;
    } catch (fallbackErr) {
      logError(op, `id=${id} fallback SELECT`, fallbackErr);
      throw fallbackErr;
    }
  }
}

/**
 * Keep only the provided sale order ids in local table. Useful when sync window changes
 * (e.g. creation date vs delivery date) so stale local rows do not remain visible.
 * @param {Array<number>} keepIds
 * @param {{ preserveLocalForSaleOrderIds?: Set<number> | number[] }} [options]
 * @deprecated Prefer pruneSaleOrdersForVehicle — global prune can delete other vehicles' offline history.
 */
export async function pruneSaleOrdersToIds(keepIds = [], options = {}) {
  return pruneSaleOrdersForVehicle(null, keepIds, options);
}

/**
 * Prune stale orders for one vehicle only. Other vehicles' local delivered/invoiced rows are untouched.
 * @param {number|null} vehicleId — when null/invalid, prune is skipped (admin-safe).
 */
export async function pruneSaleOrdersForVehicle(vehicleId, keepIds = [], options = {}) {
  const db = await getDb();
  const vid = num(vehicleId);
  const preserveSet = options.preserveLocalForSaleOrderIds;
  const preserveIds = preserveSet instanceof Set ? Array.from(preserveSet) : Array.isArray(preserveSet) ? preserveSet : [];
  const merged = [
    ...new Set([...(keepIds || []), ...preserveIds].map((id) => num(id)).filter((id) => Number.isFinite(id) && id > 0)),
  ];

  if (!Number.isFinite(vid) || vid <= 0) {
    logQuery('pruneSaleOrdersForVehicle', 'skipped — no vehicle scope (multi-vehicle history preserved)');
    return { pruned: 0, skipped: true };
  }

  if (merged.length === 0) {
    logQuery('pruneSaleOrdersForVehicle', `skipped vehicle=${vid} — empty keep list`);
    return { pruned: 0, skipped: true };
  }

  const placeholders = merged.map(() => '?').join(',');
  const result = await db.runAsync(
    `DELETE FROM sale_orders WHERE vehicle_id = ? AND id NOT IN (${placeholders})`,
    [vid, ...merged]
  );
  const pruned = result?.changes ?? 0;
  logQuery('pruneSaleOrdersForVehicle', `vehicle=${vid} keep=${merged.length} removed=${pruned}`);
  return { pruned, skipped: false };
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
  const op = 'updateSaleOrderAmountsFromLines';
  logQuery(op, `orderId=${orderId}`);
  const db = await getDb();
  const orderIdNum = num(orderId);
  try {
    const lineRows = await db.getAllAsync(
      'SELECT price_subtotal, price_total FROM sale_order_lines WHERE order_id = ?',
      [orderIdNum]
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
      [amountUntaxed, amountTax, amountTotal, iso(), orderIdNum]
    );
    logQuery(op, `done orderId=${orderId} total=${amountTotal}`);
  } catch (err) {
    logError(op, `orderId=${orderId}`, err);
    throw err;
  }
}

/**
 * Update header fields from a fresh Odoo `sale.order` read (e.g. after payment / invoice post).
 * Pass only fields that should be written; omitted keys leave the column unchanged.
 */
export async function patchSaleOrderHeaderFromOdoo(orderId, { invoice_status, invoice_number } = {}) {
  const op = 'patchSaleOrderHeaderFromOdoo';
  const id = num(orderId);
  if (!Number.isFinite(id) || id <= 0) return;
  const parts = [];
  const vals = [];
  if (invoice_status != null && invoice_status !== false) {
    parts.push('invoice_status = ?');
    vals.push(empty(invoice_status));
  }
  if (invoice_number != null && String(invoice_number).trim() !== '') {
    parts.push('invoice_number = ?');
    vals.push(String(invoice_number).trim());
  }
  if (parts.length === 0) return;
  const db = await getDb();
  try {
    vals.push(iso(), id);
    await db.runAsync(
      `UPDATE sale_orders SET ${parts.join(', ')}, updated_at = ? WHERE id = ?`,
      vals
    );
    logQuery(op, `id=${id}`);
  } catch (err) {
    logError(op, `id=${id}`, err);
    throw err;
  }
}

/**
 * Update sale order invoice_status locally (offline). e.g. 'invoiced'.
 */
export async function updateSaleOrderInvoiceStatusLocal(orderId, invoiceStatus) {
  const op = 'updateSaleOrderInvoiceStatusLocal';
  logQuery(op, `orderId=${orderId} status=${invoiceStatus}`);
  const db = await getDb();
  const params = [empty(invoiceStatus) || 'invoiced', iso(), num(orderId)];
  try {
    await db.runAsync(
      `UPDATE sale_orders SET invoice_status = ?, updated_at = ? WHERE id = ?`,
      params
    );
    logQuery(op, `done orderId=${orderId}`);
  } catch (err) {
    logError(op, `orderId=${orderId} params=${JSON.stringify(params)}`, err);
    throw err;
  }
}

/** Update sale order state locally (offline). e.g. 'cancel'. */
export async function updateSaleOrderStateLocal(orderId, state) {
  const op = 'updateSaleOrderStateLocal';
  logQuery(op, `orderId=${orderId} state=${state}`);
  const db = await getDb();
  const params = [empty(state) || 'cancel', iso(), num(orderId)];
  try {
    await db.runAsync(
      `UPDATE sale_orders SET state = ?, updated_at = ? WHERE id = ?`,
      params
    );
    logQuery(op, `done orderId=${orderId}`);
  } catch (err) {
    logError(op, `orderId=${orderId} params=${JSON.stringify(params)}`, err);
    throw err;
  }
}

/** Offline cancel: state + reason stored until Odoo sync confirms. */
export async function updateSaleOrderCancelLocal(orderId, reason = '') {
  const op = 'updateSaleOrderCancelLocal';
  const db = await getDb();
  const params = ['cancel', empty(reason), iso(), num(orderId)];
  logQuery(op, `orderId=${orderId} reason=${empty(reason).slice(0, 40)}`);
  try {
    await db.runAsync(
      `UPDATE sale_orders SET state = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
      params
    );
    logQuery(op, `done orderId=${orderId}`);
  } catch (err) {
    logError(op, `orderId=${orderId}`, err);
    throw err;
  }
}

/**
 * Update sale order payment_type (and optional amount_credit) locally when user completes payment.
 * Values: 'cash' | 'cheque' | 'credit'. amountCredit: optional number for credit portion (split payments).
 */
export async function updateSaleOrderPaymentTypeLocal(orderId, paymentType, amountCredit = null) {
  const op = 'updateSaleOrderPaymentTypeLocal';
  logQuery(op, `orderId=${orderId} paymentType=${paymentType} amountCredit=${amountCredit}`);
  const db = await getDb();
  const typeStr =
    paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit'
      ? String(paymentType)
      : '';
  const creditNum =
    amountCredit != null && typeof amountCredit !== 'object' && !Number.isNaN(Number(amountCredit))
      ? Number(amountCredit)
      : 0;
  const orderIdNum = num(orderId);
  const params = [typeStr, creditNum, iso(), orderIdNum];
  try {
    await db.runAsync(
      `UPDATE sale_orders SET payment_type = ?, amount_credit = ?, updated_at = ? WHERE id = ?`,
      params
    );
    logQuery(op, `done orderId=${orderId}`);
  } catch (err) {
    logError(op, `orderId=${orderId} params=[${params.map((p) => typeof p).join(',')}]`, err);
    throw err;
  }
}

/**
 * Update payment_type by order ID (preferred when syncing from Odoo – avoids name mismatch).
 */
export async function updatePaymentTypeByOrderId(orderId, paymentType) {
  if (orderId == null || orderId === '') return;
  const op = 'updatePaymentTypeByOrderId';
  const idNum = num(orderId);
  logQuery(op, `id=${idNum} paymentType=${paymentType}`);
  const db = await getDb();
  const type =
    paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit'
      ? String(paymentType)
      : '';
  try {
    await db.runAsync(
      `UPDATE sale_orders SET payment_type = ?, updated_at = ? WHERE id = ?`,
      [type, iso(), idNum]
    );
    logQuery(op, `done id=${idNum}`);
  } catch (err) {
    logError(op, `id=${idNum} paymentType=${paymentType}`, err);
    throw err;
  }
}

/**
 * Update payment split (cash/cheque/credit) and primary payment_type from Odoo sync.
 * Use when order has multiple payments (e.g. part cash + part cheque); balance = credit.
 */
export async function updatePaymentSplitByOrderId(orderId, split, paymentType) {
  if (orderId == null || orderId === '') return;
  const idNum = num(orderId);
  const cash = split && typeof split.cash === 'number' ? split.cash : 0;
  const cheque = split && typeof split.cheque === 'number' ? split.cheque : 0;
  const credit = split && typeof split.credit === 'number' ? split.credit : 0;
  const type =
    paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit'
      ? String(paymentType)
      : '';
  const db = await getDb();
  try {
    await db.runAsync(
      `UPDATE sale_orders SET payment_type = ?, amount_cash = ?, amount_cheque = ?, amount_credit = ?, updated_at = ? WHERE id = ?`,
      [type, cash, cheque, credit, iso(), idNum]
    );
  } catch (err) {
    logError('updatePaymentSplitByOrderId', `id=${idNum}`, err);
    throw err;
  }
}

/**
 * Update payment split by order name (fallback when ID not available).
 */
export async function updatePaymentSplitByOrderName(orderName, split, paymentType) {
  const trimmed = orderName != null ? String(orderName).trim() : '';
  if (trimmed === '') return;
  const cash = split && typeof split.cash === 'number' ? split.cash : 0;
  const cheque = split && typeof split.cheque === 'number' ? split.cheque : 0;
  const credit = split && typeof split.credit === 'number' ? split.credit : 0;
  const type =
    paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit'
      ? String(paymentType)
      : '';
  const db = await getDb();
  try {
    await db.runAsync(
      `UPDATE sale_orders SET payment_type = ?, amount_cash = ?, amount_cheque = ?, amount_credit = ?, updated_at = ? WHERE name = ?`,
      [type, cash, cheque, credit, iso(), trimmed]
    );
  } catch (err) {
    logError('updatePaymentSplitByOrderName', `name=${trimmed}`, err);
    throw err;
  }
}

/**
 * Update payment_type by order name (fallback when order ID not available).
 */
export async function updatePaymentTypeByOrderName(orderName, paymentType) {
  const trimmed = orderName != null ? String(orderName).trim() : '';
  if (trimmed === '') return;
  const op = 'updatePaymentTypeByOrderName';
  logQuery(op, `name=${trimmed} paymentType=${paymentType}`);
  const db = await getDb();
  const type =
    paymentType === 'cash' || paymentType === 'cheque' || paymentType === 'credit'
      ? String(paymentType)
      : '';
  const params = [type, iso(), trimmed];
  try {
    await db.runAsync(
      `UPDATE sale_orders SET payment_type = ?, updated_at = ? WHERE name = ?`,
      params
    );
    logQuery(op, `done name=${orderName}`);
  } catch (err) {
    logError(op, `name=${orderName} paymentType=${paymentType}`, err);
    throw err;
  }
}

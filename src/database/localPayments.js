/**
 * Local payments table: split payment records (cash / cheque / credit) per invoice.
 * Full history of payment_type-wise split; sync queue uploads to Odoo later.
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso, sqliteIntegerFkOrNull } from './dbHelpers.js';

/** INTEGER FK bind for Android / Kotlin: null only when absent; never pass objects. */
function journalIdBind(raw) {
  const v = sqliteIntegerFkOrNull(raw);
  return v === null ? null : v;
}

/**
 * Insert a local payment row (one per payment type with amount > 0).
 * @param {Object} row - { invoice_id, sale_order_id, payment_type, amount, journal_id?, check_number?, bank_name? }
 */
export async function insertLocalPayment(row) {
  const db = await getDb();
  const now = iso();
  await db.runAsync(
    `INSERT INTO local_payments (invoice_id, sale_order_id, payment_type, amount, journal_id, check_number, bank_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      num(row.invoice_id),
      num(row.sale_order_id),
      empty(row.payment_type),
      num(row.amount),
      journalIdBind(row.journal_id),
      empty(row.check_number),
      empty(row.bank_name),
      now,
    ]
  );
}

/**
 * Replace all payments for an invoice (e.g. when re-confirming). Deletes existing then inserts new set.
 */
export async function replacePaymentsForInvoice(invoiceId, paymentRows) {
  const db = await getDb();
  const invoiceIdNum = num(invoiceId);
  const now = iso();
  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM local_payments WHERE invoice_id = ?', [invoiceIdNum]);
    for (const row of paymentRows || []) {
      if (num(row.amount) <= 0) continue;
      await tx.runAsync(
        `INSERT INTO local_payments (invoice_id, sale_order_id, payment_type, amount, journal_id, check_number, bank_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceIdNum,
          num(row.sale_order_id),
          empty(row.payment_type),
          num(row.amount),
          journalIdBind(row.journal_id),
          empty(row.check_number),
          empty(row.bank_name),
          now,
        ]
      );
    }
  });
}

export async function getLocalPaymentsByInvoiceId(invoiceId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM local_payments WHERE invoice_id = ? ORDER BY id',
    [num(invoiceId)]
  );
  return (rows || []).map(mapRow);
}

export async function getLocalPaymentsBySaleOrderId(saleOrderId) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM local_payments WHERE sale_order_id = ? ORDER BY id',
    [num(saleOrderId)]
  );
  return (rows || []).map(mapRow);
}

/** Get payment split summary by sale_order_id: { cash, cheque, credit } */
export async function getPaymentSplitBySaleOrderId(saleOrderId) {
  const rows = await getLocalPaymentsBySaleOrderId(saleOrderId);
  const split = { cash: 0, cheque: 0, credit: 0 };
  for (const r of rows) {
    const t = (r.payment_type || '').toLowerCase();
    const amt = num(r.amount);
    if (t === 'cash') split.cash += amt;
    else if (t === 'cheque' || t === 'check') split.cheque += amt;
    else if (t === 'credit') split.credit += amt;
  }
  return split;
}

/** Get payment split for multiple sale order ids. Returns { [saleOrderId]: { cash, cheque, credit } }. */
export async function getPaymentSplitsBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const db = await getDb();
  const ids = saleOrderIds.map((id) => num(id)).filter((n) => n > 0);
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT sale_order_id, payment_type, amount FROM local_payments WHERE sale_order_id IN (${placeholders})`,
    ids
  );
  const out = {};
  for (const id of ids) out[id] = { cash: 0, cheque: 0, credit: 0 };
  for (const r of rows || []) {
    const soId = num(r.sale_order_id);
    if (out[soId] == null) continue;
    const t = (r.payment_type || '').toLowerCase();
    const amt = num(r.amount);
    if (t === 'cash') out[soId].cash += amt;
    else if (t === 'cheque' || t === 'check') out[soId].cheque += amt;
    else if (t === 'credit') out[soId].credit += amt;
  }
  return out;
}

/**
 * Get payment split with journal ids for tab categorization (Delivery tab).
 * Journal name: CHQ* → Cheque section, Cash_* → Cash section.
 * Returns { [saleOrderId]: { cash, cheque, credit, cashJournalId, chequeJournalId } }.
 * cashJournalId/chequeJournalId are from the row with max amount for that type.
 */
export async function getPaymentSplitsWithJournalsBySaleOrderIds(saleOrderIds) {
  if (!Array.isArray(saleOrderIds) || saleOrderIds.length === 0) return {};
  const db = await getDb();
  const ids = saleOrderIds.map((id) => num(id)).filter((n) => n > 0);
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT sale_order_id, payment_type, amount, journal_id FROM local_payments WHERE sale_order_id IN (${placeholders})`,
    ids
  );
  const out = {};
  for (const id of ids) out[id] = { cash: 0, cheque: 0, credit: 0, cashJournalId: null, chequeJournalId: null };
  const cashRowsBySo = {};
  const chequeRowsBySo = {};
  for (const r of rows || []) {
    const soId = num(r.sale_order_id);
    if (out[soId] == null) continue;
    const t = (r.payment_type || '').toLowerCase();
    const amt = num(r.amount);
    const jid = numOrNull(r.journal_id);
    if (t === 'cash') {
      out[soId].cash += amt;
      if (!cashRowsBySo[soId] || num(cashRowsBySo[soId].amount) < amt) cashRowsBySo[soId] = { amount: amt, journal_id: jid };
    } else if (t === 'cheque' || t === 'check') {
      out[soId].cheque += amt;
      if (!chequeRowsBySo[soId] || num(chequeRowsBySo[soId].amount) < amt) chequeRowsBySo[soId] = { amount: amt, journal_id: jid };
    } else if (t === 'credit') {
      out[soId].credit += amt;
    }
  }
  for (const soId of ids) {
    if (cashRowsBySo[soId]?.journal_id != null) out[soId].cashJournalId = numOrNull(cashRowsBySo[soId].journal_id);
    if (chequeRowsBySo[soId]?.journal_id != null) out[soId].chequeJournalId = numOrNull(chequeRowsBySo[soId].journal_id);
  }
  return out;
}

export async function updateLocalPaymentSynced(paymentId, odooPaymentId = null) {
  const db = await getDb();
  const now = iso();
  if (odooPaymentId != null) {
    await db.runAsync(
      'UPDATE local_payments SET synced_at = ?, odoo_payment_id = ? WHERE id = ?',
      [now, num(odooPaymentId), num(paymentId)]
    );
  } else {
    await db.runAsync('UPDATE local_payments SET synced_at = ? WHERE id = ?', [now, num(paymentId)]);
  }
}

/** Mark all payments for an invoice as synced (e.g. when queue item is marked synced). */
export async function markPaymentsSyncedByInvoiceId(invoiceId) {
  const db = await getDb();
  const now = iso();
  await db.runAsync('UPDATE local_payments SET synced_at = ? WHERE invoice_id = ?', [now, num(invoiceId)]);
}

function mapRow(row) {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    sale_order_id: row.sale_order_id,
    payment_type: row.payment_type,
    amount: row.amount,
    journal_id: row.journal_id,
    check_number: row.check_number,
    bank_name: row.bank_name,
    created_at: row.created_at,
    synced_at: row.synced_at,
    odoo_payment_id: row.odoo_payment_id != null ? row.odoo_payment_id : null,
  };
}

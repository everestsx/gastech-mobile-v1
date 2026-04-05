/**
 * Local invoices table: offline invoice records per sale order.
 * Delivery person completes the invoicing cycle locally; sync queue uploads to Odoo later.
 */
import { getDb } from './db.js';
import { empty, num, numOrNull, iso } from './dbHelpers.js';

/**
 * Signature TEXT for expo-sqlite Android: always a primitive string (never null/object).
 * Kotlin bridge rejects null/undefined/object for some TEXT binds.
 */
function signatureBlobForSqlite(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') return '';
  const s = String(v).trim();
  if (s === '' || s === '[object Object]') return '';
  return s;
}

/**
 * Insert or replace local invoice for a sale order (one invoice per SO).
 * @param {Object} row - { sale_order_id, invoice_number, amount_total, amount_untaxed?, amount_tax?, state? }
 * @returns {Promise<number>} local invoice id
 */
export async function upsertLocalInvoice(row) {
  const db = await getDb();
  const now = iso();
  const saleOrderId = num(row.sale_order_id);
  const invoiceNumber = empty(row.invoice_number);
  const amountTotal = num(row.amount_total);
  const amountUntaxed = numOrNull(row.amount_untaxed) ?? amountTotal;
  const amountTax = numOrNull(row.amount_tax) ?? 0;
  const state = empty(row.state) || 'posted';
  const custSig = signatureBlobForSqlite(row.customer_signature_data);
  const drvSig = signatureBlobForSqlite(row.driver_signature_data);

  const existing = await db.getFirstAsync(
    'SELECT id FROM local_invoices WHERE sale_order_id = ?',
    [saleOrderId]
  );
  if (existing?.id != null) {
    await db.runAsync(
      `UPDATE local_invoices SET invoice_number = ?, amount_total = ?, amount_untaxed = ?, amount_tax = ?, state = ?, updated_at = ?,
       customer_signature_data = ?, driver_signature_data = ?
       WHERE sale_order_id = ?`,
      [
        invoiceNumber,
        amountTotal,
        amountUntaxed,
        amountTax,
        state,
        now,
        custSig,
        drvSig,
        saleOrderId,
      ]
    );
    return num(existing.id);
  }
  // Avoid using runAsync return value (can trigger "Cannot convert to Kotlin type" on Android APK)
  await db.runAsync(
    `INSERT INTO local_invoices (sale_order_id, invoice_number, amount_total, amount_untaxed, amount_tax, state, created_at, updated_at, customer_signature_data, driver_signature_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      saleOrderId,
      invoiceNumber,
      amountTotal,
      amountUntaxed,
      amountTax,
      state,
      now,
      now,
      custSig,
      drvSig,
    ]
  );
  const inserted = await db.getFirstAsync(
    'SELECT id FROM local_invoices WHERE sale_order_id = ? ORDER BY id DESC LIMIT 1',
    [saleOrderId]
  );
  return num(inserted?.id);
}

export async function getLocalInvoiceBySaleOrderId(saleOrderId) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    'SELECT * FROM local_invoices WHERE sale_order_id = ?',
    [num(saleOrderId)]
  );
  return row ? mapRow(row) : null;
}

export async function getLocalInvoiceById(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT * FROM local_invoices WHERE id = ?', [num(id)]);
  return row ? mapRow(row) : null;
}

/** Distinct sale order ids that have any row in local_invoices (payment completed on device). */
export async function getSaleOrderIdsWithLocalInvoices() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT DISTINCT sale_order_id FROM local_invoices WHERE sale_order_id IS NOT NULL'
  );
  const out = new Set();
  for (const r of rows || []) {
    const id = num(r.sale_order_id);
    if (id > 0) out.add(id);
  }
  return out;
}

/** Sale order ids that have a local invoice not yet linked/synced to Odoo — used to preserve invoice_status during download. */
export async function getUnsyncedLocalInvoiceSaleOrderIds() {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT sale_order_id FROM local_invoices WHERE synced_at IS NULL'
  );
  const out = new Set();
  for (const r of rows || []) {
    const id = num(r.sale_order_id);
    if (id > 0) out.add(id);
  }
  return out;
}

/** Get all local invoices (optionally only unsynced). */
export async function getAllLocalInvoices(unsyncedOnly = false) {
  const db = await getDb();
  const sql = unsyncedOnly
    ? 'SELECT * FROM local_invoices WHERE synced_at IS NULL ORDER BY created_at DESC'
    : 'SELECT * FROM local_invoices ORDER BY created_at DESC';
  const rows = await db.getAllAsync(sql);
  return (rows || []).map(mapRow);
}

export async function updateLocalInvoiceSynced(invoiceId, odooInvoiceId = null) {
  const db = await getDb();
  const now = iso();
  if (odooInvoiceId != null) {
    await db.runAsync(
      'UPDATE local_invoices SET synced_at = ?, odoo_invoice_id = ?, updated_at = ? WHERE id = ?',
      [now, num(odooInvoiceId), now, num(invoiceId)]
    );
  } else {
    await db.runAsync(
      'UPDATE local_invoices SET synced_at = ?, updated_at = ? WHERE id = ?',
      [now, now, num(invoiceId)]
    );
  }
}

function mapRow(row) {
  return {
    id: row.id,
    sale_order_id: row.sale_order_id,
    invoice_number: row.invoice_number,
    amount_total: row.amount_total,
    amount_untaxed: row.amount_untaxed,
    amount_tax: row.amount_tax,
    state: row.state,
    created_at: row.created_at,
    updated_at: row.updated_at,
    synced_at: row.synced_at,
    odoo_invoice_id: row.odoo_invoice_id != null ? row.odoo_invoice_id : null,
    customer_signature_data: row.customer_signature_data ?? null,
    driver_signature_data: row.driver_signature_data ?? null,
  };
}

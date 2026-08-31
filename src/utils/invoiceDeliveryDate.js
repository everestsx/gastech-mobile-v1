/**
 * Invoice date vs committed delivery date.
 *
 * - Never treat sync/create "today" as the delivery date.
 * - Never overwrite commitment_date / delivery_date as a business change.
 * - invoice_date is written only when invoicing happens on a later calendar day
 *   than the original committed date.
 * - If picking validation moved commitment_date to today, restore the original.
 */

import { formatLocalYyyyMmDd } from './localDate';

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** @returns {string|null} YYYY-MM-DD */
export function parseOdooDateToIso(raw) {
  if (raw == null || raw === false) return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'false') return null;
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return head ? head[1] : null;
}

export function localTodayIso() {
  return formatLocalYyyyMmDd(new Date());
}

/** True only when the invoice is created on a later day than the committed delivery date. */
export function shouldOverrideInvoiceDate(committedIso) {
  if (!isIsoDate(committedIso)) return false;
  return committedIso.trim() !== localTodayIso();
}

function payloadCommitmentHints(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return {
    iso: isIsoDate(payload.invoiceDateIso) ? payload.invoiceDateIso.trim() : null,
    raw: payload.commitmentDateRaw || null,
  };
}

/**
 * Original committed date from checkout cache / local SQLite — not live Odoo
 * (picking validate can move Odoo commitment_date to today).
 */
export async function resolveOriginalCommitmentIso(saleOrderId, hints = {}) {
  const pay = payloadCommitmentHints(hints?.paymentPayload);
  if (pay.iso) return { iso: pay.iso, raw: pay.raw };
  const del = payloadCommitmentHints(hints?.deliveryPayload);
  if (del.iso) return { iso: del.iso, raw: del.raw };

  const fromHint =
    parseOdooDateToIso(hints?.order?.commitment_date) ||
    parseOdooDateToIso(hints?.order?.delivery_date);
  if (fromHint) {
    return {
      iso: fromHint,
      raw: hints?.order?.commitment_date || hints?.order?.delivery_date || fromHint,
    };
  }

  const soNum = Number(saleOrderId);
  if (!Number.isFinite(soNum) || soNum <= 0) return { iso: null, raw: null };

  try {
    const saleOrdersDb = await import('../database/saleOrders.js');
    const row = await saleOrdersDb.getSaleOrderById(soNum);
    const fromDb = parseOdooDateToIso(row?.commitment_date) || parseOdooDateToIso(row?.delivery_date);
    if (fromDb) {
      return { iso: fromDb, raw: row?.commitment_date || row?.delivery_date || fromDb };
    }
  } catch (_) {
    /* non-fatal */
  }

  return { iso: null, raw: null };
}

export async function resolveInvoiceDateFromCommitment(saleOrderId, hints = {}) {
  const original = await resolveOriginalCommitmentIso(saleOrderId, hints);
  if (original.iso) return original.iso;

  const soNum = Number(saleOrderId);
  if (!Number.isFinite(soNum) || soNum <= 0) return null;
  try {
    const { callOdoo } = await import('../services/index.service.js');
    const rows = await callOdoo('sale.order', 'read', [[soNum]], {
      fields: ['commitment_date'],
    });
    const so = Array.isArray(rows) ? rows[0] : rows;
    return parseOdooDateToIso(so?.commitment_date);
  } catch (_) {
    return null;
  }
}

function writeValueForCommitment(originalIso, originalRaw) {
  const raw = originalRaw != null ? String(originalRaw).trim() : '';
  if (raw && parseOdooDateToIso(raw) === originalIso) return raw;
  return originalIso;
}

/**
 * Picking validate often sets date_done = now and custom Odoo code copies that onto
 * sale.order.commitment_date. Put the original committed date back. No-op if unchanged.
 */
export async function restoreSaleOrderCommitmentIfMoved(saleOrderId, originalIso, originalRaw) {
  const soNum = Number(saleOrderId);
  if (!Number.isFinite(soNum) || soNum <= 0 || !isIsoDate(originalIso)) return false;
  const { callOdoo, callOdooArgs } = await import('../services/index.service.js');
  const rows = await callOdoo('sale.order', 'read', [[soNum]], {
    fields: ['commitment_date'],
  });
  const so = Array.isArray(rows) ? rows[0] : rows;
  const current = parseOdooDateToIso(so?.commitment_date);
  if (current === originalIso) return false;
  await callOdooArgs('sale.order', 'write', [
    [soNum],
    { commitment_date: writeValueForCommitment(originalIso, originalRaw || so?.commitment_date) },
  ]);
  return true;
}

/**
 * Keep invoice Delivery Date on the original committed day. Only writes delivery_date
 * when it drifted; never uses today.
 */
export async function restoreInvoiceDeliveryDateIfMoved(invoiceId, originalIso) {
  const invNum = Number(invoiceId);
  if (!Number.isFinite(invNum) || invNum <= 0 || !isIsoDate(originalIso)) return false;
  const { callOdoo, callOdooArgs } = await import('../services/index.service.js');
  let current = null;
  try {
    const rows = await callOdoo('account.move', 'read', [[invNum]], {
      fields: ['delivery_date'],
    });
    const inv = Array.isArray(rows) ? rows[0] : rows;
    if (inv == null || !Object.prototype.hasOwnProperty.call(inv, 'delivery_date')) return false;
    current = parseOdooDateToIso(inv.delivery_date);
  } catch (_) {
    return false;
  }
  if (current === originalIso) return false;
  await callOdooArgs('account.move', 'write', [[invNum], { delivery_date: originalIso }]);
  return true;
}

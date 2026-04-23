/**
 * Payment proof: two backend API calls so captured photos appear in the sale order chat.
 *
 * API 1 — ir.attachment.create: name, type "binary", datas (base64, no data URL prefix), res_model "sale.order", res_id, mimetype.
 *   Returns attachment id (e.g. 1305).
 *
 * API 2 — sale.order message_post: args [sale_order_id], kwargs body, attachment_ids: [1305], message_type, subtype_xmlid.
 *
 * Flow: URI → base64 at sync time → API 1 (create) → API 2 (message_post with attachment_ids).
 */
import { callOdooArgs, callOdooArgsKwargs } from './index.service';

const MIMETYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const MIN_BASE64_LENGTH = 50;
const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9+.-]+;base64,/i;

/** Plain text only — Odoo chatter often escapes HTML and shows tags literally. */
const SEP = '────────────────────────────────────────';

function stripDataUrlPrefixOnly(s) {
  if (s == null || typeof s !== 'string') return '';
  const trimmed = s.trim();
  const withoutPrefix = trimmed.replace(DATA_URL_PREFIX_REGEX, '');
  if (withoutPrefix !== trimmed) return withoutPrefix;
  const i = trimmed.indexOf('base64,');
  return i >= 0 ? trimmed.slice(i + 7) : trimmed;
}

/**
 * Build "datas" for ir.attachment create: strip data URL prefix, single line, correct padding.
 */
export function getDatasForOdooAttachment(input) {
  if (input == null || typeof input !== 'string') return null;
  const entireBase64AfterPrefix = stripDataUrlPrefixOnly(input);
  const singleLine = entireBase64AfterPrefix.replace(/\s/g, '');
  if (singleLine.length < MIN_BASE64_LENGTH) return null;
  const remainder = singleLine.length % 4;
  const padded = remainder === 0 ? singleLine : singleLine + '='.repeat(4 - remainder);
  return padded;
}

/** Normalize base64 for Odoo (used by ProceedPaymentScreen and sync). */
export function normalizeBase64ForUpload(base64) {
  return getDatasForOdooAttachment(base64);
}

/**
 * Convert image file/URI to base64 for backend. Used at sync time (offline: store URI only).
 */
export async function imageFileToBase64String(fileSystem, filePathOrUri) {
  if (!fileSystem || !filePathOrUri || typeof filePathOrUri !== 'string') return null;
  try {
    const file = new fileSystem.File(filePathOrUri);
    if (!file.exists) return null;
    const raw = await file.base64();
    return normalizeBase64ForUpload(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Build chatter message body for payment proof (used by sync).
 * For partial payments, pass `payments` array so each method and amount is sent to the backend.
 * @param {Object} opts
 * @param {string} [opts.paymentMethod] - Single method (legacy): 'cash' | 'cheque' | 'credit'
 * @param {string} [opts.chequeBankName]
 * @param {string} [opts.checkNumber]
 * @param {Array<{ type: string, amount: number, checkNumber?: string, bankName?: string }>} [opts.payments] - Per-method entries for partial payments
 */
export function buildPaymentProofMessageBody(opts = {}) {
  const {
    paymentMethod,
    chequeBankName,
    checkNumber,
    payments,
    hasProof = false,
  } = opts;

  const amountToStr = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '');
  };

  const lines = [];
  lines.push('Payment received via Mobile App');
  lines.push(SEP);

  if (Array.isArray(payments) && payments.length > 0) {
    for (const pm of payments) {
      if (pm.type === 'cash') {
        lines.push(`Cash Amount: ${amountToStr(pm.amount)}`);
        lines.push('');
      } else if (pm.type === 'check' || pm.type === 'cheque') {
        lines.push(`Cheque Amount: ${amountToStr(pm.amount)}`);
        if (pm.bankName) lines.push(`Bank: ${pm.bankName}`);
        if (pm.checkNumber) lines.push(`Cheque #: ${pm.checkNumber}`);
        lines.push('');
      } else if (pm.type === 'credit') {
        lines.push(`Credit: ${amountToStr(pm.amount)}`);
        lines.push('');
      }
    }
    if (lines[lines.length - 1] === '') lines.pop();
  } else {
    if (paymentMethod === 'cash') {
      lines.push('Cash payment recorded.');
    } else if (paymentMethod === 'credit') {
      lines.push('Credit payment recorded.');
    } else if (paymentMethod === 'cheque' || chequeBankName || checkNumber) {
      // Legacy path (non-partial) should include payments; this fallback is best-effort.
      lines.push('Cheque payment recorded.');
      if (chequeBankName) lines.push(`Bank: ${chequeBankName}`);
      if (checkNumber) lines.push(`Cheque #: ${checkNumber}`);
    }
  }

  lines.push(SEP);
  lines.push(hasProof ? 'Payment proof photo(s) attached.' : 'Payment recorded (no photo proof attached).');

  return lines.join('\n');
}

/**
 * Build a single chatter message body for one payment type (used when posting separate messages per payment).
 * @param {{ type: string, amount: number, checkNumber?: string, bankName?: string }} pm
 * @returns {string}
 */
export function buildSinglePaymentMessageBody(pm, { hasProof = false } = {}) {
  const amount = Number(pm.amount);
  const amountStr = Number.isFinite(amount) ? amount.toFixed(2) : String(pm.amount ?? '');

  const lines = [];
  lines.push('Payment received via Mobile App');
  lines.push(SEP);

  if (pm.type === 'cash') {
    lines.push(`Cash Amount: ${amountStr}`);
  } else if (pm.type === 'check' || pm.type === 'cheque') {
    lines.push(`Cheque Amount: ${amountStr}`);
    if (pm.bankName) lines.push(`Bank: ${pm.bankName}`);
    if (pm.checkNumber) lines.push(`Cheque #: ${pm.checkNumber}`);
  } else if (pm.type === 'credit') {
    lines.push(`Credit: ${amountStr}`);
  }

  lines.push(SEP);
  lines.push(hasProof ? 'Payment proof photo(s) attached.' : 'Payment recorded (no photo proof attached).');

  return lines.join('\n');
}

/**
 * API 1 — Create ir.attachment. Returns attachment id (e.g. 1305) for message_post attachment_ids.
 */
export async function createProofAttachment(saleOrderId, base64Data, filename = 'payment_proof.jpg') {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for proof attachment');
  const datas = getDatasForOdooAttachment(base64Data);
  if (!datas) throw new Error('Invalid or too short base64 for attachment');

  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const mimetype = MIMETYPES[ext] || 'image/jpeg';
  const payload = {
    name: filename,
    type: 'binary',
    datas,
    res_model: 'sale.order',
    res_id: resId,
    mimetype,
  };
  const result = await callOdooArgs('ir.attachment', 'create', [payload]);
  if (typeof result === 'number' && !Number.isNaN(result)) return result;
  if (Array.isArray(result) && result.length > 0) {
    const id = result[0];
    if (typeof id === 'number' && !Number.isNaN(id)) return id;
  }
  throw new Error('Invalid attachment create result: expected id number');
}

/**
 * Generic sale.order attachment create helper (supports PDF, images, etc.).
 * @param {number|string} saleOrderId
 * @param {string} base64Data raw base64 or data-url
 * @param {string} filename
 * @param {string} mimetype
 */
export async function createSaleOrderAttachment(
  saleOrderId,
  base64Data,
  filename = 'attachment.bin',
  mimetype = 'application/octet-stream'
) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for attachment');
  const datas = getDatasForOdooAttachment(base64Data);
  if (!datas) throw new Error('Invalid base64 for attachment');
  const payload = {
    name: filename,
    type: 'binary',
    datas,
    res_model: 'sale.order',
    res_id: resId,
    mimetype: mimetype || 'application/octet-stream',
  };
  const result = await callOdooArgs('ir.attachment', 'create', [payload]);
  if (typeof result === 'number' && !Number.isNaN(result)) return result;
  if (Array.isArray(result) && result.length > 0) {
    const id = result[0];
    if (typeof id === 'number' && !Number.isNaN(id)) return id;
  }
  throw new Error('Invalid attachment create result: expected id number');
}

/**
 * API 2 — Post message to sale order chatter with attachment_ids (ids from API 1).
 * Odoo: sale.order message_post([sale_order_id], body=..., attachment_ids=[1305], message_type, subtype_xmlid).
 */
/**
 * Build plain-text chatter body for empty-cylinder adjustments (posted with payment sync).
 * @param {Array<{ kg: number, defaultEmptyQty?: number, emptyCollectedQty: number }>} entries
 * @param {string} driverReason - preset + optional detail from driver
 */
export function buildEmptyCylinderChatterBody(entries, driverReason) {
  const lines = [];
  lines.push('Empty cylinders — mobile delivery');
  lines.push(SEP);
  const rows = Array.isArray(entries) ? entries : [];
  for (const e of rows) {
    const kg = Number(e.kg);
    if (!Number.isFinite(kg)) continue;
    const expected = Number(e.defaultEmptyQty ?? e.expectedQty ?? 0) || 0;
    const collected = Number(e.emptyCollectedQty) || 0;
    const diff = Math.round((collected - expected) * 1000) / 1000;
    let delta = 'match';
    if (diff > 0.0001) delta = `+${diff} extra`;
    else if (diff < -0.0001) delta = `${diff} fewer`;
    lines.push(`${kg} kg — expected ${expected}, collected ${collected} (${delta})`);
  }
  lines.push(SEP);
  lines.push(`Driver note: ${String(driverReason || '').trim() || '—'}`);
  return lines.join('\n');
}

export async function postPaymentProofToChatterWithAttachmentIds(saleOrderId, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');

  const body = (options.body && String(options.body).trim()) || 'Payment proof uploaded.';
  const rawIds = options.attachmentIds ?? options.attachment_ids ?? [];
  const attachment_ids = (Array.isArray(rawIds) ? rawIds : [rawIds])
    .map((id) => (typeof id === 'number' ? id : parseInt(id, 10)))
    .filter((id) => !Number.isNaN(id) && id > 0);

  // Exact kwargs from Odoo doc so images show in chatter
  const kwargs = {
    body,
    attachment_ids,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
    context: { mail_create_nosubscribe: true },
  };
  await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
}

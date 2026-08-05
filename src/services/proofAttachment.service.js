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
import { callOdoo, callOdooArgs, callOdooArgsKwargs } from './index.service';

const MIMETYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const MIN_BASE64_LENGTH = 50;
const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9+.-]+;base64,/i;

/**
 * Odoo 17+ escapes plain str bodies in message_post (Markup enforcement).
 * Pass HTML with body_is_html: true so <br/> and <a> render instead of showing as text.
 */
const SEP = '────────────────────────────────────────';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Join chatter lines into Odoo HTML (lines may already contain `<a>` tags). */
export function linesToOdooHtmlBody(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const s = String(line ?? '');
      if (s.includes('<a ') && s.includes('href=')) return s;
      return escapeHtml(s);
    })
    .join('<br/>');
}

export function looksLikeHtmlChatterBody(body) {
  return /<\s*(a|br|p|div|strong|b|ul|li)\b/i.test(String(body || ''));
}

/**
 * Clickable Google Drive anchor for Odoo chatter (requires body_is_html on message_post).
 */
export function buildGoogleDriveLinkAnchor(url, label = 'Click And See Your Payment Proof') {
  const trimmed = String(url || '').trim();
  if (!trimmed) return escapeHtml(label);
  const href = trimmed.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function normalizeDriveLinks(proofDriveLinks) {
  return (Array.isArray(proofDriveLinks) ? proofDriveLinks : [])
    .filter((link) => typeof link === 'string' && link.trim().length > 0)
    .map((link) => link.trim());
}

function extractDriveFileId(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  const m1 = s.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = s.match(/[?&]id=([^&#]+)/i);
  if (m2?.[1]) return m2[1].trim();
  return null;
}

function normalizeChatterBodyForFingerprint(body) {
  return String(body || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function hasRecentSaleOrderCommentNeedle(resId, needle) {
  const term = String(needle || '').trim();
  if (!term) return false;
  try {
    const rows = await callOdoo(
      'mail.message',
      'search_read',
      [
        [
          ['model', '=', 'sale.order'],
          ['res_id', '=', resId],
          ['message_type', '=', 'comment'],
          ['body', 'ilike', term],
        ],
      ],
      { fields: ['id'], order: 'id desc', limit: 1 }
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    return false;
  }
}

function appendDriveProofLinkLines(lines, validDriveLinks, heading) {
  if (!validDriveLinks.length) return;
  lines.push(heading);
  for (let i = 0; i < validDriveLinks.length; i++) {
    const anchor = buildGoogleDriveLinkAnchor(
      validDriveLinks[i],
      `Link ${i + 1} — View photo`
    );
    lines.push(`&nbsp;&nbsp;${anchor}`);
  }
}

/**
 * Build a Google Drive view link from a file ID.
 * @param {string} fileId - Google Drive file ID (e.g. "1a2b3c4d5e6f7g8h9i0j")
 * @returns {string} Full Google Drive view URL
 */
export function buildGoogleDriveLink(fileId) {
  if (!fileId || typeof fileId !== 'string' || fileId.trim().length === 0) return null;
  return `https://drive.google.com/file/d/${fileId.trim()}/view`;
}

/** Chatter body for standalone delivery evidence uploads (Google Drive links). */
export function buildDeliveryEvidenceDriveLinksBody(proofDriveLinks = []) {
  const validDriveLinks = normalizeDriveLinks(proofDriveLinks);
  if (!validDriveLinks.length) {
    return escapeHtml('Delivery evidence photo(s) uploaded.');
  }
  const lines = [];
  appendDriveProofLinkLines(lines, validDriveLinks, 'Delivery evidence photo(s) — Google Drive:');
  return linesToOdooHtmlBody(lines);
}

/** Addendum when payment chatter posted without Drive links — same heading as full payment proof. */
export function buildPaymentProofDriveLinksAddendumBody(proofDriveLinks = [], options = {}) {
  const validDriveLinks = normalizeDriveLinks(proofDriveLinks);
  if (!validDriveLinks.length) return null;
  const lines = [];
  appendDriveProofLinkLines(lines, validDriveLinks, 'Payment proof photo(s) — Google Drive:');
  const marker = String(options?.dedupeMarker || '').trim();
  if (marker) lines.push(`Ref: ${escapeHtml(marker)}`);
  return linesToOdooHtmlBody(lines);
}

/**
 * Best-effort server-side idempotency check:
 * if recent sale.order chatter already contains all given Drive links (or file ids),
 * caller should skip posting duplicate addendum.
 */
export async function saleOrderHasDriveLinksInRecentChatter(saleOrderId, proofDriveLinks = []) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) return false;
  const links = normalizeDriveLinks(proofDriveLinks);
  if (!links.length) return false;
  const checks = [];
  for (const link of links) {
    const fileId = extractDriveFileId(link);
    if (fileId) {
      checks.push(String(fileId));
      continue;
    }
    const compact = String(link || '').trim();
    if (compact) checks.push(compact.slice(0, 120));
  }
  if (!checks.length) return false;
  for (const term of checks) {
    const exists = await hasRecentSaleOrderCommentNeedle(resId, term);
    if (!exists) return false;
  }
  return true;
}

/**
 * Best-effort marker check for idempotent chatter posting.
 * When matchAny=true, returns true if any marker is present in recent chatter.
 */
export async function saleOrderHasRecentChatterMarkers(saleOrderId, markerNeedles = [], options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) return false;
  const needles = (Array.isArray(markerNeedles) ? markerNeedles : [markerNeedles])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  if (!needles.length) return false;
  const matchAny = options?.matchAny === true;
  if (matchAny) {
    for (const needle of needles) {
      if (await hasRecentSaleOrderCommentNeedle(resId, needle)) return true;
    }
    return false;
  }
  for (const needle of needles) {
    if (!(await hasRecentSaleOrderCommentNeedle(resId, needle))) return false;
  }
  return true;
}

/**
 * Best-effort idempotency check for non-attachment chatter.
 * Returns true when an equivalent body text is already present in recent sale.order comments.
 */
export async function saleOrderHasRecentChatterBody(saleOrderId, body) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) return false;
  const normalized = normalizeChatterBodyForFingerprint(body);
  const compact = String(body || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidates = [compact, normalized]
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 12)
    .map((s) => (s.length > 140 ? s.slice(0, 140) : s));
  if (!candidates.length) return false;
  for (const term of candidates) {
    if (await hasRecentSaleOrderCommentNeedle(resId, term)) return true;
  }
  return false;
}

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
 * @param {boolean} [opts.hasProof] - Whether attachments exist
 * @param {Array<string>} [opts.proofDriveLinks] - Google Drive links for payment proofs (if using Drive instead of attachments)
 */
export function buildPaymentProofMessageBody(opts = {}) {
  const {
    paymentMethod,
    chequeBankName,
    checkNumber,
    payments,
    hasProof = false,
    proofDriveLinks = [],
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

  const validDriveLinks = normalizeDriveLinks(proofDriveLinks);
  if (validDriveLinks.length > 0) {
    appendDriveProofLinkLines(lines, validDriveLinks, 'Payment proof photo(s) — Google Drive:');
  } else if (hasProof) {
    lines.push('Payment proof photo(s) attached.');
  } else {
    lines.push('Payment recorded (no photo proof attached).');
  }

  return linesToOdooHtmlBody(lines);
}

/**
 * Build a single chatter message body for one payment type (used when posting separate messages per payment).
 * @param {{ type: string, amount: number, checkNumber?: string, bankName?: string }} pm
 * @param {Object} opts
 * @param {boolean} [opts.hasProof] - Whether attachments exist
 * @param {Array<string>} [opts.proofDriveLinks] - Google Drive links for payment proofs
 * @returns {string}
 */
export function buildSinglePaymentMessageBody(pm, { hasProof = false, proofDriveLinks = [] } = {}) {
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

  const validDriveLinks = normalizeDriveLinks(proofDriveLinks);
  if (validDriveLinks.length > 0) {
    appendDriveProofLinkLines(lines, validDriveLinks, 'Payment proof photo(s) — Google Drive:');
  } else if (hasProof) {
    lines.push('Payment proof photo(s) attached.');
  } else {
    lines.push('Payment recorded (no photo proof attached).');
  }

  return linesToOdooHtmlBody(lines);
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

  const bodyIsHtml =
    options.bodyIsHtml === true ||
    (options.bodyIsHtml !== false && looksLikeHtmlChatterBody(body));

  const kwargs = {
    body,
    attachment_ids,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
    context: { mail_create_nosubscribe: true },
  };
  // Odoo 17+ escapes plain str bodies; body_is_html tells Odoo to render HTML (clickable links).
  if (bodyIsHtml) {
    kwargs.body_is_html = true;
  }
  await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
}

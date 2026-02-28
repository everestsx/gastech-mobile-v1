/**
 * Payment proof: two main backend API calls so the captured photo appears in the sale order chat.
 *
 * API 1 — Create attachment (captured photo as base64):
 *   ir.attachment create with: name, type: "binary", datas, res_model: "sale.order", res_id, mimetype.
 *   When you convert the captured photo to base64 you get a string like:
 *   "data:image/jpeg;base64,/9j/4AAQSkZJRg..." — you MUST remove the prefix "data:image/jpeg;base64,"
 *   (or "data:image/png;base64," etc.) and put only the full rest in the "datas" key.
 *   Backend returns result: 1305 (attachment id).
 *
 * API 2 — Post message with that attachment:
 *   sale.order message_post with args [sale_order_id], kwargs: body, attachment_ids: [1305], message_type, subtype_xmlid.
 *
 * Flow: get base64 → remove "data:image/...;base64," → API 1 (create) → API 2 (message_post with attachment_ids).
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

/** Prefix to remove from captured photo base64 before sending in "datas". e.g. "data:image/jpeg;base64," or "data:image/png;base64," */
const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9+.-]+;base64,/i;

/**
 * Remove only "data:image/jpeg;base64," or "data:image/png;base64," (etc.). Return the ENTIRE rest for the datas key.
 * Do not truncate the base64 — send the full string after the prefix.
 * @param {string} s - e.g. "data:image/jpeg;base64,/9j/4AAQSkZJRg..." or raw base64
 * @returns {string} Full base64 to put in datas (everything after the prefix)
 */
function stripDataUrlPrefixOnly(s) {
  if (s == null || typeof s !== 'string') return '';
  const trimmed = s.trim();
  const withoutPrefix = trimmed.replace(DATA_URL_PREFIX_REGEX, '');
  if (withoutPrefix !== trimmed) return withoutPrefix;
  const i = trimmed.indexOf('base64,');
  return i >= 0 ? trimmed.slice(i + 7) : trimmed;
}

/**
 * Build the string for ir.attachment create "datas" key.
 * - Remove "data:image/jpeg;base64," (or data:image/png;base64, etc.) if present; do not truncate — use full rest.
 * - Single line (strip whitespace/newlines) and fix padding so backend decode works.
 * @param {string} input - Captured photo as base64 or data URL
 * @returns {string|null} Full base64 for datas, or null if too short
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

/** @deprecated Use getDatasForOdooAttachment for ir.attachment datas. */
function stripDataUrlPrefix(s) {
  return stripDataUrlPrefixOnly(s);
}

/**
 * Ensure base64 string has correct padding (length multiple of 4). Python/Odoo decode requires this.
 */
function ensureBase64Padding(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  const clean = b64.replace(/\s/g, '');
  const remainder = clean.length % 4;
  if (remainder === 0) return clean;
  return clean + '='.repeat(4 - remainder);
}

/**
 * Full convert: raw/base64 or data URL → pure base64 for Odoo.
 * Only the prefix (data:image/...;base64,) is removed; the entire base64 string is kept and sent in datas.
 */
export function toPureBase64ForOdoo(input) {
  return getDatasForOdooAttachment(input);
}

/**
 * Validate and normalize base64 for Odoo (exact doc spec: single line, no spaces, no line breaks, no data URL prefix).
 * Alias for toPureBase64ForOdoo — use this or toPureBase64ForOdoo everywhere before sending datas to Odoo.
 * @param {string} base64 - Raw base64 string or data URL (e.g. "data:image/png;base64,iVBORw0KGgo...")
 * @returns {string|null} Normalized pure base64 or null if invalid
 */
export function normalizeBase64ForUpload(base64) {
  return toPureBase64ForOdoo(base64);
}

/**
 * Convert image file to base64 string for backend (single code path for proof photos).
 * Reads file, then normalizes so Odoo ir.attachment create receives valid datas.
 * @param {object} fileSystem - expo-file-system (e.g. import('expo-file-system').default)
 * @param {string} filePathOrUri - Local file path or content URI
 * @returns {Promise<string|null>} Normalized base64 or null if read/normalize failed
 */
export async function imageFileToBase64String(fileSystem, filePathOrUri) {
  if (!fileSystem || !filePathOrUri || typeof filePathOrUri !== 'string') return null;
  try {
    const raw = await fileSystem.readAsStringAsync(filePathOrUri, {
      encoding: fileSystem.EncodingType?.Base64 ?? 'base64',
    });
    return normalizeBase64ForUpload(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Build an attractive chatter message body for backend team.
 * @param {object} opts - { paymentMethod?: 'cash'|'cheque'|'credit', chequeBankName?, checkNumber? }
 * @returns {string} Formatted message (plain text with newlines)
 */
export function buildPaymentProofMessageBody(opts = {}) {
  const { paymentMethod, chequeBankName, checkNumber } = opts;
  const lines = [
    '💳 Payment received via Mobile App',
    '─────────────────────────────',
  ];
  if (paymentMethod === 'cash') {
    lines.push('Method: Cash');
    lines.push('Payment received: Cash.');
  } else if (paymentMethod === 'credit') {
    lines.push('Method: Credit');
    lines.push('Payment received: Credit.');
  } else if (paymentMethod === 'cheque' || chequeBankName || checkNumber) {
    lines.push('Method: Cheque');
    if (chequeBankName) lines.push(`Bank: ${chequeBankName}`);
    if (checkNumber) lines.push(`Cheque #: ${checkNumber}`);
  }
  lines.push('─────────────────────────────');
  lines.push('Payment proof photo(s) attached.');
  return lines.join('\n');
}

/**
 * API 2 — Post message to sale order chatter with attachment_ids (ids from API 1).
 * Backend: sale.order message_post [sale_order_id], kwargs: body, attachment_ids: [1305], message_type, subtype_xmlid.
 */
export async function postPaymentProofToChatterWithAttachmentIds(saleOrderId, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');

  const body = (options.body && String(options.body).trim()) || 'Payment proof uploaded.';
  const rawIds = options.attachmentIds ?? options.attachment_ids ?? [];
  const ids = (Array.isArray(rawIds) ? rawIds : [rawIds])
    .map((id) => (typeof id === 'number' ? id : parseInt(id, 10)))
    .filter((id) => !Number.isNaN(id) && id > 0);

  const kwargs = {
    body,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
  };
  if (ids.length > 0) {
    kwargs.attachment_ids = ids;
  }
  // Try to avoid "a partner cannot follow twice the same object" (API user already follower)
  if (!kwargs.context) kwargs.context = {};
  kwargs.context = { ...kwargs.context, mail_create_nosubscribe: true };
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[ProofAttachment] API 2 sale.order message_post: SO ${resId} attachment_ids=[${ids.join(', ')}]`);
  }
  try {
    await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('cannot follow twice') || msg.includes('UniqueViolation') || msg.includes('mail.followers')) {
      console.warn('[ProofAttachment] message_post failed (duplicate follower). Backend may need to allow re-post or skip subscribe. Error:', msg);
    }
    throw err;
  }
}

/**
 * Post a single message to Sale Order chatter (exact format that works in Postman).
 * Request shape: args = [db, uid, apiKey, "sale.order", "message_post", [sale_order_id], { body, message_type, subtype_xmlid, attachments }].
 * attachments must be [["filename.png", "BASE64_STRING"]] - base64 single line, no spaces/newlines.
 */
export async function postPaymentProofToChatter(saleOrderId, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');

  const body = (options.body && String(options.body).trim()) || 'Payment proof attached from mobile app.';
  const rawAttachments = options.attachments || [];
  const attachments = [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const item = rawAttachments[i];
    const name = Array.isArray(item) ? item[0] : null;
    const b64 = Array.isArray(item) ? item[1] : null;
    const normalized = normalizeBase64ForUpload(b64);
    if (!normalized || !name) continue;
    const filename = String(name).trim();
    if (!filename) continue;
    const safeName = filename.includes('.') ? filename : `payment_proof_${i + 1}.jpg`;
    attachments.push([safeName, normalized]);
  }

  const kwargs = {
    body,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
  };
  if (attachments.length > 0) {
    kwargs.attachments = attachments;
  }

  const result = await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
  return result != null ? result : null;
}

/**
 * API 1 — Create ir.attachment (captured photo as base64).
 * Backend: ir.attachment create with datas = full base64 (prefix "data:image/jpeg;base64," removed).
 * Returns attachment id (e.g. 1305) to use in message_post attachment_ids.
 */
export async function createProofAttachment(saleOrderId, base64Data, filename = 'payment_proof.jpg') {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for proof attachment');
  const datas = getDatasForOdooAttachment(base64Data);
  if (!datas) throw new Error('Invalid or too short base64 for attachment');
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[ProofAttachment] API 1 ir.attachment create: SO ${resId} file=${filename} datas length=${datas.length}`);
  }
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
  const attachmentId = typeof result === 'number' && !Number.isNaN(result) ? result : (Array.isArray(result) && result[0] != null ? result[0] : null);
  if (attachmentId != null && typeof console !== 'undefined' && console.log) {
    console.log(`[ProofAttachment] API 1 result: attachment_id=${attachmentId}`);
  }
  // Backend returns result: 1305 (attachment id)
  if (typeof result === 'number' && !Number.isNaN(result)) return result;
  if (Array.isArray(result) && result.length > 0) {
    const id = result[0];
    if (typeof id === 'number' && !Number.isNaN(id)) return id;
  }
  throw new Error('Invalid attachment create result: expected id number');
}

/**
 * API 2 — Post message with attachment_ids (use after createProofAttachment).
 */
export async function postProofToChatter(saleOrderId, attachmentIds = [], body = 'Payment proof uploaded.') {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');
  const ids = Array.isArray(attachmentIds) ? attachmentIds : [attachmentIds];
  const attachment_ids = ids.map((id) => (typeof id === 'number' ? id : parseInt(id, 10))).filter((id) => !Number.isNaN(id));
  const kwargs = {
    body: body || 'Payment proof uploaded.',
    attachment_ids,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
    context: { mail_create_nosubscribe: true },
  };
  await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
}

/**
 * Upload one proof image and post it to the sale order chatter (legacy: create attachment then post).
 * Prefer postPaymentProofToChatter for new code (single message_post with attachments).
 * @param {number} saleOrderId - Odoo sale.order id
 * @param {string} base64Data - Image base64 (no data URL prefix)
 * @param {string} [filename] - Optional filename
 */
export async function uploadProofAndPostToChatter(saleOrderId, base64Data, filename = 'payment_proof.jpg') {
  const normalized = normalizeBase64ForUpload(base64Data);
  if (!normalized) throw new Error('Invalid or too short base64 for payment proof');
  const attachmentId = await createProofAttachment(saleOrderId, normalized, filename);
  await postProofToChatter(saleOrderId, [attachmentId]);
  return attachmentId;
}

/**
 * Attachment proof API: convert captured image to base64, create ir.attachment, then post message to chatter.
 * Use this so the sale order chatter always shows the captured image (not just text).
 *
 * Flow:
 * 1) Convert image to base64 (if file path/URI is passed, read and normalize).
 * 2) Call ir.attachment create with name, type: "binary", datas: base64, res_model: "sale.order", res_id, mimetype.
 * 3) Call sale.order message_post with body and attachment_ids: [attachment_id].
 *
 * @param {number} saleOrderId - Odoo sale.order id (e.g. 206)
 * @param {object} imageSource - Either:
 *   - { base64: string } or { base64: string, filename?: string } for raw base64 (or data URL)
 *   - { fileSystem: object, filePath: string } for local file (e.g. expo-file-system + URI); filename derived from path
 * @param {object} [options] - { body?: string, filename?: string }
 * @returns {Promise<{ attachmentId: number }>} The created attachment id (message is already posted)
 */
export async function uploadPaymentProofWithCapturedImage(saleOrderId, imageSource, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for proof attachment');

  let base64 = null;
  let filename = options.filename || 'payment_proof.jpg';

  if (imageSource?.base64 != null) {
    base64 = normalizeBase64ForUpload(imageSource.base64);
    if (imageSource.filename) filename = imageSource.filename;
  } else if (imageSource?.fileSystem && imageSource?.filePath) {
    base64 = await imageFileToBase64String(imageSource.fileSystem, imageSource.filePath);
    const ext = (imageSource.filePath.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    if (!filename.includes('.')) filename = `payment_proof.${ext}`;
  }

  if (!base64 || base64.length < MIN_BASE64_LENGTH) {
    throw new Error('Invalid or missing image: provide base64 or fileSystem+filePath and ensure image is valid');
  }

  // Step 1: create ir.attachment (Odoo returns attachment id, e.g. 1305)
  const attachmentId = await createProofAttachment(resId, base64, filename);

  // Step 2: post message to chatter with attachment_ids so the image appears in chat
  const body = (options.body && String(options.body).trim()) || 'Payment proof uploaded.';
  await postProofToChatter(resId, [attachmentId], body);

  return { attachmentId };
}

/**
 * Upload multiple captured images: create one ir.attachment per image, then post a single chatter message with all attachment_ids.
 * Use when user captures multiple proof photos (e.g. cheque + receipt).
 *
 * @param {number} saleOrderId - Odoo sale.order id
 * @param {Array<{ base64?: string, filename?: string } | { fileSystem: object, filePath: string }>} imageSources - Array of image sources (base64 or file path)
 * @param {object} [options] - { body?: string }
 * @returns {Promise<{ attachmentIds: number[] }>}
 */
export async function uploadPaymentProofWithCapturedImages(saleOrderId, imageSources, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for proof attachment');
  const sources = Array.isArray(imageSources) ? imageSources : [];
  const attachmentIds = [];

  for (let i = 0; i < sources.length; i++) {
    const imageSource = sources[i];
    let base64 = null;
    let filename = `payment_proof_${i + 1}.jpg`;
    if (imageSource?.base64 != null) {
      base64 = normalizeBase64ForUpload(imageSource.base64);
      if (imageSource.filename) filename = imageSource.filename;
    } else if (imageSource?.fileSystem && imageSource?.filePath) {
      base64 = await imageFileToBase64String(imageSource.fileSystem, imageSource.filePath);
      const ext = (imageSource.filePath.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      filename = imageSource.filename || `payment_proof_${i + 1}.${ext}`;
    }
    if (!base64 || base64.length < MIN_BASE64_LENGTH) continue;
    try {
      const aid = await createProofAttachment(resId, base64, filename);
      attachmentIds.push(aid);
    } catch (err) {
      console.warn('uploadPaymentProofWithCapturedImages: create attachment', i, err?.message ?? err);
    }
  }

  if (attachmentIds.length === 0) {
    throw new Error('No valid proof images: provide base64 or fileSystem+filePath for at least one image');
  }

  const body = (options.body && String(options.body).trim()) || 'Payment proof uploaded.';
  await postProofToChatter(resId, attachmentIds, body);
  return { attachmentIds };
}

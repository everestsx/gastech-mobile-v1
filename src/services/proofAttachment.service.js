/**
 * Customer payment proof: post to Sale Order chatter (body + attachments as base64).
 * Cheque: bank name and cheque number go in body; proof images as attachments.
 * Single message_post call for offline sync (one JSON, then retry whole if fail).
 */
import { callOdooArgs, callOdooArgsKwargs } from './index.service';

const MIMETYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const MIN_BASE64_LENGTH = 100;

/**
 * Validate and normalize base64 for Odoo (exact doc spec: single line, no spaces, no line breaks).
 * Prevents 0KB and corrupted attachments.
 * @param {string} base64 - Raw base64 string
 * @returns {string|null} Normalized base64 or null if invalid
 */
export function normalizeBase64ForUpload(base64) {
  if (base64 == null || typeof base64 !== 'string') return null;
  const singleLine = base64.replace(/\s/g, '').trim();
  if (singleLine.length < MIN_BASE64_LENGTH) return null;
  return singleLine;
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
 * Post a single message to Sale Order chatter with body and attachment_ids (Odoo ir.attachment ids).
 * Use this when you have already created ir.attachment records so images show correctly in chatter.
 * @param {number} saleOrderId - Odoo sale.order id (integer)
 * @param {object} options
 * @param {string} [options.body] - Message body
 * @param {number[]} [options.attachmentIds] - List of ir.attachment ids from createProofAttachment
 */
export async function postPaymentProofToChatterWithAttachmentIds(saleOrderId, options = {}) {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');

  const body = (options.body && String(options.body).trim()) || 'Payment proof attached.';
  const ids = (options.attachmentIds || []).map((id) => (typeof id === 'number' ? id : parseInt(id, 10))).filter((id) => !Number.isNaN(id));

  const kwargs = {
    body,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_comment',
  };
  if (ids.length > 0) kwargs.attachment_ids = ids;

  await callOdooArgsKwargs('sale.order', 'message_post', [resId], kwargs);
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
 * Create ir.attachment on sale.order (image as base64).
 * res_model/res_id must match the Sales Order so the attachment appears in that order's chatter.
 * @param {number} saleOrderId - Odoo sale.order id (integer)
 * @param {string} base64Data - Image content (base64 string, without data URL prefix)
 * @param {string} [filename] - e.g. 'payment_proof.jpg'
 * @returns {Promise<number>} Attachment id (use this in message_post attachment_ids)
 */
export async function createProofAttachment(saleOrderId, base64Data, filename = 'payment_proof.jpg') {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for proof attachment');
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const mimetype = MIMETYPES[ext] || 'image/jpeg';
  const attachmentId = await callOdooArgs('ir.attachment', 'create', [
    {
      name: filename,
      type: 'binary',
      datas: base64Data,
      res_model: 'sale.order',
      res_id: resId,
      mimetype,
    },
  ]);
  return attachmentId;
}

/**
 * Post a message to Sale Order chatter with optional attachment (proof image).
 * Must be called after create so the attachment appears in the Sales Order chat.
 * @param {number} saleOrderId - Odoo sale.order id (integer)
 * @param {number[]} [attachmentIds] - List of ir.attachment ids (integers) from create
 * @param {string} [body] - Message body (e.g. "Customer payment proof attached")
 */
export async function postProofToChatter(saleOrderId, attachmentIds = [], body = 'Customer payment proof attached') {
  const resId = typeof saleOrderId === 'number' ? saleOrderId : parseInt(saleOrderId, 10);
  if (Number.isNaN(resId)) throw new Error('Invalid sale order id for chatter');
  const ids = Array.isArray(attachmentIds) ? attachmentIds : [attachmentIds];
  const attachment_ids = ids.map((id) => (typeof id === 'number' ? id : parseInt(id, 10))).filter((id) => !Number.isNaN(id));
  await callOdooArgsKwargs(
    'sale.order',
    'message_post',
    [[resId]],
    {
      body: body || 'Customer payment proof attached',
      attachment_ids,
    }
  );
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

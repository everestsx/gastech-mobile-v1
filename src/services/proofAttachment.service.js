/**
 * Customer payment proof: upload image as ir.attachment and post to Sale Order chatter.
 * Used when user takes evidence photos (e.g. for Check or Credit); photos appear in Odoo SO chatter.
 */
import { callOdooArgs, callOdooArgsKwargs } from './index.service';

const MIMETYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

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
 * Upload one proof image and post it to the sale order chatter.
 * @param {number} saleOrderId - Odoo sale.order id
 * @param {string} base64Data - Image base64 (no data URL prefix)
 * @param {string} [filename] - Optional filename
 */
export async function uploadProofAndPostToChatter(saleOrderId, base64Data, filename = 'payment_proof.jpg') {
  const attachmentId = await createProofAttachment(saleOrderId, base64Data, filename);
  await postProofToChatter(saleOrderId, [attachmentId]);
  return attachmentId;
}

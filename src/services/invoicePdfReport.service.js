/**
 * Render posted account.move (invoice) to PDF as base64 for ir.attachment / chatter.
 * Odoo JSON-RPC can return string, [string, 'pdf'], or byte-like arrays depending on version.
 */
import { callOdoo, callOdooArgs } from './index.service.js';

const XMLID_CANDIDATES = [
  'account.report_invoice',
  'account.account_invoices',
  'account.account_invoices_without_payment',
  'account.action_report_invoice',
  'account.action_report_account_invoice', // some versions
  'account.report_invoice_with_payments',
];

let cachedReportIds = null;

/**
 * @param {unknown} rendered
 * @returns {string} non-empty base64 or ''
 */
export function extractPdfBase64FromOdooRender(rendered) {
  if (rendered == null) return '';

  if (typeof rendered === 'string') {
    const t = rendered.trim();
    if (t.length > 200 && /^[A-Za-z0-9+/=_-]/.test(t)) return t;
    return '';
  }

  if (Array.isArray(rendered)) {
    for (const part of rendered) {
      if (typeof part === 'string' && part.length > 200) return part.trim();
    }
    const first = rendered[0];
    if (Array.isArray(first) && first.length && typeof first[0] === 'number') {
      return uint8ToBase64(new Uint8Array(first));
    }
  }

  if (typeof rendered === 'object') {
    if (typeof rendered.pdf === 'string' && rendered.pdf.length > 200) return rendered.pdf.trim();
    if (Array.isArray(rendered.data) && rendered.data.length) {
      const a = rendered.data;
      if (typeof a[0] === 'number') return uint8ToBase64(new Uint8Array(a));
    }
  }
  return '';
}

function uint8ToBase64(u8) {
  if (!u8?.length) return '';
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  try {
    if (typeof btoa === 'function') return btoa(binary);
  } catch (_) {
    /* fall through */
  }
  return '';
}

async function loadQwebReportIdsForAccountMove() {
  if (cachedReportIds) return cachedReportIds;
  try {
    const domain = [
      ['model', '=', 'account.move'],
      ['report_type', '=', 'qweb-pdf'],
    ];
    // callOdoo(model, method, [positional args to search_read], options/kwargs)
    const rows = await callOdoo('ir.actions.report', 'search_read', [domain], {
      fields: ['id', 'name', 'report_name'],
      limit: 40,
    });
    if (!Array.isArray(rows) || !rows.length) {
      cachedReportIds = [];
      return cachedReportIds;
    }
    const withInvoice = rows.filter(
      (r) =>
        String(r?.name || '')
          .toLowerCase()
          .includes('invoice') ||
        String(r?.report_name || '')
          .toLowerCase()
          .includes('invoice')
    );
    const pick = (withInvoice.length ? withInvoice : rows).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    cachedReportIds = [...new Set(pick)];
    return cachedReportIds;
  } catch (_) {
    cachedReportIds = [];
    return cachedReportIds;
  }
}

/**
 * @param {number} invoiceId - account.move id, posted
 * @returns {Promise<string>} base64 PDF or ''
 */
export async function renderPostedInvoicePdfBase64(invoiceId) {
  const invId = Number(invoiceId);
  if (!Number.isFinite(invId) || invId <= 0) return '';

  const tryOneRender = async (firstArg) => {
    try {
      const rendered = await callOdooArgs('ir.actions.report', '_render_qweb_pdf', [firstArg, [invId]]);
      const b64 = extractPdfBase64FromOdooRender(rendered);
      return b64;
    } catch (_) {
      return '';
    }
  };

  for (const rid of await loadQwebReportIdsForAccountMove()) {
    const b64 = await tryOneRender(rid);
    if (b64) return b64;
  }

  for (const xid of XMLID_CANDIDATES) {
    const b64 = await tryOneRender(xid);
    if (b64) return b64;
  }

  return '';
}

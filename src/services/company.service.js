/**
 * Supplier (own company) details for the printed invoice header.
 *
 * The supplier block used to be read live from Odoo at print time, so an offline invoice
 * printed with blank TIN / name / address / telephone. It is now fetched during sync and
 * pre-check and cached in the local `app_cache` table, so printing works without internet.
 *
 * Same Odoo reads that were previously done inline in utils/invoicePartyInfo.js — no new
 * query shape, no write to Odoo.
 */
import { callOdoo } from './index.service';
import { getAppCache, setAppCache, CACHE_KEY_COMPANY_PARTY } from '../database/appCache.js';

const LOG = '[company]';

/** Odoo company used for the invoice header. Unchanged from the previous inline behaviour. */
const INVOICE_COMPANY_ID = 1;

/** Odoo returns `false` for empty char fields. */
function text(v) {
  if (v == null || v === false) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'false') return null;
  return s;
}

/**
 * Read the supplier block from Odoo. Throws on network failure (caller decides what to do).
 * @returns {Promise<{supplierName: string|null, supplierPhone: string|null, supplierTin: string|null, supplierAddress: string|null}>}
 */
export async function fetchCompanyPartyInfoFromOdoo() {
  const companyRows = await callOdoo('res.company', 'read', [[INVOICE_COMPANY_ID]], {
    fields: ['name', 'phone', 'vat', 'partner_id'],
  });
  const company = Array.isArray(companyRows) ? companyRows[0] : null;
  const companyPartnerId = Array.isArray(company?.partner_id) ? company.partner_id[0] : null;

  let companyStreet = '';
  let companyCity = '';
  if (companyPartnerId != null) {
    const companyPartnerRows = await callOdoo('res.partner', 'read', [[companyPartnerId]], {
      fields: ['street', 'street2', 'city'],
    });
    const cp = Array.isArray(companyPartnerRows) ? companyPartnerRows[0] : null;
    companyStreet = [text(cp?.street), text(cp?.street2)].filter(Boolean).join(', ');
    companyCity = text(cp?.city) || '';
  }

  return {
    supplierName: text(company?.name),
    supplierPhone: text(company?.phone),
    supplierTin: text(company?.vat),
    supplierAddress: [companyStreet, companyCity].filter(Boolean).join(', ') || null,
  };
}

/** Cached supplier block from local DB, or null when nothing has been cached yet. */
export async function getCachedCompanyPartyInfo() {
  try {
    const cached = await getAppCache(CACHE_KEY_COMPANY_PARTY);
    if (!cached || typeof cached !== 'object') return null;
    if (!cached.supplierName && !cached.supplierTin && !cached.supplierAddress && !cached.supplierPhone) {
      return null;
    }
    return cached;
  } catch (e) {
    console.warn(`${LOG} read cache failed`, e?.message ?? e);
    return null;
  }
}

/**
 * Fetch the supplier block and store it locally. Best-effort: never throws, so it can be
 * called from sync / pre-check without any risk of breaking those flows.
 * @returns {Promise<boolean>} true when a fresh copy was cached
 */
export async function refreshCompanyPartyInfoCache() {
  try {
    const info = await fetchCompanyPartyInfoFromOdoo();
    // Do not overwrite a good cache with an empty response.
    if (!info?.supplierName && !info?.supplierTin && !info?.supplierAddress && !info?.supplierPhone) {
      console.warn(`${LOG} skip cache write: empty company response`);
      return false;
    }
    await setAppCache(CACHE_KEY_COMPANY_PARTY, info);
    return true;
  } catch (e) {
    console.warn(`${LOG} refresh failed (offline or Odoo error)`, e?.message ?? e);
    return false;
  }
}

/**
 * Cache the supplier block only when it is missing locally. Used by the pre-check flow so a
 * driver starting the day always has the invoice header available offline.
 * @returns {Promise<boolean>} true when the cache is populated after this call
 */
export async function ensureCompanyPartyInfoCached() {
  const cached = await getCachedCompanyPartyInfo();
  if (cached) return true;
  return refreshCompanyPartyInfoCache();
}

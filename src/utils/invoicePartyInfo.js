/**
 * Company + customer fields for invoice print (Odoo res.company / res.partner).
 *
 * Offline-first: the supplier block is read from the local `app_cache` table and the purchaser
 * block from the local `partners` table (both filled during sync / pre-check). Odoo is then
 * consulted only when the device is online, and a successful response still wins and refreshes
 * the local copies. When offline, the local copies are used and no network call is attempted,
 * so printing is neither blank nor delayed by request timeouts.
 */
import { callOdoo } from '../services/index.service';
import { odooLocalizedText } from './customerDisplayName';
import { getCachedCompanyPartyInfo } from '../services/company.service';
import * as partnersDb from '../database/partners.js';

/** Drop null/undefined/'' so a merge never overwrites a good value with an empty one. */
function definedOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

function partnerIdOf(order) {
  return Array.isArray(order?.partner_id) ? order.partner_id[0] : null;
}

/** Supplier + purchaser blocks from local DB only. Never throws. */
async function readLocalPartyInfo(order) {
  const local = {};
  try {
    const company = await getCachedCompanyPartyInfo();
    if (company) {
      local.supplierName = company.supplierName || null;
      local.supplierPhone = company.supplierPhone || null;
      local.supplierTin = company.supplierTin || null;
      local.supplierAddress = company.supplierAddress || null;
    }
  } catch (_) {
    /* supplier stays unset */
  }
  try {
    const customerPartnerId = partnerIdOf(order);
    if (customerPartnerId != null) {
      const p = await partnersDb.getPartnerInvoiceFields(customerPartnerId);
      if (p) {
        local.customerName = p.name || null;
        local.customerNameTamil = odooLocalizedText(p.name_tamil);
        local.customerNameSinhala = odooLocalizedText(p.name_sinhala);
        local.customerPhone = p.phone || null;
        local.customerTin = p.vat || null;
        local.customerStreet = [p.street, p.street2].filter(Boolean).join(', ') || null;
        local.customerCity = p.city || null;
      }
    }
  } catch (_) {
    /* purchaser stays unset */
  }
  return definedOnly(local);
}

/** True when the device has no usable connection (best-effort; assumes online if unknown). */
async function isDeviceOffline() {
  try {
    const { getLastNetworkQuality, NetworkQuality } = await import(
      '../services/networkStatus.service.js'
    );
    return getLastNetworkQuality() === NetworkQuality.OFFLINE;
  } catch (_) {
    return false;
  }
}

/**
 * Keep the freshly fetched purchaser values available offline next time.
 * Uses a targeted UPDATE (never INSERT OR REPLACE) so no synced column is blanked out.
 */
async function persistFetchedCustomer(order, customer) {
  try {
    const customerPartnerId = partnerIdOf(order);
    if (customerPartnerId == null || !customer) return;
    await partnersDb.updatePartnerInvoiceFields(customerPartnerId, {
      vat: customer.vat,
      street: customer.street,
      street2: customer.street2,
      city: customer.city,
      phone: customer.phone,
    });
  } catch (_) {
    /* caching is best-effort — must never break printing */
  }
}

/**
 * @param {object|null|undefined} order - Local sale order row (needs partner_id)
 * @returns {Promise<object>} partyInfo for buildInvoiceHtml
 */
export async function fetchInvoicePartyInfo(order) {
  // 1. Always start from what the device already has, so an offline print is never blank.
  const localPartyInfo = await readLocalPartyInfo(order);

  // 2. Skip the network entirely when offline (avoids three 35s callOdoo timeouts before printing).
  if (await isDeviceOffline()) {
    return localPartyInfo;
  }

  // 3. Online: refresh from Odoo. A successful read still wins, exactly as before.
  let nextPartyInfo = {};
  try {
    const companyRows = await callOdoo('res.company', 'read', [[1]], {
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
      companyStreet = [cp?.street, cp?.street2].filter(Boolean).join(', ');
      companyCity = cp?.city || '';
    }

    const customerPartnerId = partnerIdOf(order);
    let customerRows = [];
    if (customerPartnerId != null) {
      customerRows = await callOdoo('res.partner', 'read', [[customerPartnerId]], {
        fields: ['name', 'phone', 'street', 'street2', 'city', 'vat', 'name_tamil', 'name_sinhala'],
      });
    }
    const customer = Array.isArray(customerRows) ? customerRows[0] : null;

    nextPartyInfo = {
      supplierName: company?.name || null,
      supplierPhone: company?.phone || null,
      supplierTin: company?.vat || null,
      supplierAddress: [companyStreet, companyCity].filter(Boolean).join(', ') || null,
      customerName: customer?.name || null,
      customerNameTamil: odooLocalizedText(customer?.name_tamil),
      customerNameSinhala: odooLocalizedText(customer?.name_sinhala),
      customerPhone: customer?.phone || null,
      customerTin: customer?.vat || null,
      customerStreet: [customer?.street, customer?.street2].filter(Boolean).join(', ') || null,
      customerCity: customer?.city || null,
    };

    // Write through so the next print works offline.
    void persistFetchedCustomer(order, customer);
  } catch (e) {
    // Network/Odoo failure: fall back to the local copies instead of printing a blank header.
    console.warn('[invoiceParty] Odoo read failed, using local cache', e?.message ?? e);
    return localPartyInfo;
  }

  // 4. Merge: fresh Odoo values win, local fills any gap the server left empty.
  return { ...localPartyInfo, ...definedOnly(nextPartyInfo) };
}

export function partyInfoReadyForPrint(partyInfo) {
  if (!partyInfo || typeof partyInfo !== 'object') return false;
  return !!(
    partyInfo.supplierName ||
    partyInfo.supplierAddress ||
    partyInfo.supplierTin ||
    partyInfo.customerStreet ||
    partyInfo.customerTin
  );
}

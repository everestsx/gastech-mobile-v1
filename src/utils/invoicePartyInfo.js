/**
 * Company + customer fields for invoice print (Odoo res.company / res.partner).
 * Fetched separately from local SQLite order rows (street/TIN often missing locally).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdoo } from '../services/index.service';
import { odooLocalizedText } from './customerDisplayName';

const COMPANY_CACHE_KEY = '@gastech_invoice_company_party_v1';
const CUSTOMER_CACHE_PREFIX = '@gastech_invoice_customer_party_v1:';

function cleanText(value) {
  const s = value == null ? '' : String(value).trim();
  return s.length > 0 ? s : null;
}

function buildAddress(street, street2, city) {
  const streetJoined = [cleanText(street), cleanText(street2)].filter(Boolean).join(', ');
  return [streetJoined, cleanText(city)].filter(Boolean).join(', ') || null;
}

async function readCachedObject(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function writeCachedObject(key, value) {
  try {
    if (!value || typeof value !== 'object') return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...value, _cachedAt: Date.now() }));
  } catch (_) {
    // non-fatal cache failure
  }
}

function pickBest(...values) {
  for (const v of values) {
    const c = cleanText(v);
    if (c) return c;
  }
  return null;
}

function normalizePartyInfo(raw = {}) {
  return {
    supplierName: cleanText(raw.supplierName),
    supplierPhone: cleanText(raw.supplierPhone),
    supplierTin: cleanText(raw.supplierTin),
    supplierAddress: cleanText(raw.supplierAddress),
    customerName: cleanText(raw.customerName),
    customerNameTamil: cleanText(raw.customerNameTamil),
    customerNameSinhala: cleanText(raw.customerNameSinhala),
    customerPhone: cleanText(raw.customerPhone),
    customerTin: cleanText(raw.customerTin),
    customerStreet: cleanText(raw.customerStreet),
    customerCity: cleanText(raw.customerCity),
  };
}

function hasAnySupplierData(partyInfo) {
  return !!(partyInfo?.supplierName || partyInfo?.supplierPhone || partyInfo?.supplierTin || partyInfo?.supplierAddress);
}

function hasAnyCustomerData(partyInfo) {
  return !!(
    partyInfo?.customerName ||
    partyInfo?.customerPhone ||
    partyInfo?.customerTin ||
    partyInfo?.customerStreet ||
    partyInfo?.customerCity
  );
}

/**
 * @param {object|null|undefined} order - Local sale order row (needs partner_id)
 * @returns {Promise<object>} partyInfo for buildInvoiceHtml
 */
export async function fetchInvoicePartyInfo(order) {
  const customerPartnerId = Array.isArray(order?.partner_id)
    ? Number(order.partner_id[0])
    : Number(order?.partner_id);
  const hasCustomerPartnerId = Number.isFinite(customerPartnerId) && customerPartnerId > 0;
  const customerCacheKey = hasCustomerPartnerId
    ? `${CUSTOMER_CACHE_PREFIX}${customerPartnerId}`
    : null;

  const [cachedCompanyRaw, cachedCustomerRaw] = await Promise.all([
    readCachedObject(COMPANY_CACHE_KEY),
    customerCacheKey ? readCachedObject(customerCacheKey) : Promise.resolve(null),
  ]);

  const cachedCompany = normalizePartyInfo(cachedCompanyRaw || {});
  const cachedCustomer = normalizePartyInfo(cachedCustomerRaw || {});

  const localFallback = normalizePartyInfo({
    customerName: Array.isArray(order?.partner_id) ? order.partner_id[1] : order?.partner_name,
    customerPhone: order?.partner_phone,
    customerStreet: order?.partner_street || order?.street || order?.partner_address,
    customerCity: order?.partner_city || order?.city,
  });

  let liveCompany = null;
  let liveCustomer = null;

  try {
    let company = null;
    try {
      const rows = await callOdoo('res.company', 'search_read', [[['id', '>', 0]]], {
        fields: ['id', 'name', 'phone', 'vat', 'partner_id'],
        limit: 1,
      });
      company = Array.isArray(rows) ? rows[0] : null;
    } catch (_) {
      // Fallback for older/custom servers where search_read access differs.
      const rows = await callOdoo('res.company', 'read', [[1]], {
        fields: ['name', 'phone', 'vat', 'partner_id'],
      });
      company = Array.isArray(rows) ? rows[0] : null;
    }

    const companyPartnerId = Array.isArray(company?.partner_id) ? company.partner_id[0] : null;
    let companyAddress = null;
    if (companyPartnerId != null) {
      try {
        const partnerRows = await callOdoo('res.partner', 'read', [[companyPartnerId]], {
          fields: ['street', 'street2', 'city'],
        });
        const cp = Array.isArray(partnerRows) ? partnerRows[0] : null;
        companyAddress = buildAddress(cp?.street, cp?.street2, cp?.city);
      } catch (_) {
        companyAddress = null;
      }
    }
    liveCompany = normalizePartyInfo({
      supplierName: company?.name,
      supplierPhone: company?.phone,
      supplierTin: company?.vat,
      supplierAddress: companyAddress,
    });

    if (hasCustomerPartnerId) {
      const customerRows = await callOdoo('res.partner', 'read', [[customerPartnerId]], {
        fields: ['name', 'phone', 'street', 'street2', 'city', 'vat', 'name_tamil', 'name_sinhala'],
      });
      const customer = Array.isArray(customerRows) ? customerRows[0] : null;
      liveCustomer = normalizePartyInfo({
        customerName: customer?.name,
        customerNameTamil: odooLocalizedText(customer?.name_tamil),
        customerNameSinhala: odooLocalizedText(customer?.name_sinhala),
        customerPhone: customer?.phone,
        customerTin: customer?.vat,
        customerStreet: buildAddress(customer?.street, customer?.street2, null),
        customerCity: customer?.city,
      });
    }
  } catch (_) {
    // Keep going with cache/local fallback.
  }

  const merged = normalizePartyInfo({
    supplierName: pickBest(liveCompany?.supplierName, cachedCompany?.supplierName, 'GasTech'),
    supplierPhone: pickBest(liveCompany?.supplierPhone, cachedCompany?.supplierPhone),
    supplierTin: pickBest(liveCompany?.supplierTin, cachedCompany?.supplierTin),
    supplierAddress: pickBest(liveCompany?.supplierAddress, cachedCompany?.supplierAddress),
    customerName: pickBest(liveCustomer?.customerName, cachedCustomer?.customerName, localFallback?.customerName),
    customerNameTamil: pickBest(liveCustomer?.customerNameTamil, cachedCustomer?.customerNameTamil),
    customerNameSinhala: pickBest(liveCustomer?.customerNameSinhala, cachedCustomer?.customerNameSinhala),
    customerPhone: pickBest(liveCustomer?.customerPhone, cachedCustomer?.customerPhone, localFallback?.customerPhone),
    customerTin: pickBest(liveCustomer?.customerTin, cachedCustomer?.customerTin),
    customerStreet: pickBest(liveCustomer?.customerStreet, cachedCustomer?.customerStreet, localFallback?.customerStreet),
    customerCity: pickBest(liveCustomer?.customerCity, cachedCustomer?.customerCity, localFallback?.customerCity),
  });

  if (hasAnySupplierData(liveCompany)) {
    void writeCachedObject(COMPANY_CACHE_KEY, liveCompany);
  }
  if (customerCacheKey && hasAnyCustomerData(liveCustomer)) {
    void writeCachedObject(customerCacheKey, liveCustomer);
  }

  return merged;
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

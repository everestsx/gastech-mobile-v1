/**
 * Company + customer fields for invoice print (Odoo res.company / res.partner).
 * Fetched separately from local SQLite order rows (street/TIN often missing locally).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdoo } from '../services/index.service';
import { odooLocalizedText } from './customerDisplayName';

const COMPANY_CACHE_KEY = '@gastech_invoice_company_party_v1';
const CUSTOMER_CACHE_PREFIX = '@gastech_invoice_customer_party_v1:';
const PRELOAD_RETRY_DELAYS_MS = [0, 400, 900, 1600, 2600];

function cleanText(value) {
  const s = value == null ? '' : String(value).trim();
  if (!s) return null;
  const lowered = s.toLowerCase();
  if (lowered === 'false' || lowered === 'null' || lowered === 'undefined' || lowered === 'nan') {
    return null;
  }
  return s;
}

function cleanAddressText(value) {
  const s = cleanText(value);
  if (!s) return null;
  const parts = String(s)
    .split(',')
    .map((p) => cleanText(p))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizePartyInfo(raw = {}) {
  return {
    supplierName: cleanText(raw.supplierName),
    supplierPhone: cleanText(raw.supplierPhone),
    supplierTin: cleanText(raw.supplierTin),
    supplierAddress: cleanAddressText(raw.supplierAddress),
    customerName: cleanText(raw.customerName),
    customerNameTamil: cleanText(raw.customerNameTamil),
    customerNameSinhala: cleanText(raw.customerNameSinhala),
    customerPhone: cleanText(raw.customerPhone),
    customerTin: cleanText(raw.customerTin),
    customerStreet: cleanAddressText(raw.customerStreet),
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

async function fetchLiveCompanyPartyInfo() {
  let company = null;
  try {
    const rows = await callOdoo('res.company', 'search_read', [[['id', '>', 0]]], {
      fields: ['id', 'name', 'phone', 'vat', 'partner_id'],
      limit: 1,
    });
    company = Array.isArray(rows) ? rows[0] : null;
  } catch (_) {
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

  return normalizePartyInfo({
    supplierName: company?.name,
    supplierPhone: company?.phone,
    supplierTin: company?.vat,
    supplierAddress: companyAddress,
  });
}

export async function cacheInvoicePartyInfoFromSyncRows({
  orders = [],
  customers = [],
  fetchCompanyIfMissing = true,
} = {}) {
  const orderList = Array.isArray(orders) ? orders : [];
  const customerList = Array.isArray(customers) ? customers : [];
  const partnerIdsFromOrders = new Set(
    orderList
      .map((o) => (Array.isArray(o?.partner_id) ? Number(o.partner_id[0]) : Number(o?.partner_id)))
      .filter((id) => Number.isFinite(id) && id > 0)
  );

  const customerById = new Map();
  for (const c of customerList) {
    const id = Number(c?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    customerById.set(id, c);
  }

  for (const partnerId of partnerIdsFromOrders) {
    const customer = customerById.get(partnerId);
    if (!customer) continue;
    const normalized = normalizePartyInfo({
      customerName: customer?.name,
      customerNameTamil: odooLocalizedText(customer?.name_tamil),
      customerNameSinhala: odooLocalizedText(customer?.name_sinhala),
      customerPhone: customer?.phone,
      customerTin: customer?.vat,
      customerStreet: buildAddress(customer?.street, customer?.street2, null),
      customerCity: customer?.city,
    });
    if (!hasAnyCustomerData(normalized)) continue;
    await writeCachedObject(`${CUSTOMER_CACHE_PREFIX}${partnerId}`, normalized);
  }

  if (fetchCompanyIfMissing) {
    const cachedCompany = await readCachedObject(COMPANY_CACHE_KEY);
    const hasCachedCompany = hasAnySupplierData(normalizePartyInfo(cachedCompany || {}));
    if (!hasCachedCompany) {
      try {
        const liveCompany = await fetchLiveCompanyPartyInfo();
        if (hasAnySupplierData(liveCompany)) {
          await writeCachedObject(COMPANY_CACHE_KEY, liveCompany);
        }
      } catch (_) {
        // non-fatal cache warmup failure
      }
    }
  }
}

export async function getPreCheckPartyDetailsForOrders(orders = [], maxCustomers = 10) {
  const list = Array.isArray(orders) ? orders : [];
  const partnerIds = Array.from(
    new Set(
      list
        .map((o) => {
          const raw = Array.isArray(o?.partner_id) ? o.partner_id[0] : o?.partner_id;
          const id = Number(raw);
          return Number.isFinite(id) && id > 0 ? id : null;
        })
        .filter(Boolean)
    )
  );
  const companyRaw = await readCachedObject(COMPANY_CACHE_KEY);
  const supplier = normalizePartyInfo(companyRaw || {});
  const customers = [];
  for (const id of partnerIds.slice(0, Math.max(1, Number(maxCustomers) || 10))) {
    const cache = await readCachedObject(`${CUSTOMER_CACHE_PREFIX}${id}`);
    const normalized = normalizePartyInfo(cache || {});
    customers.push({
      partnerId: id,
      customerName: pickBest(normalized.customerName),
      customerPhone: pickBest(normalized.customerPhone),
      customerTin: pickBest(normalized.customerTin),
      customerStreet: pickBest(normalized.customerStreet),
      customerCity: pickBest(normalized.customerCity),
      ready: hasAnyCustomerData(normalized),
    });
  }
  return {
    supplier: {
      supplierName: pickBest(supplier.supplierName),
      supplierPhone: pickBest(supplier.supplierPhone),
      supplierTin: pickBest(supplier.supplierTin),
      supplierAddress: pickBest(supplier.supplierAddress),
      ready: hasAnySupplierData(supplier),
    },
    customers,
    totalCustomerPartners: partnerIds.length,
  };
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

  const cachedOnly = normalizePartyInfo({
    supplierName: pickBest(cachedCompany?.supplierName, 'GasTech'),
    supplierPhone: pickBest(cachedCompany?.supplierPhone),
    supplierTin: pickBest(cachedCompany?.supplierTin),
    supplierAddress: pickBest(cachedCompany?.supplierAddress),
    customerName: pickBest(cachedCustomer?.customerName, localFallback?.customerName),
    customerNameTamil: pickBest(cachedCustomer?.customerNameTamil),
    customerNameSinhala: pickBest(cachedCustomer?.customerNameSinhala),
    customerPhone: pickBest(cachedCustomer?.customerPhone, localFallback?.customerPhone),
    customerTin: pickBest(cachedCustomer?.customerTin),
    customerStreet: pickBest(cachedCustomer?.customerStreet, localFallback?.customerStreet),
    customerCity: pickBest(cachedCustomer?.customerCity, localFallback?.customerCity),
  });

  let allowLiveFetch = true;
  try {
    const { isUploadSyncNetworkAvailable } = await import('../services/networkStatus.service.js');
    allowLiveFetch = isUploadSyncNetworkAvailable();
  } catch (_) {
    allowLiveFetch = true;
  }

  if (!allowLiveFetch && hasAnySupplierData(cachedOnly) && hasAnyCustomerData(cachedOnly)) {
    return cachedOnly;
  }

  let liveCompany = null;
  let liveCustomer = null;

  try {
    liveCompany = await fetchLiveCompanyPartyInfo();

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

/**
 * Warm AsyncStorage cache for invoice print before first print attempt.
 * Intended for Start-Day pre-check: company details + today's customer partner details.
 */
export async function preloadInvoicePartyInfoForOrders(orders = [], options = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const retryDelays = Array.isArray(options?.retryDelaysMs) && options.retryDelaysMs.length > 0
    ? options.retryDelaysMs
    : PRELOAD_RETRY_DELAYS_MS;
  const maxPartnerIds = Number(options?.maxPartnerIds) || 0;
  const partnerIds = Array.from(
    new Set(
      list
        .map((o) => {
          const raw = Array.isArray(o?.partner_id) ? o.partner_id[0] : o?.partner_id;
          const id = Number(raw);
          return Number.isFinite(id) && id > 0 ? id : null;
        })
        .filter(Boolean)
    )
  );
  const partnerIdsScoped =
    maxPartnerIds > 0 ? partnerIds.slice(0, Math.max(1, Math.floor(maxPartnerIds))) : partnerIds;
  let companyCached = false;
  let customerCachedCount = 0;
  const cachedCustomerIds = new Set();
  let lastErrorMessage = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(retryDelays[attempt]);
    }

    try {
      if (!companyCached) {
        const normalizedCompany = await fetchLiveCompanyPartyInfo();
        if (hasAnySupplierData(normalizedCompany)) {
          await writeCachedObject(COMPANY_CACHE_KEY, normalizedCompany);
          companyCached = true;
        }
      }
    } catch (e) {
      lastErrorMessage = e?.message || lastErrorMessage;
    }

    const missingPartnerIds = partnerIdsScoped.filter((id) => !cachedCustomerIds.has(id));
    if (missingPartnerIds.length > 0) {
      try {
        const chunkSize = 120;
        for (let i = 0; i < missingPartnerIds.length; i += chunkSize) {
          const chunk = missingPartnerIds.slice(i, i + chunkSize);
          const rows = await callOdoo('res.partner', 'search_read', [[['id', 'in', chunk]]], {
            fields: ['id', 'name', 'phone', 'street', 'street2', 'city', 'vat', 'name_tamil', 'name_sinhala'],
            limit: Math.max(chunk.length, 1),
          });
          for (const customer of Array.isArray(rows) ? rows : []) {
            const id = Number(customer?.id);
            if (!Number.isFinite(id) || id <= 0) continue;
            const normalized = normalizePartyInfo({
              customerName: customer?.name,
              customerNameTamil: odooLocalizedText(customer?.name_tamil),
              customerNameSinhala: odooLocalizedText(customer?.name_sinhala),
              customerPhone: customer?.phone,
              customerTin: customer?.vat,
              customerStreet: buildAddress(customer?.street, customer?.street2, null),
              customerCity: customer?.city,
            });
            if (!hasAnyCustomerData(normalized)) continue;
            await writeCachedObject(`${CUSTOMER_CACHE_PREFIX}${id}`, normalized);
            if (!cachedCustomerIds.has(id)) {
              cachedCustomerIds.add(id);
              customerCachedCount += 1;
            }
          }
        }
      } catch (e) {
        lastErrorMessage = e?.message || lastErrorMessage;
      }
    }

    if (companyCached && cachedCustomerIds.size >= partnerIdsScoped.length) {
      break;
    }
  }

  return {
    companyCached,
    customerCachedCount,
    customerFailedCount: Math.max(0, partnerIdsScoped.length - cachedCustomerIds.size),
    error: !companyCached || cachedCustomerIds.size < partnerIdsScoped.length ? lastErrorMessage : null,
  };
}

export function partyInfoReadyForPrint(partyInfo) {
  if (!partyInfo || typeof partyInfo !== 'object') return false;
  const hasSupplierCore =
    !!cleanText(partyInfo.supplierName) &&
    !!cleanText(partyInfo.supplierAddress) &&
    !!cleanText(partyInfo.supplierTin);
  const hasCustomerCore =
    !!cleanText(partyInfo.customerName) ||
    !!cleanText(partyInfo.customerStreet) ||
    !!cleanText(partyInfo.customerCity) ||
    !!cleanText(partyInfo.customerPhone) ||
    !!cleanText(partyInfo.customerTin);
  return hasSupplierCore && hasCustomerCore;
}

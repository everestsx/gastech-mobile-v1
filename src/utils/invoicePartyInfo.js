/**
 * Company + customer fields for invoice print (Odoo res.company / res.partner).
 * Fetched separately from local SQLite order rows (street/TIN often missing locally).
 */
import { callOdoo } from '../services/index.service';
import { odooLocalizedText } from './customerDisplayName';

/**
 * @param {object|null|undefined} order - Local sale order row (needs partner_id)
 * @returns {Promise<object>} partyInfo for buildInvoiceHtml
 */
export async function fetchInvoicePartyInfo(order) {
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

    const customerPartnerId = Array.isArray(order?.partner_id) ? order.partner_id[0] : null;
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
  } catch (_) {
    nextPartyInfo = {};
  }
  return nextPartyInfo;
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

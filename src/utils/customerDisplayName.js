/**
 * Localized customer / partner display names from Odoo fields:
 * name, name_tamil, name_sinhala (empty values are often `false`).
 */

/** @typedef {'en' | 'ta' | 'si'} AppLanguage */

/** Odoo often returns `false` for empty char fields. */
export function odooLocalizedText(v) {
  if (v == null || v === false) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'false') return null;
  return s;
}

function isUsableLocalizedName(v) {
  if (v == null || v === false) return false;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'false') return false;
  return true;
}

/**
 * @param {{ name?: string, name_tamil?: string | false, name_sinhala?: string | false } | null | undefined} partnerLike
 * @param {AppLanguage | string} [lang]
 */
export function getLocalizedCustomerName(partnerLike, lang = 'en') {
  const fallback =
    partnerLike?.name ??
    partnerLike?.partner_name ??
    (Array.isArray(partnerLike?.partner_id) ? partnerLike.partner_id[1] : null) ??
    '';
  const baseName = isUsableLocalizedName(fallback) ? String(fallback).trim() : '—';

  if (lang === 'ta') {
    const t = partnerLike?.name_tamil;
    if (isUsableLocalizedName(t)) return String(t).trim();
    return baseName;
  }
  if (lang === 'si') {
    const s = partnerLike?.name_sinhala;
    if (isUsableLocalizedName(s)) return String(s).trim();
    return baseName;
  }
  return baseName;
}

/**
 * Order rows from SQLite may carry `partner_name_tamil` / `partner_name_sinhala` from a partners JOIN.
 * Party info from Odoo read may carry `customerNameTamil` / `customerNameSinhala`.
 */
export function resolveInvoiceCustomerDisplayName(order, partyInfo, lang = 'en') {
  const fromParty = {
    name: partyInfo?.customerName,
    name_tamil: partyInfo?.customerNameTamil,
    name_sinhala: partyInfo?.customerNameSinhala,
  };
  const fromOrder = {
    name: order?.partner_id?.[1] ?? order?.partner_name,
    name_tamil: order?.partner_name_tamil,
    name_sinhala: order?.partner_name_sinhala,
  };
  const merged = {
    name: fromParty.name || fromOrder.name,
    name_tamil: fromParty.name_tamil ?? fromOrder.name_tamil,
    name_sinhala: fromParty.name_sinhala ?? fromOrder.name_sinhala,
  };
  return getLocalizedCustomerName(merged, lang);
}

/**
 * @param {object} order - Sale order object from list/detail (with optional partner_name_tamil / partner_name_sinhala).
 * @param {AppLanguage | string} [lang]
 */
export function getLocalizedCustomerNameFromOrder(order, lang = 'en') {
  return getLocalizedCustomerName(
    {
      name: order?.partner_id?.[1] ?? order?.partner_name,
      name_tamil: order?.partner_name_tamil,
      name_sinhala: order?.partner_name_sinhala,
    },
    lang
  );
}

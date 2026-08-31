export const CUSTOMER_QR_PREFIX = 'CUSTOMER:';

export function customerQrValue(customer) {
  const id = Number(customer?.id);
  if (!Number.isFinite(id) || id <= 0) return '';
  return `${CUSTOMER_QR_PREFIX}${id}`;
}

function text(value) {
  if (value == null || value === false) return '';
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'false') return '';
  return s;
}

export function customerSearchHaystack(customer) {
  return [
    customer?.id,
    customer?.name,
    customer?.name_tamil,
    customer?.name_sinhala,
    customer?.phone,
    customer?.city,
    customer?.ref,
    ...(Array.isArray(customer?.orderNames) ? customer.orderNames : []),
  ]
    .map((v) => text(v).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

export function filterCustomers(customers, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = Array.isArray(customers) ? customers : [];
  if (!q) return list;
  return list.filter((c) => customerSearchHaystack(c).includes(q));
}

export function customerInitials(name) {
  const parts = text(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return 'C';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
}

/** Gallery filename uses the customer name only. */
export function qrImageFileName(customer) {
  const name = text(customer?.name)
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `${name || 'Customer'}_QR.png`;
}

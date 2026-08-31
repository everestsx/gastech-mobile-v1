import { formatLocalYyyyMmDd } from './localDate';

function partnerIdOf(order) {
  const p = order?.partner_id;
  if (Array.isArray(p)) return Number(p[0]);
  return Number(p);
}

function partnerNameOf(order) {
  const p = order?.partner_id;
  if (Array.isArray(p) && p[1]) return String(p[1]);
  return order?.partner_name ? String(order.partner_name) : '';
}

/**
 * Same date match as the Orders tab: committed delivery date when
 * sync is set to delivery_date, otherwise order create date.
 */
export function orderMatchesOrdersTabDate(order, dateStr, syncDateField) {
  const todayStr = formatLocalYyyyMmDd(new Date());
  const selectedDateValue =
    syncDateField === 'delivery_date'
      ? order?.commitment_date || order?.date_order
      : order?.date_order || order?.commitment_date;
  if (String(selectedDateValue || '').startsWith(dateStr)) return true;
  if (
    syncDateField === 'delivery_date' &&
    dateStr === todayStr &&
    !order?.commitment_date &&
    String(order?.state || '').toLowerCase() !== 'cancel' &&
    String(order?.invoice_status || '').toLowerCase() !== 'invoiced'
  ) {
    return true;
  }
  return false;
}

/**
 * Unique customers from Orders-tab rows for a committed/create date.
 */
export function customersFromOrdersTab(orders, dateStr, syncDateField, partnerLookup = {}) {
  const matched = (Array.isArray(orders) ? orders : []).filter((o) =>
    orderMatchesOrdersTabDate(o, dateStr, syncDateField)
  );
  const byId = new Map();
  for (const order of matched) {
    const id = partnerIdOf(order);
    if (!Number.isFinite(id) || id <= 0) continue;
    const existing = byId.get(id);
    const fromLookup = partnerLookup[id] || partnerLookup[String(id)] || {};
    const orderName = String(order?.name || '').trim();
    if (!existing) {
      byId.set(id, {
        ...fromLookup,
        id,
        name: fromLookup.name || partnerNameOf(order) || `Customer ${id}`,
        name_tamil: fromLookup.name_tamil || order?.partner_name_tamil || null,
        name_sinhala: fromLookup.name_sinhala || order?.partner_name_sinhala || null,
        phone: fromLookup.phone || '',
        city: fromLookup.city || '',
        ref: fromLookup.ref || '',
        orderNames: orderName ? [orderName] : [],
        commitmentDate: dateStr,
      });
    } else if (orderName && !existing.orderNames.includes(orderName)) {
      existing.orderNames.push(orderName);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''))
  );
}

export function indexPartnersById(...lists) {
  const map = {};
  lists.flat().forEach((c) => {
    const id = Number(c?.id);
    if (!Number.isFinite(id) || id <= 0) return;
    map[id] = { ...(map[id] || {}), ...c };
  });
  return map;
}

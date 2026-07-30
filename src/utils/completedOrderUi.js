/** UI-only: instant Orders→Delivered transition before SQLite refresh catches up. */
const uiDeliveredIds = new Set();
const listeners = new Set();

export function markSaleOrderDeliveredInUi(saleOrderId) {
  const id = Number(saleOrderId);
  if (!Number.isFinite(id) || id <= 0) return;
  uiDeliveredIds.add(id);
  for (const fn of listeners) {
    try {
      fn(id);
    } catch (_) {
      /* non-fatal */
    }
  }
}

export function isSaleOrderDeliveredInUi(saleOrderId) {
  const id = Number(saleOrderId);
  return Number.isFinite(id) && id > 0 && uiDeliveredIds.has(id);
}

export function subscribeUiDeliveredOrders(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function mergeUiDeliveredIntoSet(set) {
  const out = set instanceof Set ? new Set(set) : new Set();
  for (const id of uiDeliveredIds) out.add(id);
  return out;
}

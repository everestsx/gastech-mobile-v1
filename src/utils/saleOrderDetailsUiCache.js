/** UI-only cache for instant SaleOrderDetails re-open (does not affect sync). */
const cache = new Map();

export function getSaleOrderDetailsUiCache(saleOrderId) {
  const id = Number(saleOrderId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return cache.get(id) ?? null;
}

export function setSaleOrderDetailsUiCache(saleOrderId, entry) {
  const id = Number(saleOrderId);
  if (!Number.isFinite(id) || id <= 0 || !entry) return;
  cache.set(id, { ...entry, cachedAt: Date.now() });
}

export function clearSaleOrderDetailsUiCache(saleOrderId) {
  const id = Number(saleOrderId);
  if (Number.isFinite(id) && id > 0) cache.delete(id);
}

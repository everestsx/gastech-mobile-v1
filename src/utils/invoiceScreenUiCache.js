/** UI-only cache for instant reopen of completed local invoices (not sync state). */
const cache = new Map();

export function getInvoiceScreenUiCache(saleOrderId) {
  const id = Number(saleOrderId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return cache.get(id) ?? null;
}

export function setInvoiceScreenUiCache(saleOrderId, entry) {
  const id = Number(saleOrderId);
  if (!Number.isFinite(id) || id <= 0 || !entry) return;
  cache.set(id, { ...entry, cachedAt: Date.now() });
}

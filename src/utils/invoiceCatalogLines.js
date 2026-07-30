/**
 * Invoice row table: always include REG / PACK / HOSE (and catalog accessories) at qty 0 when not sold.
 */
import { getAllProductsForInvoice, INVOICE_ACCESSORY_PRODUCT_IDS } from '../database/products.js';

export function isInvoiceAccessoryProduct(productName, productId) {
  const id = Number(productId);
  if (INVOICE_ACCESSORY_PRODUCT_IDS.includes(id)) return true;
  const plain = String(productName || '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    .trim()
    .toLowerCase();
  return plain === 'reg' || plain === 'pack' || plain === 'hose';
}

/** Unit price for invoice UI/print when Odoo line omits price_unit (catalog qty 0, snapshot, etc.). */
export function resolveInvoiceLineUnitPrice(line) {
  const pu = Number(line?.price_unit);
  if (Number.isFinite(pu) && pu > 0) return pu;
  const q = Number(line?.product_uom_qty) || 0;
  const sub = Number(line?.price_subtotal) || 0;
  if (q > 0 && sub > 0) return sub / q;
  const catalog = Number(line?.list_price);
  if (Number.isFinite(catalog) && catalog > 0) return catalog;
  return 0;
}

export function shouldAlwaysShowInvoiceCatalogRow(productName, productId) {
  if (isInvoiceAccessoryProduct(productName, productId)) return true;
  const name = String(productName || '').toLowerCase();
  if (!name) return true;
  if (name.includes('new issue')) return false;
  if (name.includes('empty') && name.includes('cylinder')) return false;
  return true;
}

/**
 * Merge order/snapshot lines with full invoice catalog (accessories always visible).
 * @param {number} saleOrderId
 * @param {object[]} baseLines — order lines and/or snapshot rows
 */
export async function mergeInvoiceLinesWithCatalog(saleOrderId, baseLines = []) {
  const soId = Number(saleOrderId);
  const rawLines = Array.isArray(baseLines) ? baseLines : [];
  try {
    const allProducts = await getAllProductsForInvoice();
    if (!Array.isArray(allProducts) || allProducts.length === 0) return rawLines;

    const priceByProductId = new Map(
      allProducts.map((p) => [Number(p.id), Number(p.list_price) || 0])
    );

    const enrichLineUnitPrice = (line, productId) => {
      const pid = Number(productId);
      const catalogUnit = priceByProductId.get(pid) ?? 0;
      let unit = Number(line?.price_unit) || 0;
      if (unit <= 0 && catalogUnit > 0) unit = catalogUnit;
      const q = Number(line?.product_uom_qty) || 0;
      if (unit <= 0 && q > 0 && Number(line?.price_subtotal) > 0) {
        unit = Number(line.price_subtotal) / q;
      }
      return { ...line, price_unit: unit, list_price: catalogUnit > 0 ? catalogUnit : line?.list_price };
    };

    const byProductId = new Map();
    for (const line of rawLines) {
      const pid = Array.isArray(line?.product_id) ? Number(line.product_id[0]) : Number(line?.product_id);
      if (Number.isFinite(pid) && pid > 0) {
        const enriched = enrichLineUnitPrice(line, pid);
        const existing = byProductId.get(pid);
        if (!existing || String(line?.id || '').startsWith('catalog-') === false) {
          byProductId.set(pid, enriched);
        }
      }
    }

    const catalogRows = allProducts
      .map((p) => {
        const pid = Number(p.id);
        const existing = byProductId.get(pid);
        if (existing) return enrichLineUnitPrice(existing, pid);
        if (!shouldAlwaysShowInvoiceCatalogRow(p?.name, pid)) return null;
        const unit = Number(p.list_price) || 0;
        return {
          id: `catalog-${pid}`,
          order_id: [soId, null],
          product_id: [pid, p.name || '—'],
          name: p.name || '',
          product_uom_qty: 0,
          price_unit: unit,
          price_subtotal: 0,
          price_total: 0,
          qty_delivered: 0,
        };
      })
      .filter(Boolean);

    const catalogProductIds = new Set(
      allProducts.map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0)
    );
    const nonCatalogRows = rawLines.filter((line) => {
      const pid = Array.isArray(line?.product_id) ? Number(line.product_id[0]) : Number(line?.product_id);
      return !(Number.isFinite(pid) && pid > 0 && catalogProductIds.has(pid));
    });

    return [...catalogRows, ...nonCatalogRows];
  } catch (e) {
    console.warn('[invoiceCatalogLines] merge', e?.message ?? e);
    return rawLines;
  }
}

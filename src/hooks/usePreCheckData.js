import { useCallback, useMemo } from 'react';
import { DEFAULT_GAS_CYLINDER_KG_SIZES } from '../utils/defaultGasStock';
import { canonicalKgFromName, isEmptyCylinderName, isGasCylinderName } from '../utils/cylinderCatalog';
import { isInvoiceAccessoryProduct } from '../utils/invoiceCatalogLines';

export function formatPreCheckQty(q) {
  const n = Number(q) || 0;
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

/**
 * Pre Check summary: stock on hand vs today's order demand per product.
 */
export function usePreCheckData({ todayOrders, todayOrderLines, stockCards, emptyStockByKg }) {
  const activeOrdersToday = useMemo(
    () => (todayOrders || []).filter((o) => String(o?.state || '').toLowerCase() !== 'cancel').length,
    [todayOrders]
  );

  const preCheckOrderDemandByProduct = useMemo(() => {
    const orderById = new Map();
    for (const o of todayOrders || []) {
      if (String(o?.state || '').toLowerCase() === 'cancel') continue;
      const id = Number(o.id);
      if (Number.isFinite(id)) orderById.set(id, o);
    }
    const byProduct = new Map();
    for (const line of todayOrderLines || []) {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      if (soId == null || !orderById.has(soId)) continue;
      const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const productId = pidRaw != null ? Number(pidRaw) : null;
      if (productId == null || !Number.isFinite(productId)) continue;
      const qty = Number(line.product_uom_qty) || 0;
      if (qty <= 0) continue;
      const rawLabel = String(line.product_name || line.name || '').trim();
      const label = rawLabel.replace(/^\[[^\]]+\]\s*/, '') || `Product ${productId}`;
      if (!byProduct.has(productId)) {
        byProduct.set(productId, {
          productId,
          label,
          kg: canonicalKgFromName(rawLabel || label),
          totalOrdered: 0,
        });
      }
      byProduct.get(productId).totalOrdered += qty;
    }
    return byProduct;
  }, [todayOrders, todayOrderLines]);

  const preCheckStockRows = useMemo(() => {
    const demandMap = preCheckOrderDemandByProduct;
    const findDemand = (productId, kg) => {
      if (productId != null && demandMap.has(productId)) return demandMap.get(productId);
      if (kg != null && Number.isFinite(kg)) {
        for (const d of demandMap.values()) {
          if (d.kg != null && Math.abs(Number(d.kg) - kg) < 0.051) return d;
        }
      }
      return null;
    };
    const isPreCheckRow = (label, _productId, isGas, isAccessory, isExtra) => {
      if (isEmptyCylinderName(label)) return false;
      return isGas || isAccessory || isExtra;
    };

    const rows = (stockCards || []).map((s) => {
      const label = String(s.product_name || '').replace(/^\[[^\]]+\]\s*/, '').trim() || 'Stock';
      const onHand = Math.max(0, Number(s.total) || 0);
      const productId = s.product_id != null ? Number(s.product_id) : null;
      const kg = s._defaultGasKg != null ? Number(s._defaultGasKg) : canonicalKgFromName(label);
      const isGas = s._defaultGasKg != null || isGasCylinderName(label);
      const isAccessory = isInvoiceAccessoryProduct(label, productId);
      const isExtra = s._isExtraProduct === true;
      const demand = findDemand(productId, kg);
      const totalOrdered = demand?.totalOrdered ?? 0;
      return {
        key: String(s.display_key ?? s.product_id ?? s._defaultGasKg ?? label),
        productId,
        label,
        onHand,
        kg,
        isGas,
        isAccessory,
        isExtra,
        totalOrdered,
        shortfall: Math.max(0, totalOrdered - onHand),
        insufficient: onHand < totalOrdered,
        sortRank: isGas ? 0 : isAccessory ? 1 : 2,
        sortKg: kg ?? 999,
      };
    });

    const usedKeys = new Set(
      rows.map((r) => r.productId).filter((id) => id != null && Number.isFinite(id))
    );
    for (const demand of demandMap.values()) {
      if (demand.totalOrdered <= 0) continue;
      if (usedKeys.has(demand.productId)) continue;
      const label = demand.label || `Product ${demand.productId}`;
      const isGas = isGasCylinderName(label) || demand.kg != null;
      const isAccessory = isInvoiceAccessoryProduct(label, demand.productId);
      if (!isGas && !isAccessory) continue;
      rows.push({
        key: `demand-${demand.productId}`,
        productId: demand.productId,
        label,
        onHand: 0,
        kg: demand.kg,
        isGas,
        isAccessory,
        isExtra: false,
        totalOrdered: demand.totalOrdered,
        shortfall: demand.totalOrdered,
        insufficient: demand.totalOrdered > 0,
        sortRank: isGas ? 0 : 1,
        sortKg: demand.kg ?? 999,
      });
    }

    return rows
      .filter((r) => isPreCheckRow(r.label, r.productId, r.isGas, r.isAccessory, r.isExtra))
      .filter((r) => r.onHand > 0 || r.totalOrdered > 0)
      .sort((a, b) => {
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        if (a.sortKg !== b.sortKg) return a.sortKg - b.sortKg;
        return a.label.localeCompare(b.label, 'en');
      });
  }, [stockCards, preCheckOrderDemandByProduct]);

  const preCheckHasShortfall = useMemo(
    () => preCheckStockRows.some((r) => r.insufficient),
    [preCheckStockRows]
  );

  const preCheckTotalOrderedGas = useMemo(
    () => preCheckStockRows.reduce((sum, r) => sum + (Number(r.totalOrdered) || 0), 0),
    [preCheckStockRows]
  );

  const preCheckEmptyRows = useMemo(
    () =>
      DEFAULT_GAS_CYLINDER_KG_SIZES.map((kg) => ({
        kg: Number(kg),
        qty: Math.max(0, Number(emptyStockByKg?.[kg]) || 0),
      })),
    [emptyStockByKg]
  );

  const preCheckTotalEmptyCollected = useMemo(
    () => preCheckEmptyRows.reduce((sum, r) => sum + r.qty, 0),
    [preCheckEmptyRows]
  );

  const preCheckTotalOnHand = useMemo(
    () => preCheckStockRows.reduce((sum, r) => sum + r.onHand, 0),
    [preCheckStockRows]
  );

  return {
    activeOrdersToday,
    preCheckStockRows,
    preCheckHasShortfall,
    preCheckTotalOrderedGas,
    preCheckEmptyRows,
    preCheckTotalEmptyCollected,
    preCheckTotalOnHand,
    formatPreCheckQty: useCallback(formatPreCheckQty, []),
  };
}

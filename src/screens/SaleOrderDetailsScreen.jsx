import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getSaleOrderDetailsFromDB, getCachedVehicleInventoryByLocation, getVehicleLocationId, getDeliveryDataFromDB } from '../services/sync.service';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as stockMoveLinesDb from '../database/stockMoveLines.js';
import * as stockMovesDb from '../database/stockMoves.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import {
  buildProductIdToMoveLineIdMap,
  buildProductIdToMoveIdMap,
} from '../services/delivery.service';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getProductDisplayName } from '../utils/productDisplay';
import { getProductImageSource } from '../utils/gasImage';

function formatCurrency(amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return 'Rs 0.00';

    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `Rs ${parts.join('.')}`;
}
/** Format number with space as thousands separator (e.g. 12 000). */
// function formatWithSpace(amount) {
//   const n = Number(amount);
//   if (Number.isNaN(n)) return '0';
//   const [int, dec] = n.toFixed(2).split('.');
//   const withSpaces = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
//   return dec === '00' ? withSpaces : `${withSpaces}.${dec}`;
// }
function formatWithComma(amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return '0.00';
    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}
export default function SaleOrderDetailsScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { saleOrderId } = route.params;

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [isDelivered, setIsDelivered] = useState(false);
  const [modifyEnabled, setModifyEnabled] = useState(false);
  const [qtyChanged, setQtyChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [productIdToAvailable, setProductIdToAvailable] = useState({});

  const styles = useMemo(
    () =>
      StyleSheet.create({
          stockWarningText: {
            fontSize: 12,
            color: colors.error || '#c00',
            marginTop: 4,
            fontWeight: '600'
          },
        container: { flex: 1, backgroundColor: colors.background },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
        scroll: { flex: 1 },
        scrollContent: { padding: spacing.md, paddingBottom: 24 },
        errorText: { fontSize: 16, color: colors.textSecondary },
        customerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, paddingVertical: 4 },
        customerLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
        customerName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
        modifyUpdateBtn: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.primary,
        },
        modifyUpdateBtnUpdate: { backgroundColor: colors.warning, borderColor: colors.warning },
        modifyUpdateBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
        modifyUpdateBtnTextUpdate: { color: '#fff' },
        changedBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.surface,
          borderLeftWidth: 4,
          borderLeftColor: colors.warning,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
        },
        changedBannerText: { fontSize: 13, fontWeight: '600', color: colors.warning, flex: 1 },
        sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
        orderLinesHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        },
        emptyLines: { padding: spacing.lg, alignItems: 'center' },
        emptyText: { fontSize: 15, color: colors.textSecondary },
        grossTotalCard: {
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.lg,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        grossRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
        grossTotalRow: { marginTop: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, marginBottom: 0 },
        grossLabel: { fontSize: 14, color: colors.textSecondary },
        grossValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        grossTotalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
        grossTotalValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
        lineCard: {
          backgroundColor: colors.surface,
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.xs,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          overflow: 'hidden',
        },
        lineCardWithImage: {
          borderTopRightRadius: borderRadius.xl + 8,
          borderBottomRightRadius: borderRadius.xl + 8,
        },
        lineCardInnerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        },
        lineCardLeft: { flex: 1, minWidth: 0 },
        lineCardImageWrap: {
          width: 64,
          height: 64,
          borderRadius: 32,
          overflow: 'hidden',
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 3,
          justifyContent: 'center',
          alignItems: 'center',
        },
        lineCardImage: {
          width: 48,
          height: 48,
          resizeMode: 'contain',
          alignSelf: 'center',
          justifyContent: 'center',
          alignItems: 'center',
        },
        lineProductName: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: 6 },
        lineNameQtyRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 4,
        },
        lineUnitPriceRow: { marginTop: 2 },
        lineUnitPriceLabel: { fontSize: 12, color: colors.textSecondary },
        lineUnitPriceValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        lineTotalRow: {
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 6,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        lineTotalLabel: { fontSize: 12, color: colors.textSecondary, marginRight: 6 },
        lineTotalValue: { fontSize: 17, fontWeight: '800', color: colors.primary },
        lineOneRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        },
        lineLeftExpr: { fontSize: 15, fontWeight: '600', color: colors.text },
        lineRightTotal: { fontSize: 15, fontWeight: '700', color: colors.primary },
        availableStockRow: { marginTop: 4, width: '90%', flexDirection: 'row', justifyContent: 'flex-end' },
        availableStockText: { fontSize: 14, fontWeight: '400', color: colors.success ?? '#059669' },
        qtyInput: {
          fontSize: 16,
          fontWeight: '700',
          color: colors.text,
          borderWidth: 1.5,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          minWidth: 52,
          width: 52,
          textAlign: 'center',
          backgroundColor: colors.background,
        },
        qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        qtyControlsDisabled: { opacity: 0.7 },
        qtyInputDisabled: { backgroundColor: colors.border + '40', color: colors.textSecondary },
        qtyIconBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        },
        qtyValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        bottomSpacer: { height: 200 + insets.bottom },
        bottomBar: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.surface,
          padding: spacing.md,
          paddingBottom: spacing.md + 8 + insets.bottom,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 6,
        },
        payBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          backgroundColor: colors.primary,
        },
        payBtnDisabled: { backgroundColor: colors.textSecondary, opacity: 0.8 },
        payBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

          customerLeft: {
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.sm,
              flex: 1,
              minWidth: 0,
          },
          addressRow: {
              flexDirection: 'row',
              marginTop: 1,
          },
          addressText: {
              color: colors.textSecondary,
              lineHeight: 16,
              flex: 1,
          },
      }),
    [colors, insets.bottom]
  );

  const updateVehicleInventory = useCallback(async (effectiveQtys) => {
    const vehicleId = order?.vehicle_id != null
      ? (Array.isArray(order.vehicle_id) ? order.vehicle_id[0] : order.vehicle_id)
      : null;

    if (vehicleId == null) {
      console.warn('No vehicle ID found for inventory update');
      return;
    }

    // Get location_id for this vehicle
    const locationId = await getVehicleLocationId(vehicleId);
    if (locationId == null) {
      console.warn(`No location_id found for vehicle ${vehicleId}`);
      return;
    }

    console.log('[Inventory Update] Starting update for vehicle:', vehicleId, 'location:', locationId);

    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qtyUsed = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(line.newQty);
        const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

        if (productId == null || qtyUsed <= 0) continue;

        const currentStock = productIdToAvailable[productId] ?? 0;
        const newStock = Math.max(0, currentStock - qtyUsed);

        console.log(`[Inventory Update] Product ${productId}: ${currentStock} - ${qtyUsed} = ${newStock}`);


        await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(
          locationId,
          productId,
          newStock
        );

        const allInventory = await vehicleInventoriesDb.getVehicleInventoryByLocationId(locationId);
        console.log('[Inventory Update] Full inventory after update:', JSON.stringify(allInventory));

        const verifyItem = allInventory.find(inv =>
          (inv.product_id === productId || inv.id === productId)
        );
        console.log(`[Inventory Update] Verified new stock:`, verifyItem?.available_quantity);
      }

      await syncQueueDb.enqueue(syncQueueDb.ACTION_INVENTORY_UPDATE, {
        vehicleId,
        locationId,
        updates: lines.map((line, i) => {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
          const qtyUsed = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(line.newQty);
          return {
            productId,
            quantityUsed: qtyUsed,
            newQuantity: Math.max(0, (productIdToAvailable[productId] ?? 0) - qtyUsed)
          };
        }).filter(u => u.productId != null)
      });

      console.log('[Inventory Update] Complete - enqueued for sync');
    } catch (error) {
      console.error('[Inventory Update] Failed:', error);
      throw new Error('Failed to update vehicle inventory');
    }
  }, [order, lines, productIdToAvailable]);
  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      if (!data.order) {
        setOrder(null);
        setLines([]);
        setIsDelivered(false);
        return;
      }
      setOrder(data.order);
      setLines(
        (data.lines || []).map((l) => ({
          ...l,
          newQty: String(l.product_uom_qty ?? 0),
        }))
      );
      setQtyChanged(false);
      const { picking } = await getDeliveryDataFromDB(saleOrderId);
      setIsDelivered(data.order?.invoice_status === 'invoiced');


        const vehicleId = data.order?.vehicle_id != null
            ? (Array.isArray(data.order.vehicle_id) ? data.order.vehicle_id[0] : data.order.vehicle_id)
            : null;

        console.log(`[UI Debug] This order is assigned to Vehicle ID: ${vehicleId}`);

        if (vehicleId != null) {
          try {
            // Get location_id for this vehicle and fetch inventory by location
            const locationId = await getVehicleLocationId(vehicleId);
            console.log(`[UI Debug] Vehicle ${vehicleId} has location_id: ${locationId}`);

            if (locationId) {
              const inventories = await getCachedVehicleInventoryByLocation(locationId);
              const map = {};
              (inventories || []).forEach((inv) => {
                const pid = inv.product_id != null ? inv.product_id : inv.id;
                if (pid != null) {
                  map[pid] = Number(inv.available_quantity) ?? 0;
                }
              });
              setProductIdToAvailable(map);
            } else {
              console.warn(`[UI Debug] No location_id found for vehicle ${vehicleId}`);
              setProductIdToAvailable({});
            }
          } catch (error) {
            console.error('Failed to load vehicle inventory:', error);
            setProductIdToAvailable({});
          }
        } else {
          setProductIdToAvailable({});
        }
    } catch (_) {
      setOrder(null);
      setLines([]);
      setIsDelivered(false);
    } finally {
      setLoading(false);
    }
  }, [saleOrderId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    if (order?.name != null || order?.id != null) {
      const orderLabel = order.name ?? `#${order.id}`;
      navigation.setOptions({ title: `Order Details (${orderLabel})` });
    }
  }, [navigation, order?.name, order?.id]);

  // When available quantity is 0 for a product, force delivered quantity to 0
  useEffect(() => {
    if (Object.keys(productIdToAvailable).length === 0) return;
    setLines((prev) =>
      prev.map((l) => {
        const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        const available = productId != null ? productIdToAvailable[productId] : undefined;
        if (available !== undefined && available === 0) {
          return { ...l, newQty: '0' };
        }
        return l;
      })
    );
  }, [productIdToAvailable]);

    const setLineQty = useCallback((lineId, value) => {
      setUpdateError(null);
      const trimmed = value.replace(/[^0-9.]/g, '');
      const num = trimmed === '' ? 0 : parseFloat(trimmed);
      let safeQty = isNaN(num) || num < 0 ? 0 : num;

      setLines((prev) => {
        // Find the line from the previous state
        const line = prev.find(l => l.id === lineId);

        if (line) {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

          // Check against available stock
          if (productId != null && productIdToAvailable[productId] !== undefined) {
            const maxAllowed = productIdToAvailable[productId];
            safeQty = Math.min(safeQty, maxAllowed);
          }
        }

        return prev.map((l) =>
          l.id === lineId
            ? { ...l, newQty: trimmed === '' ? '' : String(safeQty) }
            : l
        );
      });

      setQtyChanged(true);
    }, [productIdToAvailable]);
const changeQtyBy = useCallback((lineId, delta) => {
  setUpdateError(null);
  const MAX_QTY = 9999;
  setLines((prev) =>
    prev.map((l) => {
      if (l.id !== lineId) return l;

      const current = parseFloat(l.newQty) || 0;
      let next = current + delta;


      const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      if (productId != null && productIdToAvailable[productId] !== undefined) {
        const maxAllowed = Math.min(MAX_QTY, productIdToAvailable[productId]);
        if (maxAllowed === 0) {
          next = 0;
        } else {
          next = Math.max(1, Math.min(maxAllowed, next));
        }
      } else {
        next = Math.max(1, Math.min(MAX_QTY, next));
      }

      return { ...l, newQty: String(next) };
    })
  );
  setQtyChanged(true);
}, [productIdToAvailable]);
  const hasQtyChanges = useCallback(() => {
    return lines.some(
      (l) => Number(l.newQty) !== Number(l.product_uom_qty)
    );
  }, [lines]);

const validateQuantities = useCallback(() => {
  for (const l of lines) {
    const qty = Number(l.newQty);
    const productName = getProductDisplayName(l.product_id?.[1] ?? l.name ?? '');

    const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
    const availableStock = productId != null ? productIdToAvailable[productId] : undefined;

    if (availableStock !== undefined && availableStock === 0) {
      if (qty !== 0) {
        return `No stock available for "${productName}". Delivered quantity must be 0.`;
      }
      continue;
    }

    if (Number.isNaN(qty) || qty < 1) {
      return `Quantity for "${productName}" must be at least 1 (cannot be 0)`;
    }

    if (availableStock !== undefined && qty > availableStock) {
      return `Insufficient stock for "${productName}". Available: ${availableStock}, Requested: ${qty}`;
    }
  }
  return null;
}, [lines, productIdToAvailable]);
  /** Apply qty updates locally (offline DB) and enqueue for sync. No Odoo calls. */
  const applyQtyDoneAndValidate = useCallback(
    async (effectiveQtys, markDeliveryDone = false) => {
      const { picking, moves, moveLines } = await getDeliveryDataFromDB(order.id);
      if (!picking?.id) throw new Error('No delivery order found for this sale order. Confirm the order first.');
      const productIdToMoveLineId = buildProductIdToMoveLineIdMap(moves, moveLines);
      const productIdToMoveId = buildProductIdToMoveIdMap(moves);

      const orderLineUpdates = [];
      const moveUpdates = [];
      const moveLineUpdates = [];
      /** Per-product qty_done for sync 4-step flow (get picking → get moves → create move lines → validate). */
      const deliveryLines = [];

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
        const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        const orderQty = Number(l.product_uom_qty) ?? 0;
        if (productId == null) continue;

        await saleOrderLinesDb.updateSaleOrderLineQtyLocal(l.id, newVal);
        orderLineUpdates.push({ lineId: l.id, product_uom_qty: newVal });

        if (newVal > orderQty) {
          const moveId = productIdToMoveId[productId];
          if (moveId != null) {
            await stockMovesDb.updateStockMoveQtyLocal(moveId, newVal);
            moveUpdates.push({ moveId, product_uom_qty: newVal });
          }
        }
        const moveId = productIdToMoveId[productId];
        if (moveId != null) {
          deliveryLines.push({ moveId, productId, qty_done: newVal });
        }
        const moveLineId = productIdToMoveLineId[productId];
        if (moveLineId != null) {
          await stockMoveLinesDb.updateMoveLineQtyLocal(moveLineId, newVal);
          moveLineUpdates.push({ moveLineId, qty_done: newVal });
        }
      }

      await saleOrdersDb.updateSaleOrderAmountsFromLines(order.id);

      if (markDeliveryDone && picking?.id) {
        await stockPickingsDb.updatePickingStateLocal(picking.id, 'done');
      }

      await syncQueueDb.enqueue(syncQueueDb.ACTION_DELIVERY, {
        saleOrderId: order.id,
        pickingId: picking?.id,
        orderLineUpdates,
        moveUpdates,
        moveLineUpdates,
        deliveryLines,
      });
    },
    [order?.id, lines]
  );
const getStockWarning = useCallback((lineId) => {
  const line = lines.find(l => l.id === lineId);
  if (!line) return null;

  const qty = Number(line.newQty);
  const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

  if (productId != null && productIdToAvailable[productId] !== undefined) {
    const availableStock = productIdToAvailable[productId];
    if (qty > availableStock) {
      return `Exceeds available stock (${availableStock})`;
    }
  }
  return null;
}, [lines, productIdToAvailable]);
  const updateQty = async () => {
    const validationError = validateQuantities();
    if (validationError) {
      setUpdateError(validationError);
      return;
    }
    setUpdateError(null);
    setUpdating(true);
    try {
      await applyQtyDoneAndValidate(lines.map((l) => l.newQty), false);
      await loadDetails();
      setModifyEnabled(false);
      setQtyChanged(false);
      setUpdateError(null);
    } catch (err) {
      setUpdateError(err?.message ?? 'Update failed. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

const handleProceedToPayment = useCallback(async () => {
  const noChanges = !hasQtyChanges();
  if (!noChanges) {
    const validationError = validateQuantities();
    if (validationError) {
      setUpdateError(validationError);
      return;
    }
  }
  setUpdateError(null);
  setUpdating(true);
  try {
    const effectiveQtys = noChanges
      ? lines.map((l) => Number(l.product_uom_qty) ?? 0)
      : lines.map((l) => l.newQty);


    await applyQtyDoneAndValidate(effectiveQtys, true);

    // Update vehicle inventory - deduct stock
    await updateVehicleInventory(effectiveQtys);

    const subtotal =
      !noChanges && lines.length
        ? lines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0)
        : lines.reduce((sum, l) => sum + (Number(l.newQty) || 0) * (Number(l.price_unit) || 0), 0);
    const tax =
      !noChanges && lines.length
        ? lines.reduce((sum, l) => sum + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)), 0)
        : lines.reduce((sum, l) => {
            const lineTax = (Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0);
            const origQty = Number(l.product_uom_qty) || 1;
            return sum + (origQty ? (lineTax / origQty) * (Number(l.newQty) || 0) : 0);
          }, 0);
    const total = subtotal + tax;

    navigation.navigate('ProceedPayment', {
      saleOrderId: order.id,
      total: total ?? order.amount_total,
      subtotal,
      tax,
      deliveryDone: true,
    });
  } catch (err) {
    setUpdateError(err?.message ?? 'Delivery update failed. Please try again.');
  } finally {
    setUpdating(false);
  }
}, [order, lines, validateQuantities, hasQtyChanges, applyQtyDoneAndValidate, updateVehicleInventory, navigation]);
  /** Per-product total qty in this order (current newQty values). Used for dynamic "remaining after order" stock. */
  const totalQtyByProductId = useMemo(() => {
    const map = {};
    lines.forEach((l) => {
      const pid = l.product_id != null && Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      if (pid != null) {
        map[pid] = (map[pid] || 0) + (Number(l.newQty) || 0);
      }
    });
    return map;
  }, [lines]);

  /** Subtotal from lines; fallback to order.amount_untaxed when no lines or sum is 0 */
  const computedSubtotal = useMemo(() => {
    if (!lines.length) return Number(order?.amount_untaxed) || 0;
    const sum = lines.reduce((s, l) => {
      const qtyChanged = Number(l.newQty) !== Number(l.product_uom_qty);
      if (qtyChanged) return s + (Number(l.price_unit) || 0) * (Number(l.newQty) || 0);
      return s + (Number(l.price_subtotal) || 0);
    }, 0);
    return sum > 0 ? sum : (Number(order?.amount_untaxed) || 0);
  }, [lines, order?.amount_untaxed]);

  /** Tax from lines; fallback to order.amount_tax when no lines or sum is 0 */
  const computedTax = useMemo(() => {
    if (!lines.length) return Number(order?.amount_tax) || 0;
    const sum = lines.reduce((s, l) => {
      const lineTax = (Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0);
      const qtyChanged = Number(l.newQty) !== Number(l.product_uom_qty);
      if (qtyChanged) {
        const origQty = Number(l.product_uom_qty) || 1;
        return s + (origQty ? (lineTax / origQty) * (Number(l.newQty) || 0) : 0);
      }
      return s + lineTax;
    }, 0);
    return sum > 0 ? sum : (Number(order?.amount_tax) || 0);
  }, [lines, order?.amount_tax]);

  /** Total (subtotal + tax); fallback to order.amount_total */
  const computedTotal = useMemo(() => {
    const t = computedSubtotal + computedTax;
    return t > 0 ? t : (Number(order?.amount_total) || 0);
  }, [computedSubtotal, computedTax, order?.amount_total]);

  const renderItem = ({ item }) => {
    const qtyNum = Number(item.newQty);
    const qtyChangedForLine =
      Number(item.newQty) !== Number(item.product_uom_qty);
    const unitPrice = Number(item.price_unit) || 0;
    const lineSubtotal = Number(item.price_subtotal) || 0;
    const displayLineTotal = qtyChangedForLine
      ? unitPrice * (Number.isNaN(qtyNum) ? 0 : qtyNum)
      : (lineSubtotal > 0 ? lineSubtotal : unitPrice * (Number.isNaN(qtyNum) ? 0 : qtyNum));
    const productName = item.product_id?.[1] ?? item.name ?? '';
    const productId = item.product_id != null && Array.isArray(item.product_id) ? item.product_id[0] : item.product_id;
    const availableStock = productId != null ? productIdToAvailable[productId] : undefined;
    const totalOrderedForProduct = productId != null ? (totalQtyByProductId[productId] ?? 0) : 0;
    const remainingAfterOrder = availableStock !== undefined ? availableStock - totalOrderedForProduct : undefined;
    const imageSource = getProductImageSource(productName);
    const isZeroStock = availableStock !== undefined && availableStock === 0;

    return (
      <View style={[styles.lineCard]}>
        <View style={styles.lineCardInnerRow}>
          {/* Left: circular gas image centered in circle */}
          {imageSource != null && (
            <View style={styles.lineCardImageWrap}>
              <Image source={imageSource} style={styles.lineCardImage} />
            </View>
          )}
          <View style={styles.lineCardLeft}>
            {/* Item name × quantity (same pattern as Order cards) – quantity at a glance */}
            {!isDelivered && modifyEnabled ? (
              <>
                <View style={styles.lineNameQtyRow}>
                  <Text style={styles.lineProductName} numberOfLines={1}>
                    {getProductDisplayName(productName) || 'Unknown'} ×
                  </Text>
                  <View style={[styles.qtyControls, isZeroStock && styles.qtyControlsDisabled]}>
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={isZeroStock ? undefined : () => changeQtyBy(item.id, -1)}
                      activeOpacity={0.8}
                      disabled={isZeroStock}
                    >
                      <Ionicons name="remove" size={22} color={isZeroStock ? colors.textSecondary : colors.primary} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.qtyInput, isZeroStock && styles.qtyInputDisabled]}
                      value={item.newQty}
                      onChangeText={isZeroStock ? undefined : (text) => setLineQty(item.id, text)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      selectTextOnFocus
                      editable={!isZeroStock}
                    />
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={isZeroStock ? undefined : () => changeQtyBy(item.id, 1)}
                      activeOpacity={0.8}
                      disabled={isZeroStock}
                    >
                      <Ionicons name="add" size={22} color={isZeroStock ? colors.textSecondary : colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {availableStock !== undefined && (
                  <View style={styles.availableStockRow}>
                    <Text style={styles.availableStockText}>
                      Available: {availableStock}
                      {/* {remainingAfterOrder !== undefined && (
                        <>
                          {'  ·  '}
                          <Text style={[styles.availableStockText, remainingAfterOrder < 0 && { color: colors.error || '#c00', fontWeight: '700' }]}>
                            After this order: {remainingAfterOrder}
                          </Text>
                        </>
                      )} */}
                    </Text>
                  </View>
                )}
                {getStockWarning(item.id) && (
                  <Text style={styles.stockWarningText}>
                    {getStockWarning(item.id)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.lineProductName} numberOfLines={2}>
                {getProductDisplayName(productName) || 'Unknown'} × 
                <Text style={styles.lineQtyValue}> {item.newQty} units</Text>
              </Text>
            )}

            <View style={styles.lineUnitPriceRow}>
              <Text style={styles.lineUnitPriceLabel}>Unit price</Text>
              <Text style={styles.lineUnitPriceValue}>{formatCurrency(unitPrice)}</Text>
            </View>
            <View style={styles.lineTotalRow}>
              <Text style={styles.lineTotalLabel}>Line total</Text>
              <Text style={styles.lineTotalValue}>{formatCurrency(displayLineTotal)}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }

  const canPay = !updating;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Order ID + Customer */}
          <View style={styles.customerRow}>
              <View style={styles.customerLeft}>
                  <View style={{ flex: 1 }}>
                      {(order.name || order.id) && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                              <Text style={[styles.customerLabel, { marginBottom: 0 }]}>Order</Text>
                              <Text style={[styles.customerName, { fontSize: 15 }]} numberOfLines={1}>
                                  {order.name ?? `#${order.id}`}
                              </Text>
                          </View>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text style={styles.customerName} numberOfLines={1}>
                              {order.partner_id?.[1] ?? '—'}
                          </Text>
                      </View>
                      {(order.city) && (
                          <View style={styles.addressRow}>
                              <Text style={styles.addressText}>
                                  {order.city}
                              </Text>
                              <Text style={styles.addressText}>
                                  {order.street}
                              </Text>
                              <Text style={styles.addressText}>
                                  {order.zip_code}
                              </Text>
                          </View>
                      )}
                  </View>
              </View>
          </View>

        {/* {!isDelivered && qtyChanged && (
          <View style={styles.changedBanner}>
            <Ionicons name="pencil" size={18} color={colors.warning} />
            <Text style={styles.changedBannerText}>
              Quantities changed. Tap "Update" (top right) to save.
            </Text>
          </View>
        )} */}

        {updateError != null && (
          <View style={[styles.changedBanner, { borderLeftColor: colors.error || '#c00' }]}>
            <Ionicons name="alert-circle" size={18} color={colors.error || '#c00'} />
            <Text style={[styles.changedBannerText, { color: colors.error || '#c00' }]}>
              {updateError}
            </Text>
          </View>
        )}

      

        {/* Order lines: title (left) + Modify / Update (right) */}
        <View style={styles.orderLinesHeaderRow}>
          <Text style={styles.sectionTitle}>Order lines</Text>
          {!isDelivered && (
            modifyEnabled ? (
              <TouchableOpacity
                style={[styles.modifyUpdateBtn]}
                onPress={updateQty}
                disabled={updating}
                activeOpacity={0.8}
              >
                {updating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.modifyUpdateBtnText]}>Save</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.modifyUpdateBtn}
                onPress={() => setModifyEnabled(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.modifyUpdateBtnText}>Modify Order</Text>
              </TouchableOpacity>
            )
          )}
        </View>
        {lines.length === 0 ? (
          <View style={styles.emptyLines}>
            <Text style={styles.emptyText}>No line items</Text>
          </View>
        ) : (
          lines.map((item) => (
            <View key={item.id}>{renderItem({ item })}</View>
          ))
        )}

          {/* Gross Total: Subtotal (sum price_subtotal), Tax (sum of line tax), Total */}
          <View style={styles.grossTotalCard}>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>Sub Total</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(computedSubtotal)}
            </Text>
          </View>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>VAT (18%)</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(computedTax)}
            </Text>
          </View>
          <View style={[styles.grossRow, styles.grossTotalRow]}>
            <Text style={styles.grossTotalLabel}>
              Total (with VAT)
            </Text>
            <Text style={styles.grossTotalValue}>
              {formatCurrency(computedTotal)}
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Bottom bar: only Proceed to payment */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.payBtn, (!canPay || modifyEnabled || updating) && styles.payBtnDisabled]}
          onPress={() => {
            if (!canPay) return;
            if (isDelivered) {
              navigation.navigate('ProceedPayment', {
                saleOrderId: order.id,
                total: computedTotal,
                subtotal: computedSubtotal,
                tax: computedTax,
                deliveryDone: true,
              });
            } else {
              handleProceedToPayment();
            }
          }}
          disabled={modifyEnabled || updating}
          activeOpacity={0.8}
        >
          <Ionicons name="card-outline" size={22} color="#fff" />
          <Text style={styles.payBtnText}>Proceed to payment</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

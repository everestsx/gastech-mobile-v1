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
import { getSaleOrderDetailsFromDB, getDeliveryDataFromDB } from '../services/sync.service';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as stockMoveLinesDb from '../database/stockMoveLines.js';
import * as stockMovesDb from '../database/stockMoves.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
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
          borderWidth: 1.5,
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
          marginBottom: spacing.sm,
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
          resizeMode: 'cover',
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
      setIsDelivered(picking?.state === 'done');
      const vehicleId = data.order?.vehicle_id != null ? (Array.isArray(data.order.vehicle_id) ? data.order.vehicle_id[0] : data.order.vehicle_id) : null;
      if (vehicleId != null) {
        try {
          const inventories = await vehicleInventoriesDb.getVehicleInventoryByVehicleId(vehicleId);
          const map = {};
          (inventories || []).forEach((inv) => {
            const pid = inv.product_id != null ? inv.product_id : inv.id;
            if (pid != null) map[pid] = Number(inv.available_quantity) ?? 0;
          });
          setProductIdToAvailable(map);
        } catch {
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

  const setLineQty = useCallback((lineId, value) => {
    setUpdateError(null);
    const trimmed = value.replace(/[^0-9.]/g, '');
    const num = trimmed === '' ? 0 : parseFloat(trimmed);
    const safeQty = isNaN(num) || num < 0 ? 0 : num;
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, newQty: trimmed === '' ? '' : String(safeQty) } : l
      )
    );
    setQtyChanged(true);
  }, []);

  const changeQtyBy = useCallback((lineId, delta) => {
    setUpdateError(null);
    const MAX_QTY = 9999;
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const current = parseFloat(l.newQty) || 0;
        const next = Math.max(1, Math.min(MAX_QTY, current + delta));
        return { ...l, newQty: String(next) };
      })
    );
    setQtyChanged(true);
  }, []);

  const hasQtyChanges = useCallback(() => {
    return lines.some(
      (l) => Number(l.newQty) !== Number(l.product_uom_qty)
    );
  }, [lines]);

  /** Validate: each line qty >= 1 (upselling/downselling allowed; backorder only when partial). */
  const validateQuantities = useCallback(() => {
    for (const l of lines) {
      const qty = Number(l.newQty);
      if (Number.isNaN(qty) || qty < 1) {
        return `Quantity for "${getProductDisplayName(l.product_id?.[1] ?? l.name ?? '')}" must be at least 1 (cannot be 0)`;
      }
    }
    return null;
  }, [lines]);

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
      });
    },
    [order?.id, lines]
  );

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

  /** Proceed to payment: save qtys locally, mark delivery done, enqueue, then navigate. */
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

      const total =
        !noChanges && lines.length
          ? lines.reduce(
              (sum, l) => sum + (Number(l.newQty) || 0) * (Number(l.price_unit) || 0),
              0
            )
          : order.amount_total;

      navigation.navigate('ProceedPayment', {
        saleOrderId: order.id,
        total: total ?? order.amount_total,
        deliveryDone: true,
      });
    } catch (err) {
      setUpdateError(err?.message ?? 'Delivery update failed. Please try again.');
    } finally {
      setUpdating(false);
    }
  }, [order, lines, validateQuantities, hasQtyChanges, applyQtyDoneAndValidate, navigation]);

  const renderItem = ({ item }) => {
    const qtyNum = Number(item.newQty);
    const qtyChangedForLine =
      Number(item.newQty) !== Number(item.product_uom_qty);
    const unitPrice = Number(item.price_unit) || 0;
    const displayLineTotal = qtyChangedForLine
      ? unitPrice * (Number.isNaN(qtyNum) ? 0 : qtyNum)
      : (item.price_total ?? 0);
    const productName = item.product_id?.[1] ?? item.name ?? '';
    const productId = item.product_id != null && Array.isArray(item.product_id) ? item.product_id[0] : item.product_id;
    const availableStock = productId != null ? productIdToAvailable[productId] : undefined;
    const imageSource = getProductImageSource(productName);

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
                  <View style={styles.qtyControls}>
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={() => changeQtyBy(item.id, -1)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="remove" size={22} color={colors.primary} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.qtyInput}
                      value={item.newQty}
                      onChangeText={(text) => setLineQty(item.id, text)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={() => changeQtyBy(item.id, 1)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="add" size={22} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {availableStock !== undefined && (
                  <View style={styles.availableStockRow}>
                    <Text style={styles.availableStockText}>Available Stock: {availableStock}</Text>
                  </View>
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
        {/* Customer (left only; Modify is with Order lines) */}
          <View style={styles.customerRow}>
              <View style={styles.customerLeft}>
                  <View style={{ flex: 1 }}>
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
                  <Text style={[styles.modifyUpdateBtnText]}>Update</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.modifyUpdateBtn}
                onPress={() => setModifyEnabled(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.modifyUpdateBtnText}>Modify</Text>
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

          {/* Gross Total bottom: Subtotal, Tax, Total (same as before) */}
          <View style={styles.grossTotalCard}>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>Subtotal</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(order.amount_total)}
            </Text>
          </View>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>Tax</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(order.amount_tax)}
            </Text>
          </View>
          <View style={[styles.grossRow, styles.grossTotalRow]}>
            <Text style={styles.grossTotalLabel}>
              Total{qtyChanged ? ' (unsaved)' : ''}
            </Text>
            <Text style={styles.grossTotalValue}>
              {formatCurrency(
                qtyChanged && lines.length
                  ? lines.reduce(
                      (sum, l) =>
                        sum +
                        (Number(l.newQty) || 0) * (Number(l.price_unit) || 0),
                      0
                    ) + order.amount_tax
                  : order.amount_total + order.amount_tax
              )}
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
                total: order.amount_total,
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

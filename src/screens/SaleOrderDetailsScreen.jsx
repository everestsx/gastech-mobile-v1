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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { updateSaleOrderLineQty } from '../services/saleOrderLine.service';
import { getSaleOrderDetailsFromDB, getDeliveryDataFromDB } from '../services/sync.service';
import {
  buildProductIdToMoveLineIdMap,
  buildProductIdToMoveIdMap,
  updateMoveLineQty,
  updateStockMoveQty,
  validatePicking,
  createBackorderConfirmation,
  processBackorderConfirmation,
  getPickingBySaleOrder,
} from '../services/delivery.service';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

/** Format number with space as thousands separator (e.g. 12 000). */
function formatWithSpace(amount) {
  const n = Number(amount);
  if (Number.isNaN(n)) return '0';
  const [int, dec] = n.toFixed(2).split('.');
  const withSpaces = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dec === '00' ? withSpaces : `${withSpaces}.${dec}`;
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
        scroll: { flex: 1 },
        scrollContent: { padding: spacing.md, paddingBottom: 24 },
        errorText: { fontSize: 16, color: colors.textSecondary },
        customerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, paddingVertical: 4 },
        customerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
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
        sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
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
        },
        lineProductName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 },
        lineOneRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        },
        lineLeftExpr: { fontSize: 15, fontWeight: '600', color: colors.text },
        lineRightTotal: { fontSize: 15, fontWeight: '700', color: colors.primary },
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
        qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
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
        qtyValue: { fontSize: 16, fontWeight: '600', color: colors.text },
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
        return `Quantity for "${l.product_id?.[1] ?? l.name}" must be at least 1 (cannot be 0)`;
      }
    }
    return null;
  }, [lines]);

  /** Apply qty_done (and demand when upselling) then validate. Backorder only when Odoo returns it (skipped for full delivery). */
  const applyQtyDoneAndValidate = useCallback(
    async (effectiveQtys) => {
      const { picking, moves, moveLines } = await getDeliveryDataFromDB(order.id);
      if (!picking?.id) throw new Error('No delivery order found for this sale order. Confirm the order first.');
      const productIdToMoveLineId = buildProductIdToMoveLineIdMap(moves, moveLines);
      const productIdToMoveId = buildProductIdToMoveIdMap(moves);

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
        const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        const orderQty = Number(l.product_uom_qty) ?? 0;
        if (productId == null) continue;
        if (newVal > orderQty) {
          await updateSaleOrderLineQty(l.id, newVal);
          const moveId = productIdToMoveId[productId];
          if (moveId != null) await updateStockMoveQty(moveId, newVal);
        }
        const moveLineId = productIdToMoveLineId[productId];
        if (moveLineId != null) await updateMoveLineQty(moveLineId, newVal);
      }

      await applyValidateAndBackorder(picking, order.id);
    },
    [order?.id, lines, applyValidateAndBackorder]
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
      await applyQtyDoneAndValidate(lines.map((l) => l.newQty));
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

  /** Validate picking. Backorder process only when Odoo returns backorder (full delivery => skip backorder). */
  const applyValidateAndBackorder = useCallback(async (picking, saleOrderId) => {
    const validateResult = await validatePicking(picking.id);
    if (validateResult === true) return;
    let backorderIds = [];
    if (typeof validateResult === 'number') {
      await processBackorderConfirmation(validateResult);
      return;
    }
    if (validateResult != null && typeof validateResult === 'object') {
      const pickIds = validateResult.pick_ids ?? validateResult.backorder_pick_ids;
      if (Array.isArray(pickIds) && pickIds.length > 0) {
        backorderIds = pickIds.map((p) => (Array.isArray(p) ? p[0] : p)).filter(Boolean);
      }
    }
    if (backorderIds.length === 0 && saleOrderId != null) {
      const pickingsAgain = await getPickingBySaleOrder(saleOrderId);
      const currentPicking = pickingsAgain?.find((p) => p.id === picking.id) ?? picking;
      backorderIds = currentPicking?.backorder_ids ?? [];
    }
    if (backorderIds.length > 0) {
      const wizardId = await createBackorderConfirmation(backorderIds);
      if (wizardId != null) await processBackorderConfirmation(wizardId);
    }
  }, []);

  /** Proceed to payment: set qty_done (default full delivery when user didn't change qty), validate, then navigate. Backorder only when partial. */
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
      await applyQtyDoneAndValidate(effectiveQtys);

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
    const qtyDisplay = Number.isNaN(qtyNum) ? 0 : qtyNum;

    return (
      <View style={styles.lineCard}>
        <Text style={styles.lineProductName} numberOfLines={2}>
          {item.product_id?.[1] ?? '—'}
        </Text>

        {/* One line: qty × unit price (left)    line total (right), space-styled */}
        <View style={styles.lineOneRow}>
          {/* <Text style={styles.lineLeftExpr} numberOfLines={1}>
            {qtyDisplay} × {formatWithSpace(unitPrice)}
          </Text>
          <Text style={styles.lineRightTotal}>{formatWithSpace(displayLineTotal)}</Text> */}
        </View>

        {/* Quantity modify: same behaviour, modern UI */}
        {!isDelivered && modifyEnabled ? (
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
            <Text style={styles.lineLeftExpr}>x</Text>
            <Text style={styles.lineRightTotal}> {formatWithSpace(displayLineTotal)}</Text>
          </View>
        ) : (
          <View style={styles.lineOneRow}>
          <Text style={[styles.qtyValue, { marginTop: 4 }]}>Qty: {item.newQty} × {formatWithSpace(unitPrice)}</Text>
          <Text style={styles.lineRightTotal}>{formatWithSpace(displayLineTotal)}</Text>
          </View>
        )}
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
        {/* Customer (left) + Modify / Update (top right) */}
        <View style={styles.customerRow}>
          <View style={styles.customerLeft}>
            <Text style={styles.customerLabel}>Customer: </Text>
            <Text style={styles.customerName} numberOfLines={1}>
              {order.partner_id?.[1] ?? '—'}
            </Text>
          </View>
          {!isDelivered && (
            modifyEnabled ? (
              <TouchableOpacity
                style={[styles.modifyUpdateBtn]}
                onPress={updateQty}
                disabled={updating}
                activeOpacity={0.8}
              >
                {updating ? (
                  <ActivityIndicator size="small" color="#fff" />
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

      

        {/* Order lines below */}
        <Text style={styles.sectionTitle}>Order lines</Text>
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

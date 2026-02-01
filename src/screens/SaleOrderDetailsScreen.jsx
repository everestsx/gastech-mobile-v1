import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getSaleOrderDetails,
  updateSaleOrderLineQty,
} from '../services/saleOrderLine.service';
import { colors, spacing, borderRadius } from '../constants/theme';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

export default function SaleOrderDetailsScreen({ route, navigation }) {
  const { saleOrderId } = route.params;

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [modifyEnabled, setModifyEnabled] = useState(false);
  const [qtyChanged, setQtyChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSaleOrderDetails(saleOrderId);
      setOrder(data.order);
      setLines(
        (data.lines || []).map((l) => ({
          ...l,
          newQty: String(l.product_uom_qty ?? 0),
        }))
      );
      setQtyChanged(false);
    } catch (_) {
      setOrder(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [saleOrderId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const setLineQty = useCallback((lineId, value) => {
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
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const current = parseFloat(l.newQty) || 0;
        const next = Math.max(0, current + delta);
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

  const updateQty = async () => {
    if (!hasQtyChanges()) return;
    setUpdating(true);
    try {
      for (const l of lines) {
        const newVal = Number(l.newQty);
        if (!Number.isNaN(newVal) && newVal !== Number(l.product_uom_qty)) {
          await updateSaleOrderLineQty(l.id, newVal);
        }
      }
      await loadDetails();
      setModifyEnabled(false);
      setQtyChanged(false);
    } catch (_) {
      // silent fail or show inline error if you add state
    } finally {
      setUpdating(false);
    }
  };

  const renderItem = ({ item }) => {
    const qtyNum = Number(item.newQty);
    const qtyChangedForLine =
      Number(item.newQty) !== Number(item.product_uom_qty);
    const displayLineTotal = qtyChangedForLine
      ? (item.price_unit ?? 0) * (Number.isNaN(qtyNum) ? 0 : qtyNum)
      : (item.price_total ?? 0);

    return (
      <View style={styles.lineCard}>
        <Text style={styles.lineProductName} numberOfLines={2}>
          {item.product_id?.[1] ?? '—'}
        </Text>

        {/* Unit price (left) and Quantity (right) on one line */}
        <View style={styles.qtyPriceRow}>
          <View style={styles.unitPriceBlock}>
            <Text style={styles.lineLabel}>Unit price</Text>
            <Text style={styles.lineValue}>
              {formatCurrency(item.price_unit ?? 0)}
            </Text>
          </View>
          <View style={styles.qtyBlock}>
            <Text style={styles.lineLabel}>Quantity</Text>
            {modifyEnabled ? (
              <View style={styles.qtyControls}>
                <TouchableOpacity
                  style={styles.qtyIconBtn}
                  onPress={() => changeQtyBy(item.id, -1)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="remove" size={24} color={colors.primary} />
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
                  <Ionicons name="add" size={24} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.qtyValue}>{item.newQty}</Text>
            )}
          </View>
        </View>

        <View style={[styles.lineRow, styles.lineTotalRow]}>
          <Text style={styles.lineTotalLabel}>Line total</Text>
          <Text style={styles.lineTotalValue}>
            {formatCurrency(displayLineTotal)}
          </Text>
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

  const canPay = !qtyChanged && !updating;

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
        {/* Customer - compact: left label + name */}
        <View style={styles.customerRow}>
          <Text style={styles.customerLabel}>Customer</Text>
          <Text style={styles.customerName} numberOfLines={1}>
            {order.partner_id?.[1] ?? '—'}
          </Text>
        </View>

        {qtyChanged && (
          <View style={styles.changedBanner}>
            <Ionicons name="pencil" size={18} color={colors.warning} />
            <Text style={styles.changedBannerText}>
              Quantities changed. Tap "Update quantity" to save.
            </Text>
          </View>
        )}

        {/* Order lines */}
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

        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(order.amount_untaxed)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tax</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(order.amount_tax)}
            </Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryTotalRow]}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {formatCurrency(order.amount_total)}
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Bottom bar: Enable modify (when off) or Update quantity (when on) */}
      <View style={styles.bottomBar}>
        {modifyEnabled ? (
          <TouchableOpacity
            style={styles.updateBtn}
            onPress={updateQty}
            disabled={updating}
            activeOpacity={0.8}
          >
            {updating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.updateBtnText}>Update quantity</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.modifyBtn}
            onPress={() => setModifyEnabled(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <Text style={styles.modifyBtnText} numberOfLines={1}>
              Enable modify
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.payBtn, !canPay && styles.payBtnDisabled]}
          onPress={() =>
            canPay &&
            navigation.navigate('ProceedPayment', {
              saleOrderId: order.id,
              total: order.amount_total,
            })
          }
          disabled={!canPay}
          activeOpacity={0.8}
        >
          <Ionicons name="card-outline" size={22} color="#fff" />
          <Text style={styles.payBtnText}>Proceed to payment</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: 4,
  },
  customerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  changedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fef3c7',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  changedBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyLines: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
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
  lineProductName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  qtyPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: spacing.md,
  },
  qtyBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  unitPriceBlock: {
    alignItems: 'flex-start',
    minWidth: 90,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  lineTotalRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  lineValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  qtyInput: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 56,
    width: 56,
    textAlign: 'center',
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  qtyIconBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  lineTotalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  lineTotalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginTop: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryTotalRow: {
    marginTop: 6,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginBottom: 0,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  summaryTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  summaryTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  bottomSpacer: { height: 200 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    padding: spacing.md,
    paddingBottom: spacing.md + 8,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    gap: spacing.sm,
  },
  modifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  modifyBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.warning,
  },
  updateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
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
  payBtnDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.8,
  },
  payBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});

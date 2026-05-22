import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getProductDisplayName,
  getGasSizeFromProductName,
  getOrderLineDisplayLabel,
  resolveOrderLinesForCard,
} from '../utils/productDisplay';
import { formatCurrency } from '../utils/format';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import { getOrderDisplayTotal } from '../utils/orderLineTotals';

/** Format date_order (ISO or date string) for display. */
function formatOrderDate(dateOrder) {
  if (!dateOrder) return '—';
  const str = String(dateOrder);
  const datePart = str.split('T')[0] || str;
  try {
    // Parse date-only values at local noon to avoid UTC day-shift (e.g., 24 showing as 23).
    const d = /^\d{4}-\d{2}-\d{2}$/.test(datePart)
      ? new Date(`${datePart}T12:00:00`)
      : new Date(str);
    if (Number.isNaN(d.getTime())) return datePart;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return datePart;
  }
}

export function getOrderTotalQty(order) {
  if (order?.totalQty != null && order.totalQty !== '') {
    return order.totalQty;
  }
  const lines = order?.orderLines || order?.order_line;
  if (Array.isArray(lines) && lines.length > 0) {
    const sum = lines.reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0);
    const anyQty = lines.some((l) => l && l.product_uom_qty != null && String(l.product_uom_qty).trim() !== '');
    if (anyQty || sum > 0) return sum;
    return lines.length;
  }
  return '—';
}

/**
 * Order card: Customer name (bold), Order ID (normal), date below name.
 * Top right: Order Type badge + Order Status badge (To Deliver / Invoiced / Delivered).
 * Total amount; item-wise quantity badges (qty + shortcode) with color coding.
 * When isDelivered and paymentSplit is provided, shows payment breakdown: Cash Paid, Cheque Paid, Credit Balance, Remaining balance.
 */
export default function OrderCard({
  order,
  onPress,
  onCancelPress = null,
  isDelivered,
  orderLines = [],
  paymentSplit = null,
  deliveryBannerText = null,
  /** When set on delivered tab: show only products with qty_done > 0 as "X kg — N delivered". */
  qtyDoneByProductId = null,
  /** 'invoice' | 'payment_proof' — checkout in progress after payment (resume from list). */
  checkoutResumePhase = null,
}) {
  const { t } = useTranslation();
  const { colors, syncDateField, appLanguage } = useTheme();

  // Consistent colors per gas size so users quickly identify Small/Medium/Large/Big across all cards
  const GAS_SIZE_COLORS = useMemo(
    () => ({
      small: colors.success ?? '#059669',
      medium: colors.primary ?? '#4f46e5',
      large: colors.warning ?? '#d97706',
      big: colors.secondary ?? '#4338ca',
    }),
    [colors]
  );
  const FALLBACK_ACCENT = colors.primaryLight ?? colors.primary ?? '#818cf8';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          overflow: 'hidden',
        },
        cardCancelled: {
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: 0.92,
        },
        deliveryBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 10,
          paddingHorizontal: spacing.lg,
          marginHorizontal: -spacing.lg,
          marginTop: -spacing.lg,
          marginBottom: spacing.md,
        },
        deliveryBannerLabel: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 18 },
        rowBetween: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        orderId: { fontSize: 14, fontWeight: '400', color: colors.textSecondary },
        customerName: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginTop: 2 },
        badgesRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
        badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
        badgeSale: { backgroundColor: colors.primary },
        badgeDraft: { backgroundColor: colors.warning },
        badgeCancel: { backgroundColor: colors.error },
        badgeStatusToDeliver: { backgroundColor: '#93c5fd' },
        badgeStatusInvoiced: { backgroundColor: colors.primarySurface || '#e0e7ff' },
        badgeStatusDelivered: { backgroundColor: colors.success ?? '#059669' },
        badgeStatusResume: { backgroundColor: '#fef3c7' },
        badgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
        badgeStatusText: { fontSize: 12, fontWeight: '700', color: colors.text },
        badgeStatusTextInvoiced: { fontSize: 11, fontWeight: '600', color: colors.text },
        dateAmountRow: { marginTop: 4 },
        orderDate: { fontSize: 12, color: colors.textSecondary },
        amount: { fontSize: 16, fontWeight: '800', color: colors.primary },
        paymentBreakdown: {
          marginTop: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        paymentBreakdownTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
        paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
        paymentLabel: { fontSize: 12, color: colors.textSecondary },
        paymentValue: { fontSize: 12, fontWeight: '600', color: colors.text },
        remainingRow: { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
        remainingLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
        remainingValue: { fontSize: 13, fontWeight: '800', color: colors.primary },
        qtyBadgesRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          alignContent: 'flex-start',
          gap: 6,
          marginTop: 4,
        },
        qtyBadge: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 4,
          paddingRight: 8,
          paddingLeft: 0,
          borderRadius: 6,
          borderWidth: 1,
          flexShrink: 0,
        },
        qtyBadgeSquare: {
          width: 10,
          height: 10,
          borderRadius: 2,
          marginLeft: 6,
          marginRight: 6,
        },
        qtyBadgeText: { fontSize: 11, fontWeight: '600', color: colors.text },
        qtyBadgeSizeLabel: { fontSize: 12, fontWeight: '800', color: colors.text, marginRight: 2 },
        dividerLine: {
          height: 1,
          backgroundColor: colors.border,
          opacity: 0.4,
          marginTop: spacing.sm,
          marginBottom: spacing.sm,
        },
        actionsRow: {
          marginTop: spacing.sm,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        tapForDetailsText: {
          fontSize: 12,
          fontWeight: '600',
          color: colors.textSecondary,
        },
        cancelActionBtn: {
          width: 26,
          height: 26,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 13,
          backgroundColor: `${colors.error || '#dc2626'}18`,
          borderWidth: 1,
          borderColor: `${colors.error || '#dc2626'}40`,
        },
      }),
    [colors]
  );

  function getOrderTypeBadgeStyle(state) {
    switch (state) {
      case 'sale':
        return styles.badgeSale;
      case 'cancel':
        return styles.badgeCancel;
      case 'draft':
      default:
        return styles.badgeDraft;
    }
  }

  function getOrderStatusLabel() {
    if (String(order?.state) === 'cancel') return 'Cancelled';
    if (checkoutResumePhase === 'payment_proof') return 'Order pending';
    if (checkoutResumePhase === 'invoice') return 'Order pending';
    if (isDelivered) return 'Delivered';
    if (String(order?.invoice_status) === 'invoiced') return 'Invoiced';
    return 'To Deliver';
  }

  function getOrderStatusBadgeStyle() {
    if (String(order?.state) === 'cancel') return styles.badgeCancel;
    if (checkoutResumePhase) return styles.badgeStatusResume;
    if (isDelivered) return styles.badgeStatusDelivered;
    if (String(order?.invoice_status) === 'invoiced') return styles.badgeStatusInvoiced;
    return styles.badgeStatusToDeliver;
  }

  const isStatusDarkText =
    String(order?.state) === 'cancel'
      ? false
      : checkoutResumePhase
        ? true
        : String(order?.invoice_status) === 'invoiced';

  const baseLines = order ? resolveOrderLinesForCard(order, orderLines) : [];
  const displayOrderTotal = useMemo(
    () => (order ? getOrderDisplayTotal(order, baseLines) : 0),
    [order, baseLines]
  );
  const lines = useMemo(() => {
    if (!isDelivered || !qtyDoneByProductId || typeof qtyDoneByProductId !== 'object') {
      return baseLines;
    }
    const out = [];
    for (const line of baseLines) {
      const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const pid = pidRaw != null ? Number(pidRaw) : NaN;
      if (!Number.isFinite(pid)) continue;
      const done = Number(qtyDoneByProductId[pid]) || 0;
      if (done <= 0) continue;
      out.push({ ...line, product_uom_qty: done, __deliveredBadge: true });
    }
    return out;
  }, [baseLines, isDelivered, qtyDoneByProductId]);

  if (!order) return null;

  const state = order.state || 'draft';
  const displayDate = syncDateField === 'delivery_date' ? order.commitment_date : order.date_order;

  return (
    <TouchableOpacity
      style={[styles.card, String(order?.state) === 'cancel' && styles.cardCancelled]}
      onPress={() => onPress?.(order)}
      activeOpacity={0.8}
    >
      {deliveryBannerText ? (
        <View style={styles.deliveryBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.deliveryBannerLabel} numberOfLines={2}>
            {deliveryBannerText}
          </Text>
        </View>
      ) : null}
      {/* Row 1: Order ID (left); Order Type + Order Status badges (right) */}
      <View style={styles.rowBetween}>
        <Text style={styles.orderId} numberOfLines={1}>
          {order.name || '—'}
        </Text>
        <View style={styles.badgesRight}>
          {/* TODO: Keep this commented out for future use */}
          {/* <View style={[styles.badge, getOrderTypeBadgeStyle(state)]}>
            <Text style={styles.badgeText}>{String(state).toUpperCase()}</Text>
          </View> */}
          <View style={[styles.badge, getOrderStatusBadgeStyle()]}>
            <Text
              style={isStatusDarkText ? styles.badgeStatusTextInvoiced : styles.badgeStatusText}
            >
              {getOrderStatusLabel()}
            </Text>
          </View>
        </View>
      </View>

      {/* Row 2: Customer name (bold) */}
      <Text style={styles.customerName} numberOfLines={1}>
        {getLocalizedCustomerNameFromOrder(order, appLanguage)}
      </Text>

      {/* Row 3: Order date (left); Total amount (right), horizontally aligned */}
      <View style={[styles.rowBetween, styles.dateAmountRow]}>
        <Text style={styles.orderDate}>{formatOrderDate(displayDate)}</Text>
        <Text style={styles.amount}>{formatCurrency(displayOrderTotal)}</Text>
      </View>

      {/* Payment breakdown (Delivery tab): Cash Paid, Cheque Paid, Credit Balance, Remaining balance */}
      {isDelivered && paymentSplit && (paymentSplit.cash > 0 || paymentSplit.cheque > 0 || paymentSplit.credit > 0) ? (
        <View style={styles.paymentBreakdown}>
          <Text style={styles.paymentBreakdownTitle}>{t('common.paymentBreakdown', 'Payment breakdown')}</Text>
          {paymentSplit.cash > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>{t('common.cashPaid', 'Cash Paid')}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.cash, 'Rs.')}</Text>
            </View>
          )}
          {paymentSplit.cheque > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>{t('common.chequePaid', 'Cheque Paid')}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.cheque, 'Rs.')}</Text>
            </View>
          )}
          {paymentSplit.credit > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>{t('common.creditBalance', 'Credit Balance')}</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.credit, 'Rs.')}</Text>
            </View>
          )}
          {(() => {
            const total = displayOrderTotal || 0;
            const paid = (paymentSplit.cash || 0) + (paymentSplit.cheque || 0) + (paymentSplit.credit || 0);
            const remaining = Math.max(0, total - paid);
            if (remaining <= 0) return null;
            return (
              <View style={[styles.paymentRow, styles.remainingRow]}>
                <Text style={styles.remainingLabel}>{t('common.remainingBalance', 'Remaining balance')}</Text>
                <Text style={styles.remainingValue}>{formatCurrency(remaining, 'Rs.')}</Text>
              </View>
            );
          })()}
        </View>
      ) : null}

      {/* Item-wise quantity badges: just below top items, less margin */}
      {lines.length > 0 ? (
        <View style={styles.qtyBadgesRow}>
          {lines.map((line, index) => {
            const qty = Number(line.product_uom_qty) || 0;
            const rawLabel = getOrderLineDisplayLabel(line);
            const displayName = getProductDisplayName(rawLabel) || rawLabel || '—';
            const gasSize = getGasSizeFromProductName(rawLabel);
            const accent = gasSize && GAS_SIZE_COLORS[gasSize.size]
              ? GAS_SIZE_COLORS[gasSize.size]
              : FALLBACK_ACCENT;
            return (
              <View key={line.id ?? line.line_id ?? index} style={[styles.qtyBadge, { borderColor: accent }]}>
                <View style={[styles.qtyBadgeSquare, { backgroundColor: accent }]} />
                <Text style={styles.qtyBadgeText} numberOfLines={2}>
                  {line.__deliveredBadge && gasSize ? (
                    <>
                      <Text style={styles.qtyBadgeSizeLabel}>{gasSize.kg} kg — </Text>
                      <Text style={styles.qtyBadgeSizeLabel}>{qty} {t('common.delivered2', 'delivered')}</Text>
                    </>
                  ) : gasSize ? (
                    <>
                      <Text style={styles.qtyBadgeSizeLabel}>{gasSize.kg} kg × </Text>
                      <Text style={styles.qtyBadgeSizeLabel}>{qty}</Text>
                    </>
                  ) : line.__deliveredBadge ? (
                    `${displayName} — ${qty} ${t('common.delivered2', 'delivered')}`
                  ) : (
                    `${displayName} × ${qty}`
                  )}
                </Text>
              </View>
            );
          })}
        </View>
      ) : isDelivered && qtyDoneByProductId ? null : (
        <View style={styles.qtyBadgesRow}>
          <View style={[styles.qtyBadge, { borderColor: colors.border }]}>
            <View style={[styles.qtyBadgeSquare, { backgroundColor: colors.border }]} />
            <Text style={styles.qtyBadgeText}>{t('common.qty', 'Qty:')} {getOrderTotalQty(order)}</Text>
          </View>
        </View>
      )}

      {typeof onCancelPress === 'function' ? (
        <>
          <View style={styles.dividerLine} />
          <View style={styles.actionsRow}>
            <Text style={styles.tapForDetailsText}>{t('common.tapForDetails', 'Tap for details')}</Text>
            <TouchableOpacity
              style={styles.cancelActionBtn}
              onPress={() => onCancelPress(order)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('saleorderdetails.cancelOrder', 'Cancel order')}
            >
              <Ionicons name="trash-outline" size={14} color={colors.error || '#dc2626'} />
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </TouchableOpacity>
  );
}

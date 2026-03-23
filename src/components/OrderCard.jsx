import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getProductDisplayName, getGasSizeFromProductName } from '../utils/productDisplay';
import { formatCurrency } from '../utils/format';

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
    if (lines[0] && typeof lines[0].product_uom_qty === 'number') {
      return lines.reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0);
    }
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
export default function OrderCard({ order, onPress, isDelivered, orderLines = [], paymentSplit = null }) {
  const { colors, syncDateField } = useTheme();

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
        },
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
    if (isDelivered) return 'Delivered';
    if (String(order?.invoice_status) === 'invoiced') return 'Invoiced';
    return 'To Deliver';
  }

  function getOrderStatusBadgeStyle() {
    if (isDelivered) return styles.badgeStatusDelivered;
    if (String(order?.invoice_status) === 'invoiced') return styles.badgeStatusInvoiced;
    return styles.badgeStatusToDeliver;
  }

  const isStatusDarkText = String(order?.invoice_status) === 'invoiced';

  if (!order) return null;

  const state = order.state || 'draft';
  const displayDate = syncDateField === 'delivery_date' ? order.commitment_date : order.date_order;
  const lines = Array.isArray(orderLines) && orderLines.length > 0
    ? orderLines
    : (order.orderLines || []);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(order)}
      activeOpacity={0.8}
    >
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
        {order.partner_id?.[1] || '—'}
      </Text>

      {/* Row 3: Order date (left); Total amount (right), horizontally aligned */}
      <View style={[styles.rowBetween, styles.dateAmountRow]}>
        <Text style={styles.orderDate}>{formatOrderDate(displayDate)}</Text>
        <Text style={styles.amount}>{formatCurrency(order.amount_total)}</Text>
      </View>

      {/* Payment breakdown (Delivery tab): Cash Paid, Cheque Paid, Credit Balance, Remaining balance */}
      {isDelivered && paymentSplit && (paymentSplit.cash > 0 || paymentSplit.cheque > 0 || paymentSplit.credit > 0) ? (
        <View style={styles.paymentBreakdown}>
          <Text style={styles.paymentBreakdownTitle}>Payment breakdown</Text>
          {paymentSplit.cash > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Cash Paid</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.cash, 'Rs.')}</Text>
            </View>
          )}
          {paymentSplit.cheque > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Cheque Paid</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.cheque, 'Rs.')}</Text>
            </View>
          )}
          {paymentSplit.credit > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Credit Balance</Text>
              <Text style={styles.paymentValue}>{formatCurrency(paymentSplit.credit, 'Rs.')}</Text>
            </View>
          )}
          {(() => {
            const total = Number(order.amount_total) || 0;
            const paid = (paymentSplit.cash || 0) + (paymentSplit.cheque || 0) + (paymentSplit.credit || 0);
            const remaining = Math.max(0, total - paid);
            if (remaining <= 0) return null;
            return (
              <View style={[styles.paymentRow, styles.remainingRow]}>
                <Text style={styles.remainingLabel}>Remaining balance</Text>
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
            const rawLabel = line.product_id?.[1] || line.name || 'Item';
            const displayName = getProductDisplayName(rawLabel) || 'Item';
            const gasSize = getGasSizeFromProductName(rawLabel);
            const accent = gasSize && GAS_SIZE_COLORS[gasSize.size]
              ? GAS_SIZE_COLORS[gasSize.size]
              : FALLBACK_ACCENT;
            return (
              <View key={line.id || index} style={[styles.qtyBadge, { borderColor: accent }]}>
                <View style={[styles.qtyBadgeSquare, { backgroundColor: accent }]} />
                <Text style={styles.qtyBadgeText} numberOfLines={1}>
                  {gasSize ? (
                    <>
                      <Text style={styles.qtyBadgeSizeLabel}>{gasSize.kg} kg × </Text>
                      <Text style={styles.qtyBadgeSizeLabel}>{qty}</Text>
                    </>
                  ) : (
                    `${displayName} × ${qty}`
                  )}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.qtyBadgesRow}>
          <View style={[styles.qtyBadge, { borderColor: colors.border }]}>
            <View style={[styles.qtyBadgeSquare, { backgroundColor: colors.border }]} />
            <Text style={styles.qtyBadgeText}>Qty: {getOrderTotalQty(order)}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

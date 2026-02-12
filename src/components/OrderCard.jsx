import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

/** Format date_order (ISO or date string) for display. */
function formatOrderDate(dateOrder) {
  if (!dateOrder) return '—';
  const str = String(dateOrder);
  const datePart = str.split('T')[0] || str;
  try {
    const d = new Date(datePart);
    if (Number.isNaN(d.getTime())) return datePart;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return datePart;
  }
}

/** Shortcode for product: first word or first 6 chars of name. */
function productShortcode(name) {
  if (!name || typeof name !== 'string') return 'Item';
  const trimmed = name.trim();
  const firstWord = trimmed.split(/\s+/)[0];
  if (firstWord && firstWord.length <= 8) return firstWord;
  return trimmed.slice(0, 6);
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
 */
export default function OrderCard({ order, onPress, isDelivered, orderLines = [] }) {
  const { colors } = useTheme();

  const ITEM_BADGE_COLORS = useMemo(
    () => [
      colors.primary,
      colors.success ?? '#059669',
      colors.warning ?? '#d97706',
      colors.primaryLight ?? '#818cf8',
      colors.secondary ?? '#4338ca',
    ],
    [colors]
  );

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
        badgeSale: { backgroundColor: colors.success },
        badgeDraft: { backgroundColor: colors.warning },
        badgeCancel: { backgroundColor: colors.error },
        badgeStatusToDeliver: { backgroundColor: '#93c5fd' },
        badgeStatusInvoiced: { backgroundColor: colors.primarySurface || '#e0e7ff' },
        badgeStatusDelivered: { backgroundColor: colors.primaryDark || colors.secondary || '#4f46e5' },
        badgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
        badgeStatusText: { fontSize: 12, fontWeight: '700', color: '#fff' },
        badgeStatusTextInvoiced: { fontSize: 11, fontWeight: '600', color: colors.text },
        dateAmountRow: { marginTop: 4 },
        orderDate: { fontSize: 12, color: colors.textSecondary },
        amount: { fontSize: 16, fontWeight: '800', color: colors.primary },
        qtyBadgesRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          marginTop: 4,
        },
        qtyBadge: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 8,
        },
        qtyBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
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
          <View style={[styles.badge, getOrderTypeBadgeStyle(state)]}>
            <Text style={styles.badgeText}>{String(state).toUpperCase()}</Text>
          </View>
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
        <Text style={styles.orderDate}>{formatOrderDate(order.date_order)}</Text>
        <Text style={styles.amount}>{formatCurrency(order.amount_total)}</Text>
      </View>

      {/* Item-wise quantity badges: just below top items, less margin */}
      {lines.length > 0 ? (
        <View style={styles.qtyBadgesRow}>
          {lines.map((line, index) => {
            const qty = Number(line.product_uom_qty) || 0;
            const label = line.name || line.product_id?.[1] || 'Item';
            const shortcode = productShortcode(label);
            const bg = ITEM_BADGE_COLORS[index % ITEM_BADGE_COLORS.length];
            return (
              <View key={line.id || index} style={[styles.qtyBadge, { backgroundColor: bg }]}>
                <Text style={styles.qtyBadgeText}>{qty} {shortcode}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.qtyBadgesRow}>
          <View style={[styles.qtyBadge, { backgroundColor: colors.border }]}>
            <Text style={[styles.qtyBadgeText, { color: colors.textSecondary }]}>
              Qty: {getOrderTotalQty(order)}
            </Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, borderRadius } from '../constants/theme';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

export function getOrderTotalQty(order) {
  const lines = order?.order_line;
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.length;
  }
  return '—';
}

function getStatusBadgeStyle(state) {
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

/**
 * Reusable sale order card: order no, status badge, customer, Total Qty, amount, optional date.
 * Used by Daily Visit and Orders screens.
 */
export default function OrderCard({ order, onPress }) {
  if (!order) return null;

  const state = order.state || 'draft';
  const totalQty = getOrderTotalQty(order);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(order)}
      activeOpacity={0.8}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.orderNo}>{order.name}</Text>
        <View style={[styles.badge, getStatusBadgeStyle(state)]}>
          <Text style={styles.badgeText}>{String(state).toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.customer} numberOfLines={1}>
        {order.partner_id?.[1] || '—'}
      </Text>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>Total Qty: {totalQty}</Text>
        <Text style={styles.amount}>{formatCurrency(order.amount_total)}</Text>
      </View>
      {order.date_order ? (
        <Text style={styles.date}>{order.date_order}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
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
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderNo: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeSale: { backgroundColor: colors.success },
  badgeDraft: { backgroundColor: colors.warning },
  badgeCancel: { backgroundColor: colors.error },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  customer: {
    fontSize: 15,
    color: colors.textSecondary,
    marginVertical: 6,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  date: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
});

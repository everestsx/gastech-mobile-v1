import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

export function getOrderTotalQty(order) {
  if (order?.totalQty != null && order.totalQty !== '') {
    return order.totalQty;
  }
  const lines = order?.order_line;
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.length;
  }
  return '—';
}

function getInvoiceStatusLabel(invoiceStatus) {
  if (!invoiceStatus) return null;
  switch (String(invoiceStatus)) {
    case 'invoiced':
      return 'Invoiced';
    case 'to invoice':
      return 'To invoice';
    case 'no':
      return 'No invoice';
    default:
      return invoiceStatus;
  }
}

/**
 * Reusable sale order card: order no, state badge, customer, amount with total qty below,
 * invoice status, date. Used by Daily Visit and Orders screens.
 */
export default function OrderCard({ order, onPress }) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
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
        orderNo: { fontSize: 16, fontWeight: '700', color: colors.text },
        badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
        badgeSale: { backgroundColor: colors.success },
        badgeDraft: { backgroundColor: colors.warning },
        badgeCancel: { backgroundColor: colors.error },
        badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
        customer: { fontSize: 15, color: colors.textSecondary, marginVertical: 6 },
        amountBlock: { alignItems: 'flex-end' },
        amount: { fontSize: 16, fontWeight: '800', color: colors.primary },
        totalQtyUnder: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
        footer: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.sm,
          paddingTop: spacing.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        invoiceBadge: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 10,
        },
        invoiceBadgeInvoiced: { backgroundColor: colors.primarySurface || '#e0e7ff' },
        invoiceBadgeToInvoice: { backgroundColor: colors.warning + '22' },
        invoiceBadgeText: { fontSize: 11, fontWeight: '600', color: colors.text },
        date: { fontSize: 12, color: colors.textSecondary },
      }),
    [colors]
  );

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

  function getInvoiceBadgeStyle(invoiceStatus) {
    return String(invoiceStatus) === 'invoiced'
      ? styles.invoiceBadgeInvoiced
      : styles.invoiceBadgeToInvoice;
  }

  if (!order) return null;

  const state = order.state || 'draft';
  const totalQty = getOrderTotalQty(order);
  const invoiceStatus = order.invoice_status;
  const invoiceLabel = getInvoiceStatusLabel(invoiceStatus);

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
        <View />
        <View style={styles.amountBlock}>
          <Text style={styles.amount}>{formatCurrency(order.amount_total)}</Text>
          <Text style={styles.totalQtyUnder}>
            Total qty: {typeof totalQty === 'number' ? totalQty : totalQty}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        {invoiceLabel ? (
          <View style={[styles.invoiceBadge, getInvoiceBadgeStyle(invoiceStatus)]}>
            <Ionicons
              name={invoiceStatus === 'invoiced' ? 'checkmark-circle' : 'document-text-outline'}
              size={14}
              color={colors.primary}
            />
            <Text style={styles.invoiceBadgeText}>{invoiceLabel}</Text>
          </View>
        ) : (
          <View style={styles.invoiceBadge}>
            <Text style={styles.invoiceBadgeText}>—</Text>
          </View>
        )}
        {order.date_order ? (
          <Text style={styles.date}>{order.date_order}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { formatAmount } from '../utils/format';
import { getUserSession } from '../services/sync.service';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as localPaymentsDb from '../database/localPayments.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';

export default function LocalInvoicesScreen({ navigation }) {
  const { colors, appLanguage } = useTheme();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');

  const loadInvoices = useCallback(async () => {
    try {
      const session = await getUserSession();
      setVehicleNumber(session?.licensePlate ?? session?.vehicleName ?? '');
      const list = await localInvoicesDb.getAllLocalInvoices(false);
      const enriched = await Promise.all(
        (list || []).map(async (inv) => {
          const order = await saleOrdersDb.getSaleOrderById(inv.sale_order_id);
          const split = await localPaymentsDb.getPaymentSplitBySaleOrderId(inv.sale_order_id);
          const partnerName = order
            ? getLocalizedCustomerNameFromOrder(order, appLanguage)
            : '—';
          const orderName = order?.name ?? `Order ${inv.sale_order_id}`;
          const dateOrder = order?.date_order ?? inv.created_at;
          const syncedAt = await syncQueueDb.getPaymentSyncedAtForSaleOrder(
            inv.sale_order_id
          );
          const cash = Number(split?.cash) || 0;
          const cheque = Number(split?.cheque) || 0;
          const credit = Number(split?.credit) || 0;
          const parts = [
            cash > 0 ? `Cash (${formatAmount(cash)})` : null,
            cheque > 0 ? `Cheque (${formatAmount(cheque)})` : null,
            credit > 0 ? `Credit (${formatAmount(credit)})` : null,
          ].filter(Boolean);
          const paymentModeLabel = parts.length ? parts.join(' • ') : 'Invoiced';
          return {
            ...inv,
            partnerName,
            orderName,
            dateOrder,
            uploadedToOdoo: syncedAt != null,
            syncedAt: syncedAt ?? null,
            paymentModeLabel,
            paymentSplit: split || { cash: 0, cheque: 0, credit: 0 },
          };
        })
      );
      setInvoices(enriched);
    } catch (e) {
      console.warn('LocalInvoicesScreen load', e?.message ?? e);
      setInvoices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appLanguage]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadInvoices();
  }, [loadInvoices]);

  const formatDate = (isoStr) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(isoStr).slice(0, 10);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: colors.text }]}>Invoices</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Invoices created on this device. Status shows if payment was uploaded to Odoo.
      </Text>

      {invoices.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={56} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No local invoices yet
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            Complete payment on an order to create a local invoice.
          </Text>
        </View>
      ) : (
        invoices.map((inv) => (
          <TouchableOpacity
            key={inv.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate('InvoiceScreen', {
                saleOrderId: inv.sale_order_id,
                total: inv.amount_total,
                invoiceNumber: inv.invoice_number,
                paymentType: 'split',
                paymentSplit: inv.paymentSplit,
              })
            }
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.invoiceNumber, { color: colors.primary }]} numberOfLines={1}>
                {vehicleNumber ? `${vehicleNumber}/${inv.invoice_number}` : inv.invoice_number}
              </Text>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: inv.uploadedToOdoo
                      ? (colors.success || '#059669') + '20'
                    : (colors.warning || '#d97706') + '20',
                    borderColor: inv.uploadedToOdoo
                      ? colors.success || '#059669'
                    : colors.warning || '#d97706',
                  },
                ]}
              >
                <Ionicons
                  name={inv.uploadedToOdoo ? 'cloud-done-outline' : 'cloud-upload-outline'}
                  size={14}
                  color={inv.uploadedToOdoo ? colors.success || '#059669' : colors.warning || '#d97706'}
                />
                <Text
                  style={[
                    styles.badgeText,
                    {
                      color: inv.uploadedToOdoo
                        ? colors.success || '#059669'
                        : colors.warning || '#d97706',
                    },
                  ]}
                >
                  {inv.uploadedToOdoo ? 'Uploaded' : 'Not yet uploaded'}
                </Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaBlock}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Invoice date</Text>
                <Text style={[styles.value, { color: colors.text }]}>{formatDate(inv.created_at)}</Text>
              </View>
              <View style={[styles.metaBlock, styles.metaBlockRight]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Order</Text>
                <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>{inv.orderName}</Text>
              </View>
            </View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Customer</Text>
            <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
              {inv.partnerName}
            </Text>
            <View style={styles.amountRow}>
              <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>Total</Text>
              <Text style={[styles.amountValue, { color: colors.text }]}>
                Rs. {formatAmount(inv.amount_total)}
              </Text>
            </View>
            <Text style={[styles.syncedAt, { color: colors.textSecondary }]}>
              Payment mode: {inv.paymentModeLabel}
            </Text>
            {inv.uploadedToOdoo && inv.syncedAt ? (
              <Text style={[styles.syncedAt, { color: colors.textSecondary }]}>
                Synced {formatDate(inv.syncedAt)}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl + 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: spacing.lg },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: { fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  emptyHint: { fontSize: 13, marginTop: 4 },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  invoiceNumber: { fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  metaRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  metaBlock: { flex: 1, minWidth: 0 },
  metaBlockRight: { marginLeft: spacing.sm },
  label: { fontSize: 11, marginBottom: 1 },
  value: { fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  amountLabel: { fontSize: 12 },
  amountValue: { fontSize: 15, fontWeight: '700' },
  syncedAt: { fontSize: 10, marginTop: 2 },
});

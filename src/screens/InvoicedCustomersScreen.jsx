import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getUserSession, getCachedOrders } from '../services/sync.service';
import * as partnersDb from '../database/partners.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';

/** Sale order is fully invoiced for listing: Odoo `invoice_status` = invoiced, or a mobile invoice already linked in Odoo. */
function isProvablyInvoicedForList(order, localInv) {
  const st = String(order?.invoice_status || '').toLowerCase();
  if (st === 'invoiced') return true;
  const oid = localInv?.odoo_invoice_id;
  const hasOdoo = oid != null && Number(oid) > 0;
  const hasSynced = localInv?.synced_at != null && String(localInv.synced_at).trim() !== '';
  return hasOdoo && hasSynced;
}

export default function InvoicedCustomersScreen() {
  const { t } = useTranslation();
  const { colors, appLanguage } = useTheme();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin ? null : user?.vehicleId ?? null;
      const [orders, partners, localInvoices] = await Promise.all([
        getCachedOrders(vehicleId),
        partnersDb.getAllPartners(),
        localInvoicesDb.getAllLocalInvoices(false),
      ]);
      const localInvoiceBySaleOrderId = new Map();
      for (const inv of localInvoices || []) {
        const sid = Number(inv?.sale_order_id);
        if (Number.isFinite(sid) && sid > 0) localInvoiceBySaleOrderId.set(sid, inv);
      }
      const phoneByPartnerId = {};
      for (const p of partners || []) {
        const id = Number(p?.id);
        if (Number.isFinite(id) && id > 0) {
          phoneByPartnerId[id] = String(p?.phone || '').trim();
        }
      }
      const partnerNameFallback = {};
      for (const p of partners || []) {
        const id = Number(p?.id);
        if (Number.isFinite(id) && id > 0) {
          partnerNameFallback[id] = String(p?.name || '').trim();
        }
      }

      const byPartnerId = new Map();
      for (const o of orders || []) {
        const soId = Number(o?.id);
        if (!Number.isFinite(soId) || soId <= 0) continue;
        const localInv = localInvoiceBySaleOrderId.get(soId);
        if (!isProvablyInvoicedForList(o, localInv)) continue;
        const partnerIdRaw = Array.isArray(o?.partner_id) ? o.partner_id[0] : o?.partner_id;
        const partnerId = Number(partnerIdRaw);
        if (!Number.isFinite(partnerId) || partnerId <= 0) continue;
        const customerName = getLocalizedCustomerNameFromOrder(o, appLanguage);
        const fromPartner = partnerNameFallback[partnerId] || '';
        const displayName =
          customerName && String(customerName).trim() && customerName !== '—'
            ? customerName
            : fromPartner || `—`;
        const phone = phoneByPartnerId[partnerId] || '';
        const orderDate =
          String(o?.commitment_date || '').trim() ||
          String(o?.date_order || '').trim() ||
          String(localInv?.created_at || '').trim() ||
          '';
        const orderTs = orderDate ? Date.parse(orderDate) : 0;
        if (!byPartnerId.has(partnerId)) {
          byPartnerId.set(partnerId, {
            partnerId,
            customerName: displayName,
            phone,
            invoicedOrders: 0,
            latestOrderTs: Number.isFinite(orderTs) ? orderTs : 0,
          });
        }
        const current = byPartnerId.get(partnerId);
        current.invoicedOrders += 1;
        if (displayName && current.customerName === '—') current.customerName = displayName;
        if (phone && !current.phone) current.phone = phone;
        if ((Number.isFinite(orderTs) ? orderTs : 0) > (current.latestOrderTs || 0)) {
          current.latestOrderTs = orderTs;
        }
      }

      const nextRows = Array.from(byPartnerId.values()).sort((a, b) => {
        const byRecent = (Number(b.latestOrderTs) || 0) - (Number(a.latestOrderTs) || 0);
        if (byRecent !== 0) return byRecent;
        return String(a.customerName || '').localeCompare(String(b.customerName || ''));
      });
      setRows(nextRows);
    } finally {
      setLoading(false);
    }
  }, [appLanguage]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.xl },
        hero: {
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
        heroTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
        heroSub: { marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.md,
          marginBottom: spacing.sm,
        },
        row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
        customerName: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
        chip: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: borderRadius.md,
          backgroundColor: colors.primary + '16',
          borderWidth: 1,
          borderColor: colors.primary + '44',
        },
        chipText: { fontSize: 12, fontWeight: '700', color: colors.primary },
        latestBadge: {
          marginTop: 10,
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: borderRadius.md,
          backgroundColor: (colors.success || '#16a34a') + '16',
          borderWidth: 1,
          borderColor: (colors.success || '#16a34a') + '44',
        },
        latestBadgeText: { fontSize: 12, fontWeight: '700', color: colors.success || '#15803d' },
        phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
        phoneText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
        emptyWrap: { paddingVertical: spacing.xl, alignItems: 'center' },
        emptyText: { marginTop: spacing.sm, fontSize: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
      }),
    [colors]
  );

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t('invoicedcustomers.title', 'Invoiced Customers')}</Text>
        <Text style={styles.heroSub}>
          {t('invoicedcustomers.subtitle', 'Only customers with completed invoiced orders are listed here.')}
        </Text>
      </View>

      {rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="receipt-outline" size={34} color={colors.textSecondary} />
          <Text style={styles.emptyText}>{t('invoicedcustomers.empty', 'No invoiced customers found yet.')}</Text>
        </View>
      ) : (
        rows.map((row, index) => (
          <View key={String(row.partnerId)} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.customerName}>{row.customerName || `#${row.partnerId}`}</Text>
              <View style={styles.chip}>
                <Text style={styles.chipText}>
                  {t('invoicedcustomers.ordersCount', '{{count}} orders', { count: Number(row.invoicedOrders) || 0 })}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.phoneRow}
              disabled={!row.phone}
              onPress={() => row.phone && Linking.openURL(`tel:${String(row.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}
              activeOpacity={0.85}
            >
              <Ionicons name="call-outline" size={18} color={colors.primary} />
              <Text style={styles.phoneText}>{row.phone || t('invoicedcustomers.noPhone', 'No phone number')}</Text>
            </TouchableOpacity>
            {index === 0 ? (
              <View style={styles.latestBadge}>
                <Ionicons name="sparkles-outline" size={14} color={colors.success || '#15803d'} />
                <Text style={styles.latestBadgeText}>{t('invoicedcustomers.latest', 'Most recent invoiced customer')}</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

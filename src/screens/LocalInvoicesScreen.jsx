import { useTranslation } from 'react-i18next';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  TextInput,
  Modal,
  Pressable,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { formatAmount } from '../utils/format';
import { getUserSession } from '../services/sync.service';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as localPaymentsDb from '../database/localPayments.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import { useSync } from '../context/SyncContext';
import { formatLocalYyyyMmDd, invoiceMatchesLocalDate, isLocalToday } from '../utils/localDate';

/** UI-only: instant My Invoices tab when switching back (not sync state). */
let lastLocalInvoicesSnapshot = null;

/** Compact completion time for list cards. */
function formatCompletedAtCompact(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr).slice(0, 16);
    const date = d.toLocaleDateString('en-LK', { day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${time} · ${date}`;
  } catch {
    return '—';
  }
}

function displayInvoiceNumber(inv, vehicleNumber) {
  const num = String(inv.invoice_number || '').trim();
  if (num.includes('/')) return num;
  if (vehicleNumber && num) return `${vehicleNumber}/${num}`;
  return num || '—';
}

export default function LocalInvoicesScreen({ navigation }) {
  const { t } = useTranslation();
  const { colors, appLanguage } = useTheme();
  const insets = useSafeAreaInsets();
  const [invoices, setInvoices] = useState(() => lastLocalInvoicesSnapshot?.invoices ?? []);
  const [loading, setLoading] = useState(() => !(lastLocalInvoicesSnapshot?.invoices?.length > 0));
  const hasListDataRef = useRef((lastLocalInvoicesSnapshot?.invoices?.length ?? 0) > 0);
  const [refreshing, setRefreshing] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('customer');
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const { syncCompleteTimestamp } = useSync();

  const primary = colors.primary ?? '#6366f1';
  const success = colors.success ?? '#059669';
  const warning = colors.warning ?? '#d97706';

  const searchFieldLabels = {
    customer: t('localinvoices.searchCustomer', 'Customer'),
    invoice: t('localinvoices.searchInvoice', 'Invoice'),
  };

  const loadInvoices = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true;
    if (!silent && !hasListDataRef.current) setLoading(true);
    try {
      const session = await getUserSession();
      const license = session?.licensePlate ?? session?.vehicleName ?? '';
      setVehicleNumber(license);
      /** Same rule as Orders tab: vehicle login sees only this vehicle's data. */
      const vehicleId = session?.isAdmin === false ? session?.vehicleId : null;
      const vid =
        vehicleId != null && Number.isFinite(Number(vehicleId)) ? Number(vehicleId) : null;

      const list =
        vid != null
          ? await localInvoicesDb.getLocalInvoicesForVehicle(vid, false)
          : await localInvoicesDb.getAllLocalInvoices(false);

      const soIds = (list || []).map((inv) => Number(inv.sale_order_id)).filter((id) => id > 0);
      const [paymentBySo, ordersById, splitsBySo, syncedAtBySo] = await Promise.all([
        syncQueueDb.getLatestPaymentPayloadMapBySaleOrderIds(soIds).catch(() => ({})),
        saleOrdersDb.getSaleOrdersByIds(soIds).catch(() => ({})),
        localPaymentsDb.getPaymentSplitsBySaleOrderIds(soIds).catch(() => ({})),
        syncQueueDb.getPaymentSyncedAtMapBySaleOrderIds(soIds).catch(() => ({})),
      ]);

      const enriched = [];
      for (const inv of list || []) {
        const order = ordersById[Number(inv.sale_order_id)];
        if (!order) continue;
        const orderVehicleId = Array.isArray(order.vehicle_id)
          ? Number(order.vehicle_id[0])
          : Number(order.vehicle_id);
        if (vid != null && Number.isFinite(orderVehicleId) && orderVehicleId !== vid) {
          continue;
        }

        const split = splitsBySo[Number(inv.sale_order_id)] || splitsBySo[inv.sale_order_id];
        const partnerName = getLocalizedCustomerNameFromOrder(order, appLanguage);
        const orderName = order?.name ?? `Order ${inv.sale_order_id}`;
        const syncedAt = syncedAtBySo[Number(inv.sale_order_id)] ?? null;
        const cash = Number(split?.cash) || 0;
        const cheque = Number(split?.cheque) || 0;
        const credit = Number(split?.credit) || 0;
        const plateForDisplay =
          license ||
          (Array.isArray(order.vehicle_id) ? order.vehicle_id[1] : order.vehicle_name) ||
          '';
        const payPayload = paymentBySo[Number(inv.sale_order_id)]?.payload || {};
        /** Driver who completed this order — not whoever is logged in now. */
        const driverName =
          (inv.driver_name && String(inv.driver_name).trim()) ||
          (payPayload.driverName && String(payPayload.driverName).trim()) ||
          '—';
        enriched.push({
          ...inv,
          partnerName,
          orderName,
          driverName,
          invoiceDisplay: displayInvoiceNumber(inv, plateForDisplay),
          uploadedToOdoo: syncedAt != null,
          completedAtLine: formatCompletedAtCompact(inv.created_at),
          paymentSplit: split || { cash: 0, cheque: 0, credit: 0 },
          hasCash: cash > 0,
          hasCheque: cheque > 0,
          hasCredit: credit > 0,
          cash,
          cheque,
          credit,
        });
      }
      hasListDataRef.current = enriched.length > 0;
      setInvoices(enriched);
      lastLocalInvoicesSnapshot = { invoices: enriched, vehicleNumber: license };
    } catch (e) {
      console.warn('LocalInvoicesScreen load', e?.message ?? e);
      if (!hasListDataRef.current) setInvoices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appLanguage]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => loadInvoices({ silent: true }));
    return () => unsub?.();
  }, [loadInvoices, navigation]);

  useEffect(() => {
    if (syncCompleteTimestamp > 0) loadInvoices({ silent: true });
  }, [syncCompleteTimestamp, loadInvoices]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadInvoices();
  }, [loadInvoices]);

  const dateStr = formatLocalYyyyMmDd(selectedDate);
  const invoicesForDate = useMemo(
    () =>
      [...invoices.filter((inv) => invoiceMatchesLocalDate(inv, dateStr))].sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
      ),
    [invoices, dateStr]
  );

  const invoicesFiltered = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return invoicesForDate;
    return invoicesForDate.filter((inv) => {
      if (searchField === 'invoice') {
        return String(inv.invoiceDisplay || inv.invoice_number || '').toLowerCase().includes(q);
      }
      return String(inv.partnerName || '').toLowerCase().includes(q);
    });
  }, [invoicesForDate, searchQuery, searchField]);

  const canGoToNextDay = !isLocalToday(selectedDate);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerBtn: { padding: 4, minWidth: 40 },
        dateNav: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
        dateNavText: { fontSize: 15, fontWeight: '600', color: colors.text },
        countPill: {
          minWidth: 28,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: 8,
          backgroundColor: primary + '18',
          borderWidth: 1,
          borderColor: primary + '40',
          alignItems: 'center',
        },
        countPillText: { fontSize: 12, fontWeight: '800', color: primary },
        searchRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        },
        searchInput: {
          flex: 1,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing.sm,
          paddingVertical: 8,
          fontSize: 14,
          color: colors.text,
          backgroundColor: colors.background,
        },
        searchFieldBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: spacing.sm,
          paddingVertical: 8,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          maxWidth: 110,
        },
        searchFieldBtnText: { fontSize: 12, fontWeight: '600', color: colors.text },
        dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
        dropdownMenu: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, overflow: 'hidden' },
        dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
        dropdownItemText: { fontSize: 15, fontWeight: '500', color: colors.text },
        list: { paddingHorizontal: spacing.sm, paddingTop: 6, paddingBottom: spacing.xl + 32 },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        empty: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
        emptyText: { fontSize: 14, fontWeight: '600', marginTop: spacing.sm, color: colors.textSecondary, textAlign: 'center' },
        card: {
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          marginBottom: 9,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 3,
          elevation: 2,
        },
        cardPending: {
          borderColor: warning + '55',
        },
        cardAccent: { height: 3, backgroundColor: primary },
        cardAccentPending: { backgroundColor: warning || '#d97706' },
        cardBody: { paddingHorizontal: 11, paddingVertical: 9 },
        rowTop: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        },
        timeText: { fontSize: 12, fontWeight: '700', color: colors.text, flex: 1, marginRight: 6 },
        syncBadge: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 8,
          borderWidth: 1,
        },
        syncBadgeText: { fontSize: 9, fontWeight: '700' },
        rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
        mainCol: { flex: 1, minWidth: 0 },
        invoiceNumber: { fontSize: 12, fontWeight: '700', color: primary },
        customerName: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 3 },
        metaLine: { fontSize: 11, color: colors.textSecondary, marginTop: 4, lineHeight: 16 },
        amountCol: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 2 },
        amountValue: { fontSize: 16, fontWeight: '800', color: colors.text },
      }),
    [colors, insets.top, primary]
  );

  if (loading && invoices.length === 0) {
    return (
      <View style={[styles.center, styles.container]}>
        <ActivityIndicator size="large" color={primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={primary} />
        </TouchableOpacity>
        <View style={styles.dateNav}>
          <TouchableOpacity
            onPress={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d);
            }}
          >
            <Ionicons name="chevron-back" size={22} color={primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowPicker(true)}>
            <Text style={styles.dateNavText}>{dateStr}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!canGoToNextDay}
            onPress={() => {
              if (!canGoToNextDay) return;
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d);
            }}
            style={{ opacity: canGoToNextDay ? 1 : 0.35 }}
          >
            <Ionicons name="chevron-forward" size={22} color={primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{invoicesFiltered.length}</Text>
        </View>
      </View>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') setShowPicker(false);
            if (date) setSelectedDate(date);
          }}
        />
      )}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={`Search by ${searchFieldLabels[searchField]?.toLowerCase() || 'customer'}…`}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
        />
        <TouchableOpacity
          style={styles.searchFieldBtn}
          onPress={() => setShowFieldDropdown(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchFieldBtnText} numberOfLines={1}>
            {searchFieldLabels[searchField]}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={showFieldDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFieldDropdown(false)}
      >
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowFieldDropdown(false)}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => {
                setSearchField('customer');
                setShowFieldDropdown(false);
              }}
            >
              <Ionicons name="person-outline" size={20} color={primary} />
              <Text style={styles.dropdownItemText}>{t('localinvoices.customer', 'Customer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => {
                setSearchField('invoice');
                setShowFieldDropdown(false);
              }}
            >
              <Ionicons name="receipt-outline" size={20} color={primary} />
              <Text style={styles.dropdownItemText}>{t('localinvoices.searchInvoice', 'Invoice no.')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <FlatList
        data={invoicesFiltered}
        keyExtractor={(item) => String(item.id)}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[primary]} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              {searchQuery.trim()
                ? t('localinvoices.noMatch', 'No invoices match your search')
                : t('localinvoices.noInvoicesOnDate', 'No local invoices on this date')}
            </Text>
          </View>
        }
        renderItem={({ item: inv }) => {
          const uploaded = inv.uploadedToOdoo;
          const badgeColor = uploaded ? success : warning;
          const payTags = [];
          if (inv.hasCash) payTags.push(`Cash ${formatAmount(inv.cash)}`);
          if (inv.hasCheque) payTags.push(`Chq ${formatAmount(inv.cheque)}`);
          if (inv.hasCredit) payTags.push(`Cr ${formatAmount(inv.credit)}`);

          const metaParts = [];
          if (inv.driverName && inv.driverName !== '—') {
            metaParts.push(`${t('localinvoices.driver', 'Driver')}: ${inv.driverName}`);
          }
          metaParts.push(inv.orderName);
          if (payTags.length) metaParts.push(payTags.join(' · '));

          return (
            <TouchableOpacity
              style={[styles.card, !uploaded && styles.cardPending]}
              activeOpacity={0.85}
              onPress={() =>
                navigation.navigate('InvoiceScreen', {
                  saleOrderId: inv.sale_order_id,
                  total: inv.amount_total,
                  subtotal: inv.amount_untaxed,
                  tax: inv.amount_tax,
                  fromLocalInvoices: true,
                  readOnlyView: true,
                  invoiceNumber: inv.invoice_number,
                  paymentType: 'split',
                  paymentSplit: inv.paymentSplit,
                })
              }
            >
              <View style={[styles.cardAccent, !uploaded && styles.cardAccentPending]} />
              <View style={styles.cardBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.timeText} numberOfLines={1}>
                    {inv.completedAtLine}
                  </Text>
                  <View
                    style={[
                      styles.syncBadge,
                      { backgroundColor: badgeColor + '18', borderColor: badgeColor + '50' },
                    ]}
                  >
                    <Ionicons
                      name={uploaded ? 'cloud-done' : 'cloud-upload-outline'}
                      size={10}
                      color={badgeColor}
                    />
                    <Text style={[styles.syncBadgeText, { color: badgeColor }]}>
                      {uploaded
                        ? t('localinvoices.uploaded', 'Uploaded')
                        : t('localinvoices.pending', 'Pending')}
                    </Text>
                  </View>
                </View>

                <View style={styles.rowMain}>
                  <View style={styles.mainCol}>
                    <Text style={styles.invoiceNumber} numberOfLines={1}>
                      {inv.invoiceDisplay}
                    </Text>
                    <Text style={styles.customerName} numberOfLines={1}>
                      {inv.partnerName}
                    </Text>
                    <Text style={styles.metaLine} numberOfLines={2}>
                      {metaParts.join(' · ')}
                    </Text>
                  </View>
                  <View style={styles.amountCol}>
                    <Text style={styles.amountValue}>{formatAmount(inv.amount_total)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={primary} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

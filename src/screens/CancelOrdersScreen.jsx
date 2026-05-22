import { useTranslation } from 'react-i18next';
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  TextInput,
  Modal,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedCancelledOrders,
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import * as syncQueueDb from '../database/syncQueue.js';
import { useSync } from '../context/SyncContext';

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isToday(d) {
  return formatDate(d) === formatDate(new Date());
}

export default function CancelOrdersScreen({ navigation }) {
  const { t } = useTranslation();
  const { colors, syncDateField } = useTheme();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('customer');
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const { syncCompleteTimestamp } = useSync();

  const searchFieldLabels = { customer: 'Customer', orderId: 'Order ID' };

  const ordersFilteredBySearch = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      if (searchField === 'customer') {
        const name = o.partner_id?.[1] ? String(o.partner_id[1]) : '';
        return name.toLowerCase().includes(q);
      }
      const name = o.name ? String(o.name) : '';
      return name.toLowerCase().includes(q);
    });
  }, [orders, searchQuery, searchField]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerLeft: { flex: 1, minWidth: 0 },
        headerCenter: { flex: 1, alignItems: 'center', minWidth: 0 },
        headerRight: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: spacing.sm,
          minWidth: 0,
        },
        headerBtn: { padding: 4, minWidth: 40 },
        dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        dateNavText: { fontSize: 16, fontWeight: '600', color: colors.text },
        dateNavChevronDisabled: { opacity: 0.35 },
        countPill: {
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 10,
          backgroundColor: colors.primary + '18',
          borderWidth: 1,
          borderColor: colors.primary + '40',
        },
        countPillText: { fontSize: 13, fontWeight: '700', color: colors.primary },
        doneDateBtn: { padding: 10, alignItems: 'center', backgroundColor: colors.surface },
        doneDateText: { fontSize: 16, fontWeight: '600', color: colors.primary },
        searchRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
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
          paddingHorizontal: spacing.md,
          paddingVertical: 10,
          fontSize: 15,
          color: colors.text,
          backgroundColor: colors.background,
        },
        searchFieldBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: spacing.sm,
          paddingVertical: 10,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          maxWidth: 120,
        },
        searchFieldBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
        dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
        dropdownMenu: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, overflow: 'hidden' },
        dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
        dropdownItemText: { fontSize: 15, fontWeight: '500', color: colors.text },
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12, textAlign: 'center' },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
      }),
    [colors, insets.top]
  );

  const loadOrders = useCallback(async () => {
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const data = await getCachedCancelledOrders(vehicleId);
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      const list = all.filter((o) => {
        const selectedDateValue =
          syncDateField === 'delivery_date'
            ? o.commitment_date || o.date_order
            : o.date_order || o.commitment_date;
        return String(selectedDateValue || '').startsWith(dateStr);
      });

      const orderIds = list.map((o) => o.id);
      const pendingCancelIds = new Set();
      const pending = await syncQueueDb.getPending().catch(() => []);
      for (const row of pending || []) {
        if (row.action_type !== syncQueueDb.ACTION_CANCEL_ORDER) continue;
        const soId = Number((row.payload || {}).saleOrderId ?? (row.payload || {}).sale_order_id);
        if (Number.isFinite(soId) && soId > 0) pendingCancelIds.add(soId);
      }

      const [totals, pickings, allLines] = await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
      ]);

      const saleIdToPickingState = {};
      (pickings || []).forEach((p) => {
        const saleId = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
        if (saleId != null) saleIdToPickingState[saleId] = p.state;
      });

      const linesByOrderId = {};
      (allLines || []).forEach((line) => {
        const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
        if (oid != null) {
          if (!linesByOrderId[oid]) linesByOrderId[oid] = [];
          linesByOrderId[oid].push(line);
        }
      });

      setOrders(
        list.map((o) => ({
          ...o,
          state: 'cancel',
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          pickingState: saleIdToPickingState[o.id] ?? 'cancel',
          orderLines: linesByOrderId[o.id] || [],
          deliveryBannerText: pendingCancelIds.has(Number(o.id))
            ? t('cancelOrders.pendingBackOffice', 'Cancel pending upload to back office')
            : null,
        }))
      );
    } catch (err) {
      console.warn('CancelOrdersScreen load', err);
      setOrders([]);
    }
  }, [selectedDate, syncDateField, t]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    return () => unsub?.();
  }, [loadOrders, navigation]);

  useEffect(() => {
    if (syncCompleteTimestamp > 0) loadOrders();
  }, [syncCompleteTimestamp, loadOrders]);

  const canGoToNextDay = !isToday(selectedDate);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
              <Ionicons name="arrow-back" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerCenter}>
            <View style={styles.dateNav}>
              <TouchableOpacity
                onPress={() => {
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(d);
                }}
              >
                <Ionicons name="chevron-back" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPicker(true)}>
                <Text style={styles.dateNavText}>{formatDate(selectedDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!canGoToNextDay}
                onPress={() => {
                  if (!canGoToNextDay) return;
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() + 1);
                  setSelectedDate(d);
                }}
                style={!canGoToNextDay ? styles.dateNavChevronDisabled : undefined}
              >
                <Ionicons name="chevron-forward" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.headerRight}>
            <SyncHeaderBadge variant="surface" />
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{ordersFilteredBySearch.length}</Text>
            </View>
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
        {showPicker && Platform.OS === 'ios' && (
          <TouchableOpacity style={styles.doneDateBtn} onPress={() => setShowPicker(false)}>
            <Text style={styles.doneDateText}>{t('saleorderlist.done', 'Done')}</Text>
          </TouchableOpacity>
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
            <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
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
                <Ionicons name="person-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('saleorderlist.customerName', 'Customer name')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setSearchField('orderId');
                  setShowFieldDropdown(false);
                }}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('saleorderlist.orderID', 'Order ID')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

        <FlatList
          data={ordersFilteredBySearch}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="ban-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>
                {t('cancelOrders.noCancelledOnDate', 'No cancelled orders on this date')}
              </Text>
              <Text style={styles.emptyHint}>
                {t('cancelOrders.emptyHint', 'Cancelled orders appear here after you cancel from the Orders tab.')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              orderLines={item.orderLines}
              onPress={() => navigation.navigate('SaleOrderDetails', { saleOrderId: item.id })}
              isDelivered
              deliveryBannerText={item.deliveryBannerText}
            />
          )}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

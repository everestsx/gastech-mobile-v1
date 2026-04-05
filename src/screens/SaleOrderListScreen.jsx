import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getCachedCustomers,
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import * as deliveryQtyDb from '../database/deliveryQty.js';
import { getCheckoutResumeMap } from '../services/checkoutResume.service';

const TAB_TO_DELIVER = 'to_deliver';

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isToday(d) {
  const today = formatDate(new Date());
  return formatDate(d) === today;
}

export default function SaleOrderListScreen({ route, navigation }) {
  const { colors, syncDateField } = useTheme();
  const insets = useSafeAreaInsets();
  const customerId = route?.params?.customerId ?? null;
  const customerNameFromParams = route?.params?.customerName ?? null;
  const scannedDateParam = route?.params?.scannedDate ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => {
    if (scannedDateParam) {
      const d = new Date(scannedDateParam + 'T12:00:00');
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  });
  const [customerNameForEmpty, setCustomerNameForEmpty] = useState(customerNameFromParams ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('customer');
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const [checkoutResumeMap, setCheckoutResumeMap] = useState({});
  // Orders tab: hide once invoiced or delivered — unless checkout (invoice / payment photo) is still in progress.
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (String(o.state || '') === 'cancel') return false;
        const rid = String(o.id);
        if (checkoutResumeMap[rid]?.invoiceParams) return true;
        const inv = String(o.invoice_status || '').toLowerCase() === 'invoiced';
        const st = String(o.pickingState || '').toLowerCase();
        const q = Number(o.qtyDoneSum) || 0;
        return !(inv || st === 'done' || st === 'cancel' || q > 0);
      }),
    [orders, checkoutResumeMap]
  );
  const searchFieldLabels = { customer: 'Customer', orderId: 'Order ID' };
  const ordersFilteredBySearch = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return filteredOrders;
    return filteredOrders.filter((o) => {
      if (searchField === 'customer') {
        const name = (o.partner_id && o.partner_id[1]) ? String(o.partner_id[1]) : '';
        return name.toLowerCase().includes(q);
      }
      if (searchField === 'orderId') {
        const name = o.name ? String(o.name) : '';
        return name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filteredOrders, searchQuery, searchField]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
        },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
        headerLeft: {
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
        },
        headerCenter: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        countPill: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 10,
          backgroundColor: colors.primary + '18',
          borderWidth: 1,
          borderColor: colors.primary + '40',
        },
        countPillText: { fontSize: 13, fontWeight: '700', color: colors.primary },
        headerRight: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          minWidth: 0,
          gap: spacing.sm,
        },
        headerBtn: { padding: 4, minWidth: 40, alignItems: 'flex-start' },
        headerBtnRight: { alignItems: 'flex-end' },
        dateNav: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingVertical: 4,
          paddingHorizontal: 8,
        },
        dateNavText: { fontSize: 16, fontWeight: '600', color: colors.text },
        dateNavDateTouch: { paddingVertical: 4, paddingHorizontal: 6 },
        dateNavChevron: { padding: 4 },
        dateNavChevronDisabled: { opacity: 0.35 },
        doneDateBtn: {
          padding: 10,
          alignItems: 'center',
          backgroundColor: colors.surface,
        },
        doneDateText: { fontSize: 16, fontWeight: '600', color: colors.primary },
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
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
          height: 40,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing.md,
          fontSize: 15,
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
        },
        searchFieldBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          height: 40,
          paddingHorizontal: spacing.sm,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 4,
        },
        searchFieldBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
        dropdownModal: {
          flex: 1,
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          paddingTop: 100,
          paddingRight: spacing.md,
        },
        dropdownBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
        dropdownMenu: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          minWidth: 140,
        },
        dropdownItem: {
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        dropdownItemText: { fontSize: 15, fontWeight: '500', color: colors.text },
      }),
    [colors]
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const [data, cachedCustomers, resumeMap] = await Promise.all([
        getCachedOrders(vehicleId),
        customerId != null ? getCachedCustomers() : Promise.resolve([]),
        getCheckoutResumeMap(),
      ]);
      setCheckoutResumeMap(resumeMap && typeof resumeMap === 'object' ? resumeMap : {});
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      let list = all.filter((o) => {
        const selectedDateValue = syncDateField === 'delivery_date'
          ? (o.commitment_date || o.date_order)
          : (o.date_order || o.commitment_date);
        return String(selectedDateValue || '').startsWith(dateStr);
      });
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
        const partner = Array.isArray(cachedCustomers)
          ? cachedCustomers.find((c) => c.id === customerId)
          : null;
        if (partner?.name) setCustomerNameForEmpty((prev) => prev || partner.name);
      }
      const orderIds = list.map((o) => o.id);
      const [totals, pickings, allLines, qtyDoneMap] = await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
        orderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds) : Promise.resolve({}),
      ]);
      const saleIdToPickingState = {};
      (pickings || []).forEach((p) => {
        const saleId = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
        if (saleId != null) {
          if (p.state === 'done') saleIdToPickingState[saleId] = 'done';
          else if (saleIdToPickingState[saleId] !== 'done') saleIdToPickingState[saleId] = p.state;
        }
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
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          pickingState: saleIdToPickingState[o.id] ?? '',
          qtyDoneSum: Number(qtyDoneMap?.[o.id]) || 0,
          isDelivered: saleIdToPickingState[o.id] === 'done',
          orderLines: linesByOrderId[o.id] || [],
        }))
      );
    } catch (err) {
      console.error('Sale Order Error:', err);
      setOrders([]);
      setCheckoutResumeMap({});
    } finally {
      setLoading(false);
    }
  }, [customerId, selectedDate, syncDateField]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (customerNameFromParams) setCustomerNameForEmpty((prev) => prev || customerNameFromParams);
  }, [customerNameFromParams]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    return () => unsub?.();
  }, [loadOrders, navigation]);

  const canGoToNextDay = !isToday(selectedDate);

  const goToPreviousDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };

  const goToNextDay = () => {
    if (!canGoToNextDay) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
  };

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) setSelectedDate(date);
  };

  const onBackPress = () => {
    if (customerId != null) {
      navigation.navigate('Orders', { customerId: null });
    } else {
      navigation.navigate('Dashboard');
    }
  };

  const onOrderPress = (order) => {
    const entry = checkoutResumeMap[String(order.id)];
    if (entry?.invoiceParams) {
      if (entry.phase === 'payment_proof') {
        navigation.navigate('PaymentProof', {
          saleOrderId: order.id,
          creditProofRequired: entry.invoiceParams.creditProofRequired === true,
          orderName: entry.invoiceParams.orderName,
        });
        return;
      }
      navigation.navigate('InvoiceScreen', entry.invoiceParams);
      return;
    }
    navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header: back (to Dashboard), date navigator (center, tap = calendar), QR (right) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onBackPress} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <View style={styles.dateNav}>
            <TouchableOpacity
              onPress={goToPreviousDay}
              style={styles.dateNavChevron}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateNavDateTouch}
              onPress={() => setShowPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dateNavText}>{formatDate(selectedDate)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goToNextDay}
              disabled={!canGoToNextDay}
              style={[styles.dateNavChevron, !canGoToNextDay && styles.dateNavChevronDisabled]}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.headerRight, { flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }]}>
          <SyncHeaderBadge variant="surface" />
        <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {ordersFilteredBySearch.length}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('ScanQRCode')}
            style={[styles.headerBtn, styles.headerBtnRight]}
          >
            <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
          </TouchableOpacity>
          
        </View>
      </View>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, date) => {
            onDateChange(e, date);
            if (Platform.OS === 'ios') setShowPicker(false);
          }}
        />
      )}
      {showPicker && Platform.OS === 'ios' && (
        <TouchableOpacity style={styles.doneDateBtn} onPress={() => setShowPicker(false)}>
          <Text style={styles.doneDateText}>Done</Text>
        </TouchableOpacity>
      )}

      {/* Search: input (left) + field selector dropdown (right) */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={`Search by ${searchFieldLabels[searchField]?.toLowerCase() || 'customer'}…`}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={styles.searchFieldBtn}
          onPress={() => setShowFieldDropdown(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchFieldBtnText} numberOfLines={1}>
            {searchFieldLabels[searchField] || 'Field'}
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
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownMenu}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => { setSearchField('customer'); setShowFieldDropdown(false); }}
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>Customer name</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => { setSearchField('orderId'); setShowFieldDropdown(false); }}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>Order ID</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <FlatList
        data={ordersFilteredBySearch}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              {searchQuery.trim()
                ? 'No orders match your search'
                : customerId != null
                  ? `There are no order details for ${customerNameForEmpty || 'this customer'}.`
                  : 'No orders to deliver'}
            </Text>
            <Text style={styles.emptyHint}>
              {searchQuery.trim()
                ? 'Try a different search or clear the search box'
                : customerId != null
                  ? 'Orders for this date will appear here after sync, or try another date.'
                  : 'Orders for this date will appear here after sync'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            orderLines={item.orderLines}
            onPress={onOrderPress}
            isDelivered={false}
            checkoutResumePhase={checkoutResumeMap[String(item.id)]?.phase ?? null}
          />
        )}
      />
    </View>
  );
}

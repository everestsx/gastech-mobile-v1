import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';

const TAB_CASH = 'cash';
const TAB_CHEQUE = 'cheque';
const TAB_CREDIT = 'credit';
const TAB_ALL = 'all';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function isToday(d) {
  const today = formatDate(new Date());
  return formatDate(d) === today;
}

export default function DeliveredOrdersScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState(TAB_CASH);

  const deliveredOrders = useMemo(
    () => orders.filter((o) => o.isDelivered),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    if (activeTab === TAB_CASH) return deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'cash');
    if (activeTab === TAB_CHEQUE) return deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'cheque');
    if (activeTab === TAB_CREDIT) return deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'credit');
    if (activeTab === TAB_ALL) return deliveredOrders;
    return deliveredOrders;
  }, [deliveredOrders, activeTab]);

  const tabCounts = useMemo(
    () => ({
      [TAB_CASH]: deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'cash').length,
      [TAB_CHEQUE]: deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'cheque').length,
      [TAB_CREDIT]: deliveredOrders.filter((o) => (o.payment_type || '').toLowerCase() === 'credit').length,
      [TAB_ALL]: deliveredOrders.length,
    }),
    [deliveredOrders]
  );

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
        headerLeft: { flex: 1, minWidth: 0 },
        headerCenter: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        headerRight: { flex: 1, minWidth: 0 },
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
        tabsWrap: {
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tabsScroll: {
          flexDirection: 'row',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        },
        tab: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.lg,
          backgroundColor: colors.background,
        },
        tabActive: { backgroundColor: colors.primary },
        tabText: { fontSize: 14, fontWeight: '600', color: colors.text },
        tabTextActive: { color: '#fff' },
        tabBadge: {
          minWidth: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
        },
        tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
        tabBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
        tabBadgeTextActive: { color: '#fff' },
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
      }),
    [colors, insets.top]
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const data = await getCachedOrders(vehicleId);
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      const list = all.filter((o) => (o.date_order || '').startsWith(dateStr));
      const orderIds = list.map((o) => o.id);
      const [totals, pickings, allLines] = await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
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
          isDelivered: saleIdToPickingState[o.id] === 'done',
          orderLines: linesByOrderId[o.id] || [],
        }))
      );
    } catch (err) {
      console.error('Delivered Orders Error:', err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

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

  const onOrderPress = (order) => {
    navigation.navigate('InvoiceScreen', {
      saleOrderId: order.id,
      total: order.amount_total,
    });
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
      <View style={styles.header}>
        <View style={styles.headerLeft} />
        <View style={styles.headerCenter}>
          <View style={styles.dateNav}>
            <TouchableOpacity onPress={goToPreviousDay} style={styles.dateNavChevron} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateNavDateTouch} onPress={() => setShowPicker(true)} activeOpacity={0.7}>
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
        <View style={styles.headerRight} />
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

      <View style={styles.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScroll}
        >
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CASH && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CASH)}
            activeOpacity={0.8}
          >
            <Ionicons name="cash-outline" size={18} color={activeTab === TAB_CASH ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CASH && styles.tabTextActive]}>Cash</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CASH && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CASH && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CASH]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CHEQUE && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CHEQUE)}
            activeOpacity={0.8}
          >
            <Ionicons name="card-outline" size={18} color={activeTab === TAB_CHEQUE ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CHEQUE && styles.tabTextActive]}>Cheque</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CHEQUE && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CHEQUE && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CHEQUE]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CREDIT && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CREDIT)}
            activeOpacity={0.8}
          >
            <Ionicons name="wallet-outline" size={18} color={activeTab === TAB_CREDIT ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CREDIT && styles.tabTextActive]}>Credit</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CREDIT && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CREDIT && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CREDIT]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_ALL && styles.tabActive]}
            onPress={() => setActiveTab(TAB_ALL)}
            activeOpacity={0.8}
          >
            <Ionicons name="list-outline" size={18} color={activeTab === TAB_ALL ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_ALL && styles.tabTextActive]}>All</Text>
            <View style={[styles.tabBadge, activeTab === TAB_ALL && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_ALL && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_ALL]}
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name={activeTab === TAB_ALL ? 'checkmark-done-outline' : activeTab === TAB_CASH ? 'cash-outline' : activeTab === TAB_CHEQUE ? 'card-outline' : 'wallet-outline'}
              size={48}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyText}>
              {activeTab === TAB_ALL
                ? 'No delivered orders for this date'
                : `No delivered orders paid by ${activeTab === TAB_CASH ? 'Cash' : activeTab === TAB_CHEQUE ? 'Cheque' : 'Credit'} for this date`}
            </Text>
            <Text style={styles.emptyHint}>Delivered & paid orders appear here after payment</Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={onOrderPress} isDelivered={true} />
        )}
      />
    </View>
  );
}

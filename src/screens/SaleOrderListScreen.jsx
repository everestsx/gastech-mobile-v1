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
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';

const TAB_ALL = 'all';
const TAB_TO_DELIVER = 'to_deliver';
const TAB_DELIVERED = 'delivered';
const TAB_INVOICED = 'invoiced';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function isToday(d) {
  const today = formatDate(new Date());
  return formatDate(d) === today;
}

export default function SaleOrderListScreen({ route, navigation }) {
  const { colors } = useTheme();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState(TAB_TO_DELIVER);

  const isInvoiced = (o) => String(o.invoice_status || '') === 'invoiced';

  const filteredOrders = useMemo(() => {
    if (activeTab === TAB_TO_DELIVER) return orders.filter((o) => !o.isDelivered);
    if (activeTab === TAB_DELIVERED) return orders.filter((o) => o.isDelivered);
    if (activeTab === TAB_INVOICED) return orders.filter(isInvoiced);
    return orders;
  }, [orders, activeTab]);

  const tabCounts = useMemo(
    () => ({
      [TAB_ALL]: orders.length,
      [TAB_TO_DELIVER]: orders.filter((o) => !o.isDelivered).length,
      [TAB_DELIVERED]: orders.filter((o) => o.isDelivered).length,
      [TAB_INVOICED]: orders.filter(isInvoiced).length,
    }),
    [orders]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
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
        headerRight: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          minWidth: 0,
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
        tabActive: {
          backgroundColor: colors.primary,
        },
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
    [colors]
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCachedOrders();
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      let list = all.filter((o) => (o.date_order || '').startsWith(dateStr));
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
      }
      const [totals, pickings] = await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(list.map((o) => o.id)),
      ]);
      const saleIdToPickingState = {};
      (pickings || []).forEach((p) => {
        const saleId = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
        if (saleId != null) {
          if (p.state === 'done') saleIdToPickingState[saleId] = 'done';
          else if (saleIdToPickingState[saleId] !== 'done') saleIdToPickingState[saleId] = p.state;
        }
      });
      setOrders(
        list.map((o) => ({
          ...o,
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          isDelivered: saleIdToPickingState[o.id] === 'done',
        }))
      );
    } catch (err) {
      console.error('Sale Order Error:', err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, selectedDate]);

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

  const onBackPress = () => {
    if (customerId != null) {
      navigation.navigate('Orders', { customerId: null });
    } else {
      navigation.navigate('Dashboard');
    }
  };

  const onOrderPress = (order) => {
    if (order.isDelivered) {
      navigation.navigate('ProceedPayment', {
        saleOrderId: order.id,
        total: order.amount_total,
        deliveryDone: true,
      });
    } else {
      navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
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
        <View style={styles.headerRight}>
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

      {/* Tabs: horizontally scrollable so filters are not squeezed */}
      <View style={styles.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScroll}
        >
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_TO_DELIVER && styles.tabActive]}
          onPress={() => setActiveTab(TAB_TO_DELIVER)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === TAB_TO_DELIVER && styles.tabTextActive]}>
            To deliver
          </Text>
          <View style={[styles.tabBadge, activeTab === TAB_TO_DELIVER && styles.tabBadgeActive]}>
            <Text
              style={[
                styles.tabBadgeText,
                activeTab === TAB_TO_DELIVER && styles.tabBadgeTextActive,
              ]}
            >
              {tabCounts[TAB_TO_DELIVER]}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_DELIVERED && styles.tabActive]}
          onPress={() => setActiveTab(TAB_DELIVERED)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === TAB_DELIVERED && styles.tabTextActive]}>
            Delivered
          </Text>
          <View style={[styles.tabBadge, activeTab === TAB_DELIVERED && styles.tabBadgeActive]}>
            <Text
              style={[
                styles.tabBadgeText,
                activeTab === TAB_DELIVERED && styles.tabBadgeTextActive,
              ]}
            >
              {tabCounts[TAB_DELIVERED]}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_INVOICED && styles.tabActive]}
          onPress={() => setActiveTab(TAB_INVOICED)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === TAB_INVOICED && styles.tabTextActive]}>
            Invoiced
          </Text>
          <View style={[styles.tabBadge, activeTab === TAB_INVOICED && styles.tabBadgeActive]}>
            <Text
              style={[
                styles.tabBadgeText,
                activeTab === TAB_INVOICED && styles.tabBadgeTextActive,
              ]}
            >
              {tabCounts[TAB_INVOICED]}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_ALL && styles.tabActive]}
          onPress={() => setActiveTab(TAB_ALL)}
          activeOpacity={0.8}
        >
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
              name={
                activeTab === TAB_DELIVERED
                  ? 'checkmark-done-outline'
                  : activeTab === TAB_TO_DELIVER
                    ? 'cube-outline'
                    : activeTab === TAB_INVOICED
                      ? 'receipt-outline'
                      : 'document-text-outline'
              }
              size={48}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyText}>
              {activeTab === TAB_ALL
                ? 'No orders for this date'
                : activeTab === TAB_TO_DELIVER
                  ? 'No orders to deliver'
                  : activeTab === TAB_DELIVERED
                    ? 'No delivered orders yet'
                    : 'No invoiced orders for this date'}
            </Text>
            <Text style={styles.emptyHint}>
              {activeTab !== TAB_ALL
                ? 'Switch to "All" to see every order for this date'
                : 'Orders will appear here after sync'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={onOrderPress} isDelivered={item.isDelivered} />
        )}
      />
    </View>
  );
}

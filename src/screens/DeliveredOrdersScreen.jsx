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
  getCachedJournals,
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import * as localPaymentsDb from '../database/localPayments.js';
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

/**
 * Categorize by payment amounts: Cash tab / Cheque tab / Credit tab.
 * Primary = tab with highest amount. Tie-break: cheque > cash > credit.
 * Uses stored amounts and payment_type only (no journal name check) so vehicle-specific
 * journals display correctly.
 * @param {Object} paymentSplit - { cash, cheque, credit, cashJournalId?, chequeJournalId? }
 * @param {string} fallbackPaymentType - used when all amounts are zero
 */
function getPrimaryPaymentType(paymentSplit, fallbackPaymentType) {
  const cash = Number(paymentSplit?.cash) || 0;
  const cheque = Number(paymentSplit?.cheque) || 0;
  const credit = Number(paymentSplit?.credit) || 0;
  if (!paymentSplit || (cash === 0 && cheque === 0 && credit === 0)) {
    const t = (fallbackPaymentType || '').toLowerCase().trim();
    if (t === 'cash' || t === 'cheque' || t === 'credit') return t;
    return TAB_CREDIT;
  }
  const max = Math.max(cash, cheque, credit);
  if (max === 0) return (fallbackPaymentType || '').toLowerCase().trim() || TAB_CREDIT;
  if (cheque === max) return TAB_CHEQUE;
  if (cash === max) return TAB_CASH;
  return TAB_CREDIT;
}

export default function DeliveredOrdersScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState([]);
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState(TAB_CASH);

  /** All delivered orders (with or without payment). Cash/Cheque/Credit tabs filter by payment_type. */
  const deliveredOrders = useMemo(
    () => orders.filter((o) => o.isDelivered),
    [orders]
  );

  /** Each order appears in exactly one tab: by payment amounts (cash / cheque / credit), highest amount wins. */
  const filteredOrders = useMemo(() => {
    if (activeTab === TAB_ALL) return deliveredOrders;
    return deliveredOrders.filter((o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === activeTab);
  }, [deliveredOrders, activeTab]);

  const tabCounts = useMemo(
    () => ({
      [TAB_CASH]: deliveredOrders.filter((o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CASH).length,
      [TAB_CHEQUE]: deliveredOrders.filter((o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CHEQUE).length,
      [TAB_CREDIT]: deliveredOrders.filter((o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CREDIT).length,
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
        headerBtn: { padding: 4, minWidth: 40, alignItems: 'flex-start' },
        headerCenter: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        headerRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 },
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
      const [totals, pickings, allLines, paymentSplits, journalsList] = await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
        localPaymentsDb.getPaymentSplitsWithJournalsBySaleOrderIds(orderIds),
        getCachedJournals(),
      ]);
      setJournals(Array.isArray(journalsList) ? journalsList : []);
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
      const getSplit = (order) => {
        const id = order?.id;
        if (id == null) return null;
        return paymentSplits[Number(id)] ?? paymentSplits[id] ?? paymentSplits[String(id)] ?? null;
      };
      // Backend sync can store amount_cash, amount_cheque, amount_credit (split); else use local split or payment_type + amount_total
      const syntheticSplit = (o) => {
        const split = getSplit(o);
        if (split && (Number(split.cash) || Number(split.cheque) || Number(split.credit))) return split;
        const sc = Number(o.amount_cash) || 0;
        const sq = Number(o.amount_cheque) || 0;
        const sr = Number(o.amount_credit) || 0;
        if (sc > 0 || sq > 0 || sr > 0)
          return { cash: sc, cheque: sq, credit: sr };
        const pt = (o.payment_type || '').toLowerCase();
        const amt = Number(o.amount_total) || 0;
        if (amt <= 0 || (pt !== 'cash' && pt !== 'cheque' && pt !== 'credit')) return split || null;
        return {
          cash: pt === 'cash' ? amt : 0,
          cheque: pt === 'cheque' ? amt : 0,
          credit: pt === 'credit' ? amt : 0,
        };
      };
      setOrders(
        list.map((o) => ({
          ...o,
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          isDelivered: saleIdToPickingState[o.id] === 'done',
          orderLines: linesByOrderId[o.id] || [],
          paymentSplit: syntheticSplit(o) || null,
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

  const onBackPress = () => {
    navigation.navigate('Dashboard');
  };

  const onOrderPress = (order) => {
    const isInvoiced = String(order.invoice_status) === 'invoiced';
    if (isInvoiced) {
      navigation.navigate('InvoiceScreen', {
        saleOrderId: order.id,
        total: order.amount_total,
      });
    } else {
      navigation.navigate('ProceedPayment', {
        saleOrderId: order.id,
        total: order.amount_total,
        deliveryDone: true,
      });
    }
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
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onBackPress} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
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
        <View style={styles.headerRight}>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {deliveredOrders.length}
            </Text>
          </View>
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
          <OrderCard order={item} onPress={onOrderPress} isDelivered={true} paymentSplit={item.paymentSplit} />
        )}
      />
    </View>
  );
}

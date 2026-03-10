import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getUserSession,
  getPickingsBySaleIdsFromDB,
  getOrderLinesByOrderIdsFromDB,
} from '../services/sync.service';
import {
  getActiveCommissionPlan,
  calculateCommissionByProducts,
} from '../services/commission.service';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DAYS_LIMIT = 60;

function formatCurrency(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return 'Today';
  const yesterday = new Date(Date.now() - 864e5).toISOString().split('T')[0];
  if (dateStr === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MyCommissionScreen({ navigation }) {
  const { colors } = useTheme();
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDate, setExpandedDate] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const userData = await getUserSession();
      const u = userData || null;
      setUser(u);
      if (!u?.licensePlate) {
        setDailyData([]);
        setPlan(null);
        return;
      }
      const vehicleId = u?.isAdmin === false ? u.vehicleId : null;
      const [orders, commissionPlan] = await Promise.all([
        getCachedOrders(vehicleId),
        getActiveCommissionPlan(u.licensePlate),
      ]);
      setPlan(commissionPlan || null);
      const orderList = Array.isArray(orders) ? orders : [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - DAYS_LIMIT);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const recentOrders = orderList.filter((o) => (o.date_order || '').slice(0, 10) >= cutoffStr);
      const orderIds = recentOrders.map((o) => o.id);
      if (orderIds.length === 0) {
        setDailyData([]);
        return;
      }
      const [pickings, allOrderLines] = await Promise.all([
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
      ]);
      const pickingStateBySaleId = {};
      (pickings || []).forEach((p) => {
        const sid = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
        pickingStateBySaleId[sid] = (p.state || '').toLowerCase();
      });
      const deliveredOrderIdsByDate = {};
      recentOrders.forEach((o) => {
        const date = (o.date_order || '').slice(0, 10);
        if (!date) return;
        if ((pickingStateBySaleId[o.id] || '') !== 'done') return;
        if (!deliveredOrderIdsByDate[date]) deliveredOrderIdsByDate[date] = new Set();
        deliveredOrderIdsByDate[date].add(o.id);
      });
      const productRateMap = commissionPlan?.productRateMap || {};
      const hasProductRates = Object.keys(productRateMap).length > 0;
      const defaultRate = hasProductRates ? (commissionPlan?.commission_percentage ?? 1) : 1;
      const dates = Object.keys(deliveredOrderIdsByDate).sort((a, b) => b.localeCompare(a));
      const result = dates.map((date) => {
        const deliveredIds = deliveredOrderIdsByDate[date];
        const lines = (allOrderLines || []).filter((line) => {
          const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
          return deliveredIds.has(oid);
        });
        const commission = calculateCommissionByProducts(lines, productRateMap, defaultRate);
        const totalGas = lines.reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0);
        const breakdown = lines.map((line) => {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
          const productName = Array.isArray(line.product_id) ? line.product_id[1] : 'Product';
          const qty = Number(line.product_uom_qty) || 0;
          const rate = productRateMap[productId] ?? defaultRate;
          const amount = Math.round(qty * rate * 100) / 100;
          return { productName, quantity: qty, rate, amount };
        });
        return { date, commission, totalGas, breakdown, lineCount: lines.length };
      });
      setDailyData(result);
    } catch (e) {
      console.warn('[MyCommission] load error', e);
      setDailyData([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const toggleExpand = useCallback((date) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedDate((p) => (p === date ? null : date));
  }, []);

  const defaultRate = useMemo(() => {
    const hasRates = plan && Object.keys(plan.productRateMap || {}).length > 0;
    return hasRates ? (plan?.commission_percentage ?? 1) : 1;
  }, [plan]);

  if (loading && dailyData.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading commission history…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Daily commission history</Text>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
          Tap a day to see gas delivered and calculation
        </Text>
      </View>
      {dailyData.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No commission history for the last {DAYS_LIMIT} days.
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
            Delivered orders will appear here by day.
          </Text>
        </View>
      ) : (
        dailyData.map((day) => {
          const isExpanded = expandedDate === day.date;
          return (
            <View key={day.date} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.cardHeader}
                activeOpacity={0.8}
                onPress={() => toggleExpand(day.date)}
              >
                <View style={styles.cardHeaderLeft}>
                  <Text style={[styles.cardDate, { color: colors.text }]}>{formatDate(day.date)}</Text>
                  <Text style={[styles.cardDateRaw, { color: colors.textSecondary }]}>{day.date}</Text>
                </View>
                <View style={styles.cardHeaderRight}>
                  <Text style={[styles.cardAmount, { color: colors.primary }]}>
                    {formatCurrency(day.commission)}
                  </Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={colors.textSecondary}
                  />
                </View>
              </TouchableOpacity>
              {isExpanded && (
                <View style={[styles.expanded, { borderTopColor: colors.border }]}>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>Gas delivered</Text>
                    <Text style={[styles.value, { color: colors.text }]}>
                      {Number(day.totalGas).toLocaleString('en-IN', { maximumFractionDigits: 2 })} units
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>Commission rate</Text>
                    <Text style={[styles.value, { color: colors.text }]}>
                      {plan && Object.keys(plan.productRateMap || {}).length > 0
                        ? 'Per product (see calculation below)'
                        : `Rs. ${Number(defaultRate).toFixed(2)} per unit`}
                    </Text>
                  </View>
                  <Text style={[styles.calcTitle, { color: colors.text }]}>Calculation</Text>
                  {day.breakdown.length === 0 ? (
                    <Text style={[styles.calcLine, { color: colors.textSecondary }]}>
                      No line items
                    </Text>
                  ) : (
                    day.breakdown.map((row, idx) => (
                      <View key={idx} style={styles.calcRow}>
                        <Text style={[styles.calcProduct, { color: colors.text }]} numberOfLines={1}>
                          {row.productName}
                        </Text>
                        <Text style={[styles.calcDetail, { color: colors.textSecondary }]}>
                          {row.quantity} × Rs.{row.rate.toFixed(2)} = {formatCurrency(row.amount)}
                        </Text>
                      </View>
                    ))
                  )}
                  <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.totalLabel, { color: colors.text }]}>Total commission</Text>
                    <Text style={[styles.totalAmount, { color: colors.primary }]}>
                      {formatCurrency(day.commission)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  loadingText: { marginTop: spacing.md, fontSize: 14 },
  header: { marginBottom: spacing.lg },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  emptyText: { fontSize: 16, marginTop: spacing.md, textAlign: 'center' },
  emptyHint: { fontSize: 14, marginTop: spacing.xs },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
  },
  cardHeaderLeft: {},
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardDate: { fontSize: 16, fontWeight: '700' },
  cardDateRaw: { fontSize: 12, marginTop: 2 },
  cardAmount: { fontSize: 17, fontWeight: '800' },
  expanded: {
    borderTopWidth: 1,
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: '600' },
  calcTitle: { fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  calcLine: { fontSize: 13 },
  calcRow: { marginBottom: spacing.xs },
  calcProduct: { fontSize: 13, fontWeight: '600' },
  calcDetail: { fontSize: 12, marginLeft: spacing.sm },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  totalLabel: { fontSize: 15, fontWeight: '700' },
  totalAmount: { fontSize: 16, fontWeight: '800' },
});

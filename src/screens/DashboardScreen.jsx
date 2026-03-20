import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { dashboardConfig } from '../constants/dashboardConfig';
import {
  getCachedOrders,
  getCachedRoutes,
  getLastSyncTime,
  getSyncLogRecent,
  getUserSession,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
  getOrderLinesByOrderIdsFromDB,
} from '../services/sync.service';
import * as localPaymentsDb from '../database/localPayments.js';
import {
  getActiveCommissionPlan,
  calculateCommissionProgressByProducts,
} from '../services/commission.service';
import DeliveryProgressBarChart from '../components/DeliveryProgressBarChart';
import SyncIndicator from '../components/SyncIndicator';
import { useSync } from '../context/SyncContext';

// const SHOPS_TARGET = 60;
// const GAS_TARGET = 6000;

/** Sample data for Delivery Progress by Shop when no real data. */
const SAMPLE_DELIVERY_BY_SHOP = [
  { shopId: 'S1', shopName: 'ABC Gas Agency', delivered: 45, pending: 12 },
  { shopId: 'S2', shopName: 'Green Valley Stores', delivered: 38, pending: 0 },
  { shopId: 'S3', shopName: 'Metro Traders', delivered: 28, pending: 15 },
  { shopId: 'S4', shopName: 'Sunrise Enterprises', delivered: 0, pending: 22 },
  { shopId: 'S5', shopName: 'Central Gas Hub', delivered: 52, pending: 8 },
  { shopId: 'S6', shopName: 'Corner Shop', delivered: 18, pending: 5 },
];

function formatCurrency(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatShort(amount) {
  const n = Number(amount) || 0;
  if (n >= 1000) return `Rs. ${(n / 1000).toFixed(0)}K`;
  return `Rs. ${n}`;
}

const SYNC_INDICATOR_GAP = 12;

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { isSyncing, syncCompleteTimestamp } = useSync();
  const { colors, showCreateSalesOrder: userShowCreate, showReturnOrder: userShowReturn } = useTheme();
  // Visibility from config file; user preference (theme/settings) can further hide when config allows
  const showCreateSalesOrder = dashboardConfig.showCreateSalesOrder && userShowCreate;
  const showReturnOrder = dashboardConfig.showReturnOrder && userShowReturn;
  const [orders, setOrders] = useState([]);
  const [user, setUser] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [lineTotalsByOrder, setLineTotalsByOrder] = useState({});
  const [pickingsBySaleId, setPickingsBySaleId] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [selectedChartDate, setSelectedChartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [showChartDatePicker, setShowChartDatePicker] = useState(false);
  const [chartLineTotalsByOrder, setChartLineTotalsByOrder] = useState({});
  const [chartPickingsBySaleId, setChartPickingsBySaleId] = useState([]);
  const [paymentSplitsByOrderId, setPaymentSplitsByOrderId] = useState({});
  // Commission state
  const [commissionPlan, setCommissionPlan] = useState(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [todayOrderLines, setTodayOrderLines] = useState([]);

  // Collection cards: tap to expand one (shows full amount), tap again to collapse
  const [expandedCollectionCard, setExpandedCollectionCard] = useState(null);

  const toggleCollectionCard = useCallback((key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCollectionCard((p) => (p === key ? null : key));
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [userData, routesData] = await Promise.all([
        getUserSession(),
        getCachedRoutes(),
      ]);
      const user = userData || null;
      setUser(user);
      setRoutes(Array.isArray(routesData) ? routesData : []);
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const data = await getCachedOrders(vehicleId);
      setOrders(Array.isArray(data) ? data : []);
      const today = new Date().toISOString().split('T')[0];
      const todayOrders = (Array.isArray(data) ? data : []).filter((o) => (o.date_order || '').startsWith(today));
      console.log('todayOrders', todayOrders);
      const orderIds = todayOrders.map((o) => o.id);
      const [totals, pickings, orderLines, splits] = await Promise.all([
        getOrderLineTotalsFromDB(todayOrders),
        orderIds.length ? getPickingsBySaleIdsFromDB(orderIds) : Promise.resolve([]),
        orderIds.length ? getOrderLinesByOrderIdsFromDB(orderIds) : Promise.resolve([]),
        orderIds.length ? localPaymentsDb.getPaymentSplitsBySaleOrderIds(orderIds) : Promise.resolve({}),
      ]);
      setLineTotalsByOrder(totals || {});
      setPickingsBySaleId(pickings || []);
      setTodayOrderLines(orderLines || []);
      setPaymentSplitsByOrderId(splits || {});
    } catch (_) {
      setOrders([]);
      setLineTotalsByOrder({});
      setPickingsBySaleId([]);
      setTodayOrderLines([]);
      setPaymentSplitsByOrderId({});
    } finally {
      setLoading(false);
    }
  }, []);


  const loadCommissionData = useCallback(async () => {
    if (!user?.licensePlate) return;

    setCommissionLoading(true);
    try {
      const plan = await getActiveCommissionPlan(user.licensePlate);
      console.log('[Commission] Loaded plan:', plan);
      setCommissionPlan(plan);
    } catch (_) {
      setCommissionPlan(null);
    } finally {
      setCommissionLoading(false);
    }
  }, [user?.licensePlate]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const [time, log] = await Promise.all([
        getLastSyncTime(),
        getSyncLogRecent(10),
      ]);
      setLastSyncTime(time);
      setSyncLog(log || []);
    } catch (_) {}
  }, []);

  // Load on mount and every time screen gains focus (e.g. after login or tab switch)
  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      loadData();
      loadSyncStatus();
    });
    loadData();
    loadSyncStatus();
    return () => unsub?.();
  }, [loadData, loadSyncStatus, navigation]);

  // When sync completes (from SyncContext), refresh dashboard data and last synced time
  useEffect(() => {
    if (syncCompleteTimestamp > 0) {
      loadData();
      loadSyncStatus();
    }
  }, [syncCompleteTimestamp, loadData, loadSyncStatus]);

  useEffect(() => {
    if (user?.licensePlate) {
      loadCommissionData();
    }
  }, [user?.licensePlate, loadCommissionData]);

  // Short delayed reload on first mount so dashboard amounts update immediately after first-time login
  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
      loadSyncStatus();
    }, 200);
    return () => clearTimeout(t);
  }, [loadData, loadSyncStatus]);

  useEffect(() => {
    const intervalMs = 60 * 1000;
    const tid = setInterval(() => {
      loadSyncStatus();
      loadData();
    }, intervalMs);
    return () => clearInterval(tid);
  }, [loadData, loadSyncStatus]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedChartDate === today) {
      setChartLineTotalsByOrder(lineTotalsByOrder);
      setChartPickingsBySaleId(pickingsBySaleId);
      return;
    }
    const dateOrders = orders.filter((o) => (o.date_order || '').startsWith(selectedChartDate));
    const orderIds = dateOrders.map((o) => o.id);
    if (orderIds.length === 0) {
      setChartLineTotalsByOrder({});
      setChartPickingsBySaleId([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [totals, pickings] = await Promise.all([
          getOrderLineTotalsFromDB(dateOrders),
          getPickingsBySaleIdsFromDB(orderIds),
        ]);
        if (!cancelled) {
          setChartLineTotalsByOrder(totals || {});
          setChartPickingsBySaleId(pickings || []);
        }
      } catch (_) {
        if (!cancelled) {
          setChartLineTotalsByOrder({});
          setChartPickingsBySaleId([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedChartDate, orders, lineTotalsByOrder, pickingsBySaleId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    await loadSyncStatus();
    await loadCommissionData();
    setRefreshing(false);
  };

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setLastSyncResult(null);
    try {
      const result = await runSync();
      setLastSyncResult(result);
      await loadData();
      await loadSyncStatus();
    } catch (err) {
      setLastSyncResult({ error: err?.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter((o) => (o.date_order || '').startsWith(today));

  const pickingStateBySaleId = useMemo(() => {
    const map = {};
    (pickingsBySaleId || []).forEach((p) => {
      const sid = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
      map[sid] = (p.state || '').toLowerCase();
    });
    return map;
  }, [pickingsBySaleId]);

  /** Today's orders that are actually delivered (picking state 'done') for this vehicle */
  //Check and Uncomment this if you want to use the pickingStateBySaleId to get the delivered today orders
  const deliveredTodayOrders = useMemo(
      () => todayOrders.filter((o) => (pickingStateBySaleId[o.id] || '') === 'done'),
      [todayOrders, pickingStateBySaleId]
  );

  // const deliveredTodayOrders = todayOrders;

  // Helper: lookup split by order id (keys may be number or string from DB)
  const getSplitForOrder = (order) => {
    const id = order?.id;
    if (id == null) return undefined;
    return paymentSplitsByOrderId[Number(id)] ?? paymentSplitsByOrderId[id] ?? paymentSplitsByOrderId[String(id)];
  };
  // Collection totals: local split first; else synced amounts (amount_cash/amount_cheque/amount_credit); else payment_type + amount_total
  const cashTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (split.cash > 0 || split.cheque > 0 || split.credit > 0)) return s + (Number(split.cash) || 0);
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sc;
    const pt = (o.payment_type || '').toLowerCase().trim();
    return s + (pt === 'cash' ? (Number(o.amount_total) || 0) : 0);
  }, 0);
  const chequeTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (split.cash > 0 || split.cheque > 0 || split.credit > 0)) return s + (Number(split.cheque) || 0);
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sq;
    const pt = (o.payment_type || '').toLowerCase().trim();
    return s + (pt === 'cheque' ? (Number(o.amount_total) || 0) : 0);
  }, 0);
  const creditTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (split.cash > 0 || split.cheque > 0 || split.credit > 0)) return s + (Number(split.credit) || 0);
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sr;
    const pt = (o.payment_type || '').toLowerCase().trim();
    return s + (pt === 'credit' || !pt ? (Number(o.amount_total) ?? 0) : 0);
  }, 0);
  const collectionTotal = cashTotal + chequeTotal + creditTotal || 1;
  const cashTotalDisplay = cashTotal;
  const chequeTotalDisplay = chequeTotal;
  const creditTotalDisplay = creditTotal;
  const collectionTotalDisplay = cashTotalDisplay + chequeTotalDisplay + creditTotalDisplay || 1;
  const cashPctDisplay = Math.round((cashTotalDisplay / collectionTotalDisplay) * 100);
  const chequePctDisplay = Math.round((chequeTotalDisplay / collectionTotalDisplay) * 100);
  const creditPctDisplay = Math.round((creditTotalDisplay / collectionTotalDisplay) * 100);

  const routeFromOrder = todayOrders[0]?.route_id?.[1];
  const routeName = routeFromOrder || (routes[0]?.name) || '—';
  const vehicleName = user?.licensePlate || user?.vehicleName || 'Vehicle';


  // Use commission rate from API, default to Rs. 1 per item if not available
  const commissionPercentage = commissionPlan?.commission_percentage || 1;
  const productRateMap = commissionPlan?.productRateMap || {};

  // Calculate totals for fallback commission calculation
  const allOrdersTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0);
  const deliveredOrdersTotal = deliveredTodayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0);

  // Get order lines for delivered orders (for achieved commission)
  const deliveredOrderIds = new Set(deliveredTodayOrders.map(o => o.id));
  const deliveredOrderLines = todayOrderLines.filter(line => {
    const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
    return deliveredOrderIds.has(orderId);
  });


  const hasProductRates = Object.keys(productRateMap).length > 0;
  const defaultRate = hasProductRates ? commissionPercentage : 1;


  const commissionProgress = calculateCommissionProgressByProducts(
    todayOrderLines,
    deliveredOrderLines,
    productRateMap,
    defaultRate
  );

  const commissionTarget = commissionProgress.target;
  const commissionEarned = commissionProgress.achieved;
  const commissionPct = commissionProgress.percentage;

  const shopsCompleted = deliveredTodayOrders.length;
  const totalShopsToday = todayOrders.length;
  const shopsPct = totalShopsToday > 0 ? Math.min(100, Math.round((shopsCompleted / totalShopsToday) * 100)) : 0;
  const totalGasDelivered = deliveredTodayOrders.reduce(
      (s, o) => s + (Number(lineTotalsByOrder[o.id]) || 0),
      0
  );
  const totalGasInOrders = todayOrders.reduce(
      (s, o) => s + (Number(lineTotalsByOrder[o.id]) || 0),
      0
  );
  const gasPct = totalGasInOrders > 0 ? Math.min(100, Math.round((totalGasDelivered / totalGasInOrders) * 100)) : 0;

  const chartDateOrders = useMemo(
      () => orders.filter((o) => (o.date_order || '').startsWith(selectedChartDate)),
      [orders, selectedChartDate]
  );
  const chartPickingStateBySaleId = useMemo(() => {
    const map = {};
    (chartPickingsBySaleId || []).forEach((p) => {
      const sid = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
      map[sid] = (p.state || '').toLowerCase();
    });
    return map;
  }, [chartPickingsBySaleId]);
  const chartDeliveryByShop = useMemo(() => {
    const byPartner = {};
    chartDateOrders.forEach((o) => {
      const partnerId = o.partner_id?.[0] ?? o.partner_id;
      const partnerName = o.partner_id?.[1] ?? `Shop ${partnerId}`;
      const key = partnerId ?? 'unknown';
      if (!byPartner[key]) byPartner[key] = { shopId: `S${partnerId}`, shopName: partnerName, delivered: 0, pending: 0 };
      const qty = Math.round(Number(chartLineTotalsByOrder[o.id]) || 0);
      //Check and Uncomment this if you want to use the chartPickingStateBySaleId to get the delivered today orders
      const isDone = (chartPickingStateBySaleId[o.id] || '') === 'done';
      // const isDone = true;
      if (isDone) byPartner[key].delivered += qty;
      else byPartner[key].pending += qty;
    });
    const real = Object.values(byPartner).filter((r) => r.delivered > 0 || r.pending > 0);
    return real;
  }, [chartDateOrders, chartLineTotalsByOrder, chartPickingStateBySaleId]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { paddingBottom: 100 },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        topBar: {
          backgroundColor: colors.primary ?? '#6366f1',
          paddingTop: spacing.lg,
          paddingHorizontal: spacing.md,
          paddingBottom: 28,
        },
        topBarRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        topBarRowWithMargin: { marginBottom: 10 },
        topBarLeft: {
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6,
          flex: 1,
        },
        vehicleName: { fontSize: 16, fontWeight: '700', color: '#fff' },
        dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        dateText: { fontSize: 14, color: 'rgba(255,255,255,0.95)' },
        routePill: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 20,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.4)',
          gap: 6,
        },
        routePillText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.95)' },
        headerButtons: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
        },
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.md,
        },
        greeting: { fontSize: 22, fontWeight: '800', color: colors.text },
        hint: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
        lastSyncedRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        lastSyncedBlock: { alignItems: 'flex-end' },
        lastSyncedLabel: {
          fontSize: 10,
          fontWeight: '600',
          color: 'rgba(255,255,255,0.75)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        lastSyncTimeText: {
          fontSize: 12,
          fontWeight: '600',
          color: 'rgba(255,255,255,0.95)',
          marginTop: 2,
        },
        dailyVisitBtnTop: {
          backgroundColor: 'transparent',
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.9)',
        },
        dailyVisitBtnTopText: { fontSize: 14, fontWeight: '700', color: '#fff' },
        sectionTitle: {
          fontSize: 17,
          fontWeight: '700',
          color: colors.text,
          marginBottom: spacing.sm,
        },
        commissionCard: {
          backgroundColor: colors.primaryLight ?? '#312e81',
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginHorizontal: spacing.md,
          marginTop: -20,
          marginBottom: spacing.md,
        },
        commissionTitle: { fontSize: 12, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
        commissionAmount: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 4 },
        commissionPct: { fontSize: 14, color: colors.text, marginTop: 4 },
        collectionSectionLabel: {
          fontSize: 12,
          fontWeight: '700',
          color: colors.textSecondary,
          letterSpacing: 0.5,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.xs,
        },
        collectionRow: {
          flexDirection: 'row',
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.md,
        },
        collectionCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.sm,
          borderWidth: 1.5,
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        collectionCardExpanded: {
          flex: 2.5,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        },
        collectionCardSqueezed: {
          flex: 0.5,
          paddingVertical: spacing.xs,
          paddingHorizontal: 4,
        },
        collectionIcon: { width: 20, height: 20 },
        collectionAmount: { fontSize: 12, fontWeight: '800', marginTop: 2 },
        collectionAmountExpanded: { fontSize: 12, fontWeight: '800', marginTop: 2 },
        collectionLabel: { fontSize: 9, fontWeight: '700', color: colors.text, marginTop: 2 },
        collectionLabelExpanded: { fontSize: 9, marginTop: 2 },
        collectionPct: { fontSize: 9, fontWeight: '600', marginTop: 1 },
        collectionPctExpanded: { fontSize: 9, marginTop: 1 },
        shopsGasRow: {
          flexDirection: 'row',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.md,
        },
        shopsGasCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          alignItems: 'center',
          justifyContent: 'center',
        },
        shopsGasValue: { fontSize: 28, fontWeight: '800', color: colors.text },
        shopsGasTarget: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
        shopsGasLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 4, letterSpacing: 0.3 },
        shopsGasPct: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
        metricsRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginBottom: spacing.md,
        },
        metricCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          alignItems: 'center',
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        metricValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 4 },
        metricLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
        totalsCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        totalSalesRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        cashCreditRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          paddingTop: 10,
          alignItems: 'center',
        },
        halfBox: {
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: 32,
        },
        totalsLabel: { fontSize: 13, color: colors.textSecondary },
        totalsValue: { fontSize: 16, fontWeight: '800', color: colors.text },
        chartCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          overflow: 'hidden',
        },
        chartTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
        actionsRow: { flexDirection: 'row', gap: spacing.md },
        actionCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          alignItems: 'center',
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        actionIconWrap: {
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 8,
        },
        actionLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
        syncStatusCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.sm,
          marginBottom: spacing.md,
          borderLeftWidth: 4,
          borderLeftColor: colors.primary,
        },
        syncStatusText: { fontSize: 12, color: colors.textSecondary },
        syncStatusTime: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 2 },
        syncError: { fontSize: 12, color: colors.error || '#c00', marginTop: 4 },
        syncCounts: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
        syncLogTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 },
        syncLogItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 8,
        },
        syncLogStatus: { width: 8, height: 8, borderRadius: 4 },
        syncLogText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
      }),
    [colors]
  );

  if (loading) {
    return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
  }

  const todayDateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      {/* 1. Top bar: date + route left; sync indicator (when syncing) + Last Synced right */}
      <View style={[styles.topBar, { paddingTop: spacing.lg + insets.top }]}>
        <View style={[styles.topBarRow, styles.topBarRowWithMargin]}>
          <View style={styles.topBarLeft}>
            <Text style={styles.vehicleName} numberOfLines={1}>
              {vehicleName}
            </Text>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.95)" />
              <Text style={styles.dateText}>{todayDateStr}</Text>
            </View>
            <View style={styles.routePill}>
              <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.95)" />
              <Text style={styles.routePillText}>Route: {routeName}</Text>
            </View>
          </View>
          <View style={styles.headerButtons}>
            <View style={styles.lastSyncedRow}>
              {/* {isSyncing && <SyncIndicator style={{ marginRight: SYNC_INDICATOR_GAP }} />} */}
              <View style={styles.lastSyncedBlock}>
                <Text style={styles.lastSyncedLabel}>Last Synced</Text>
                <Text style={styles.lastSyncTimeText} numberOfLines={1}>
                  {lastSyncTime
                    ? new Date(lastSyncTime).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                    : '—'}
                </Text>
              </View>
            </View>
            {/* //Daily Visit Keep Commented for now */}
            {/* <TouchableOpacity
              style={styles.dailyVisitBtnTop}
              onPress={() => navigation.navigate('Orders', { customerId: null })}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={20} color="#fff" />
              <Text style={styles.dailyVisitBtnTopText}>Visit</Text>
            </TouchableOpacity> */}
            </View>
          </View>
        </View>

        {/* 2. Commission card - tap to open My Commission */}
        <TouchableOpacity
          style={styles.commissionCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('MyCommissions')}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.commissionTitle}>YOUR COMMISSION TODAY</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </View>
          <Text style={styles.commissionAmount}>
            {formatCurrency(commissionEarned)} / {Number(commissionTarget).toFixed(2)}
          </Text>
          <Text style={styles.commissionPct}>
            {commissionPct}% of target achieved
            {commissionLoading && ' (loading...)'}
          </Text>
        </TouchableOpacity>

        {/* 3. Collection today - Cash, Cheque, Credit (tap to expand / tap again to collapse) */}
        <Text style={styles.collectionSectionLabel}>Sales Today</Text>
        <View style={styles.collectionRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.cash ?? '#059669' },
              expandedCollectionCard === 'cash' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'cash' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('cash')}
          >
            <Ionicons name="cash-outline" size={20} color={colors.cash ?? '#059669'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'cash') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'cash' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.cash ?? '#059669' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'cash' ? 2 : 1}
                >
                  {expandedCollectionCard === 'cash' ? formatCurrency(cashTotalDisplay) : formatShort(cashTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cash' && styles.collectionLabelExpanded]}>CASH</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'cash' && styles.collectionPctExpanded, { color: colors.cash ?? '#059669' }]}>
                  ( {cashPctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.cheque ?? '#d97706' },
              expandedCollectionCard === 'cheque' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'cheque' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('cheque')}
          >
            <Ionicons name="card-outline" size={20} color={colors.cheque ?? '#d97706'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'cheque') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'cheque' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.cheque ?? '#d97706' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'cheque' ? 2 : 1}
                >
                  {expandedCollectionCard === 'cheque' ? formatCurrency(chequeTotalDisplay) : formatShort(chequeTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cheque' && styles.collectionLabelExpanded]}>CHEQUE</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'cheque' && styles.collectionPctExpanded, { color: colors.cheque ?? '#d97706' }]}>
                  ( {chequePctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.credit ?? '#6366f1' },
              expandedCollectionCard === 'credit' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'credit' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('credit')}
          >
            <Ionicons name="wallet-outline" size={20} color={colors.credit ?? '#6366f1'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'credit') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'credit' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.credit ?? '#6366f1' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'credit' ? 2 : 1}
                >
                  {expandedCollectionCard === 'credit' ? formatCurrency(creditTotalDisplay) : formatShort(creditTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'credit' && styles.collectionLabelExpanded]}>CREDIT</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'credit' && styles.collectionPctExpanded, { color: colors.credit ?? '#6366f1' }]}>
                  ( {creditPctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* 4. Shops Completed (delivered/total) & Gas Delivered (delivered/total) - tap to open Orders / Delivered tab */}
        <View style={styles.shopsGasRow}>
          <TouchableOpacity
            style={styles.shopsGasCard}
            onPress={() => navigation.navigate('Orders')}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.shopsGasValue, { color: colors.primary }]}>{shopsCompleted}</Text>
              <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{totalShopsToday}</Text>
            </View>
            <Text style={styles.shopsGasLabel}>ORDERS COMPLETED</Text>
            <Text style={styles.shopsGasPct}>{shopsPct}% Complete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shopsGasCard}
            onPress={() => navigation.navigate('DeliveredOrders')}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.shopsGasValue, { color: colors.warning ?? '#d97706' }]}>
                {totalGasDelivered.toLocaleString('en-IN')}
              </Text>
              <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{totalGasInOrders.toLocaleString('en-IN')}</Text>
            </View>
            <Text style={styles.shopsGasLabel}>GAS DELIVERED</Text>
            <Text style={styles.shopsGasPct}>{gasPct}% Complete</Text>
          </TouchableOpacity>
        </View>

      {/* 5. Delivery Progress by Shop - bar chart with date picker (default today) */}
      <View style={{ paddingHorizontal: spacing.md }}>
        <DeliveryProgressBarChart
          data={chartDeliveryByShop}
          title="Delivery Progress"
          rightElement={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <TouchableOpacity
                onPress={() => {
                  const d = new Date(selectedChartDate + 'T12:00:00');
                  d.setDate(d.getDate() - 1);
                  setSelectedChartDate(d.toISOString().split('T')[0]);
                }}
                style={{ padding: 6 }}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: colors.textSecondary, minWidth: 72, textAlign: 'center' }}>
                {selectedChartDate === new Date().toISOString().split('T')[0]
                  ? 'Today'
                  : new Date(selectedChartDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  const d = new Date(selectedChartDate + 'T12:00:00');
                  d.setDate(d.getDate() + 1);
                  setSelectedChartDate(d.toISOString().split('T')[0]);
                }}
                style={{ padding: 6 }}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-forward" size={22} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowChartDatePicker(true)}
                style={{ padding: 6, marginLeft: 2 }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
              {showChartDatePicker && (
                <DateTimePicker
                  value={new Date(selectedChartDate + 'T12:00:00')}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, date) => {
                    if (Platform.OS === 'android') setShowChartDatePicker(false);
                    if (date) setSelectedChartDate(date.toISOString().split('T')[0]);
                  }}
                />
              )}
              {showChartDatePicker && Platform.OS === 'ios' && (
                <TouchableOpacity
                  onPress={() => setShowChartDatePicker(false)}
                  style={{ paddingVertical: 4, paddingHorizontal: 8 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.primary }}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>

        {/* 6. Configurable: Create Sales Order & Return */}
        {(showCreateSalesOrder || showReturnOrder) && (
            <View style={[styles.actionsRow, { paddingHorizontal: spacing.md, marginBottom: spacing.lg }]}>
              {showCreateSalesOrder && (
                  <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => navigation.navigate('Orders', { customerId: null })}
                      activeOpacity={0.8}
                  >
                    <View style={styles.actionIconWrap}>
                      <Ionicons name="add" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.actionLabel}>Create Sales Order</Text>
                  </TouchableOpacity>
              )}
              {showReturnOrder && (
                  <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => navigation.navigate('Orders')}
                      activeOpacity={0.8}
                  >
                    <View style={styles.actionIconWrap}>
                      <Ionicons name="return-down-back-outline" size={28} color={colors.primary} />
                    </View>
                    <Text style={styles.actionLabel}>Return Order</Text>
                  </TouchableOpacity>
              )}
            </View>
        )}
      </ScrollView>
  );
}

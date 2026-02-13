import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getCachedRoutes,
  runSync,
  getLastSyncTime,
  getSyncLogRecent,
  getSyncIntervalMinutes,
  getUserSession,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
} from '../services/sync.service';
import DeliveryProgressBarChart from '../components/DeliveryProgressBarChart';

const COMMISSION_TARGET = 6000;
const SHOPS_TARGET = 60;
const GAS_TARGET = 6000;

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
  return `Rs. ${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function formatShort(amount) {
  const n = Number(amount) || 0;
  if (n >= 1000) return `Rs. ${(n / 1000).toFixed(0)}K`;
  return `Rs. ${n}`;
}

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { colors, showCreateSalesOrder, showReturnOrder } = useTheme();
  const [orders, setOrders] = useState([]);
  const [user, setUser] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [lineTotalsByOrder, setLineTotalsByOrder] = useState({});
  const [pickingsBySaleId, setPickingsBySaleId] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [lastSyncResult, setLastSyncResult] = useState(null);

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
      const orderIds = todayOrders.map((o) => o.id);
      const [totals, pickings] = await Promise.all([
        getOrderLineTotalsFromDB(todayOrders),
        orderIds.length ? getPickingsBySaleIdsFromDB(orderIds) : Promise.resolve([]),
      ]);
      setLineTotalsByOrder(totals || {});
      setPickingsBySaleId(pickings || []);
    } catch (_) {
      setOrders([]);
      setLineTotalsByOrder({});
      setPickingsBySaleId([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      loadData();
      loadSyncStatus();
    });
    loadData();
    loadSyncStatus();
    return () => unsub?.();
  }, [loadData, loadSyncStatus, navigation]);

  useEffect(() => {
    const intervalMs = 60 * 1000;
    const tid = setInterval(() => {
      loadSyncStatus();
      loadData();
    }, intervalMs);
    return () => clearInterval(tid);
  }, [loadData, loadSyncStatus]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    await loadSyncStatus();
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
  const totalSales = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0);
  const cashTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0) * 0.5, 0);
  const chequeTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0) * 0.25, 0);
  const creditTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0) * 0.25, 0);
  const collectionTotal = cashTotal + chequeTotal + creditTotal || 1;
  const cashPct = Math.round((cashTotal / collectionTotal) * 100);
  const chequePct = Math.round((chequeTotal / collectionTotal) * 100);
  const creditPct = Math.round((creditTotal / collectionTotal) * 100);

  const routeFromOrder = todayOrders[0]?.route_id?.[1];
  const routeName = routeFromOrder || (routes[0]?.name) || '—';
  const vehicleName = user?.isAdmin === false
    ? (user.licensePlate || user.vehicleName || 'Vehicle')
    : 'Admin';
  const commissionEarned = Math.round(totalSales * 0.1) || 0;
  const commissionPct = Math.min(100, Math.round((commissionEarned / COMMISSION_TARGET) * 100));

  const shopsCompleted = todayOrders.length;
  const shopsPct = Math.min(100, Math.round((shopsCompleted / SHOPS_TARGET) * 100));
  const totalGasDelivered = Object.values(lineTotalsByOrder).reduce((s, q) => s + (Number(q) || 0), 0);
  const gasPct = Math.min(100, Math.round((totalGasDelivered / GAS_TARGET) * 100));

  const pickingStateBySaleId = useMemo(() => {
    const map = {};
    (pickingsBySaleId || []).forEach((p) => {
      const sid = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
      map[sid] = (p.state || '').toLowerCase();
    });
    return map;
  }, [pickingsBySaleId]);

  const deliveryByShop = useMemo(() => {
    const byPartner = {};
    todayOrders.forEach((o) => {
      const partnerId = o.partner_id?.[0] ?? o.partner_id;
      const partnerName = o.partner_id?.[1] ?? `Shop ${partnerId}`;
      const key = partnerId ?? 'unknown';
      if (!byPartner[key]) byPartner[key] = { shopId: `S${partnerId}`, shopName: partnerName, delivered: 0, pending: 0 };
      const qty = Math.round(Number(lineTotalsByOrder[o.id]) || 0);
      const isDone = (pickingStateBySaleId[o.id] || '') === 'done';
      if (isDone) byPartner[key].delivered += qty;
      else byPartner[key].pending += qty;
    });
    const real = Object.values(byPartner).filter((r) => r.delivered > 0 || r.pending > 0);
    return real.length > 0 ? real : SAMPLE_DELIVERY_BY_SHOP;
  }, [todayOrders, lineTotalsByOrder, pickingStateBySaleId]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { paddingBottom: 100 },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        topBar: {
          backgroundColor: colors.warningLight ?? colors.warning ?? '#d97706',
          paddingTop: spacing.lg,
          paddingHorizontal: spacing.md,
          paddingBottom: 28,
        },
        topBarRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
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
        syncBtnTop: {
          backgroundColor: 'transparent',
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.9)',
        },
        syncBtnTopText: { fontSize: 14, fontWeight: '700', color: '#fff' },
        lastSyncTimeText: {
          fontSize: 11,
          color: 'rgba(255,255,255,0.9)',
          marginTop: 4,
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
          backgroundColor: colors.success ?? '#059669',
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginHorizontal: spacing.md,
          marginTop: -20,
          marginBottom: spacing.md,
        },
        commissionTitle: { fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
        commissionAmount: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 4 },
        commissionPct: { fontSize: 14, color: 'rgba(255,255,255,0.95)', marginTop: 4 },
        collectionRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.md,
        },
        collectionCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          borderWidth: 2,
          alignItems: 'center',
        },
        collectionIcon: { width: 28, height: 28 },
        collectionAmount: { fontSize: 18, fontWeight: '800', marginTop: 4 },
        collectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginTop: 4 },
        collectionPct: { fontSize: 12, fontWeight: '600', marginTop: 2 },
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
      {/* 1. Top bar: date + route left, Sync then Daily Visit right (no profile) */}
      <View style={[styles.topBar, { paddingTop: spacing.lg + insets.top }]}>
        <View style={styles.topBarRow}>
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
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity
                style={styles.syncBtnTop}
                onPress={onSync}
                disabled={syncing}
                activeOpacity={0.8}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="sync-outline" size={20} color="#fff" />
                )}
                <Text style={styles.syncBtnTopText}>Sync</Text>
              </TouchableOpacity>
              <Text style={styles.lastSyncTimeText} numberOfLines={1}>
                {lastSyncTime
                  ? new Date(lastSyncTime).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })
                  : '—'}
              </Text>
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

      {/* 2. Commission card - green */}
      <View style={styles.commissionCard}>
        <Text style={styles.commissionTitle}>YOUR COMMISSION TODAY</Text>
        <Text style={styles.commissionAmount}>
          Rs. {commissionEarned.toLocaleString('en-IN')} / {COMMISSION_TARGET.toLocaleString('en-IN')}
        </Text>
        <Text style={styles.commissionPct}>{commissionPct}% of target achieved</Text>
      </View>

      {/* 3. Collection today - three cards: Cash, Cheque, Credit (real image icons) */}
      <View style={styles.collectionRow}>
        <View style={[styles.collectionCard, { borderColor: colors.cash ?? '#059669' }]}>
          <Image source={require('../../assets/images/cash.png')} style={styles.collectionIcon} resizeMode="contain" />
          <Text style={[styles.collectionAmount, { color: colors.cash ?? '#059669' }]}>{formatShort(cashTotal)}</Text>
          <Text style={styles.collectionLabel}>CASH</Text>
          <Text style={[styles.collectionPct, { color: colors.cash ?? '#059669' }]}>{cashPct}%</Text>
        </View>
        <View style={[styles.collectionCard, { borderColor: colors.cheque ?? '#d97706' }]}>
          <Image source={require('../../assets/images/cheque.png')} style={styles.collectionIcon} resizeMode="contain" />
          <Text style={[styles.collectionAmount, { color: colors.cheque ?? '#d97706' }]}>{formatShort(chequeTotal)}</Text>
          <Text style={styles.collectionLabel}>CHEQUE</Text>
          <Text style={[styles.collectionPct, { color: colors.cheque ?? '#d97706' }]}>{chequePct}%</Text>
        </View>
        <View style={[styles.collectionCard, { borderColor: colors.credit ?? '#6366f1' }]}>
          <Image source={require('../../assets/images/credit.png')} style={styles.collectionIcon} resizeMode="contain" />
          <Text style={[styles.collectionAmount, { color: colors.credit ?? '#6366f1' }]}>{formatShort(creditTotal)}</Text>
          <Text style={styles.collectionLabel}>CREDIT</Text>
          <Text style={[styles.collectionPct, { color: colors.credit ?? '#6366f1' }]}>{creditPct}%</Text>
        </View>
      </View>

      {/* 4. Shops Completed & Total Gas Delivered */}
      <View style={styles.shopsGasRow}>
        <View style={styles.shopsGasCard}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[styles.shopsGasValue, { color: colors.primary }]}>{shopsCompleted}</Text>
            <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{SHOPS_TARGET}</Text>
          </View>
          <Text style={styles.shopsGasLabel}>SHOPS COMPLETED</Text>
          <Text style={styles.shopsGasPct}>{shopsPct}% Complete</Text>
        </View>
        <View style={styles.shopsGasCard}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={[styles.shopsGasValue, { color: colors.warning ?? '#d97706' }]}>
              {totalGasDelivered.toLocaleString('en-IN')}
            </Text>
            <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{GAS_TARGET.toLocaleString('en-IN')}</Text>
          </View>
          <Text style={styles.shopsGasLabel}>TOTAL GAS DELIVERED</Text>
          <Text style={styles.shopsGasPct}>{gasPct}% Complete</Text>
        </View>
      </View>

      {/* 5. Delivery Progress by Shop - bar chart */}
      <View style={{ paddingHorizontal: spacing.md }}>
        <DeliveryProgressBarChart data={deliveryByShop} title="Delivery Progress by Shop" />
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

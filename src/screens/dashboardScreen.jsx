import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedOrders, runSync } from '../services/sync.service';
import WeeklyLineChart from '../components/WeeklyLineChart';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

export default function DashboardScreen({ navigation }) {
  const { colors, showCreateSalesOrder, showReturnOrder } = useTheme();
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await getCachedOrders();
      setOrders(Array.isArray(data) ? data : []);
    } catch (_) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadData);
    loadData();
    return () => unsub?.();
  }, [loadData, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await runSync();
      await loadData();
    } finally {
      setSyncing(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter((o) => (o.date_order || '').startsWith(today));
  const totalSales = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0);
  const cashTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0) * 0.6, 0);
  const creditTotal = todayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0) * 0.4, 0);

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    const dayOrders = orders.filter((o) => (o.date_order || '').startsWith(dayStr));
    last7Days.push(dayOrders.reduce((s, o) => s + (Number(o.amount_total) || 0), 0));
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: 100 },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.md,
        },
        greeting: { fontSize: 22, fontWeight: '800', color: colors.text },
        hint: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
        headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        syncBtnTop: {
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          padding: 10,
          minWidth: 44,
          alignItems: 'center',
          justifyContent: 'center',
        },
        dailyVisitBtnTop: {
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        },
        dailyVisitBtnTopText: { fontSize: 14, fontWeight: '700', color: '#fff' },
        sectionTitle: {
          fontSize: 17,
          fontWeight: '700',
          color: colors.text,
          marginBottom: spacing.sm,
        },
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, Driver</Text>
          <Text style={styles.hint}>Your daily overview</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.dailyVisitBtnTop}
            onPress={() => navigation.navigate('DailyVisit')}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar-outline" size={20} color="#fff" />
            <Text style={styles.dailyVisitBtnTopText}>Daily Visit</Text>
          </TouchableOpacity>
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
          </TouchableOpacity>
        </View>
      </View>

      {/* 1. Daily Overview */}
      <Text style={styles.sectionTitle}>Daily Overview</Text>
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Ionicons name="cart-outline" size={22} color={colors.primary} />
          <Text style={styles.metricValue}>{todayOrders.length}</Text>
          <Text style={styles.metricLabel}>Sales Orders</Text>
        </View>
        <View style={styles.metricCard}>
          <Ionicons name="wallet-outline" size={22} color={colors.primary} />
          <Text style={styles.metricValue}>{formatCurrency(cashTotal + creditTotal)}</Text>
          <Text style={styles.metricLabel}>To Collect</Text>
        </View>
      </View>

      {/* 2. Totals panel: Total Sales (label left, value right); Cash | Credit same alignment */}
      <View style={styles.totalsCard}>
        <View style={styles.totalSalesRow}>
          <Text style={styles.totalsLabel}>Total Sales</Text>
          <Text style={styles.totalsValue}>{formatCurrency(totalSales)}</Text>
        </View>
        <View style={styles.cashCreditRow}>
          <View style={styles.halfBox}>
            <Text style={styles.totalsLabel}>Cash</Text>
            <Text style={styles.totalsValue}>{formatCurrency(cashTotal)}</Text>
          </View>
          <View style={styles.halfBox}>
            <Text style={styles.totalsLabel}>Credit</Text>
            <Text style={styles.totalsValue}>{formatCurrency(creditTotal)}</Text>
          </View>
        </View>
      </View>

      {/* 3. Weekly Sales chart */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Weekly Sales</Text>
        <WeeklyLineChart data={last7Days} label="" />
      </View>

      {/* 4. Configurable: Create Sales Order & Return */}
      {(showCreateSalesOrder || showReturnOrder) && (
        <View style={styles.actionsRow}>
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

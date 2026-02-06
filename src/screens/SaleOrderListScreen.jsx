import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getAllSaleOrders, getOrderLineTotalsForOrders } from '../services/saleOrder.service';
import { getPickingsBySaleIds } from '../services/delivery.service';
import { getCachedOrders } from '../services/sync.service';
import OrderCard from '../components/OrderCard';

const TAB_ALL = 'all';
const TAB_TO_DELIVER = 'to_deliver';
const TAB_DELIVERED = 'delivered';

export default function SaleOrderListScreen({ route, navigation }) {
  const { colors } = useTheme();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(TAB_ALL);

  const filteredOrders = useMemo(() => {
    if (activeTab === TAB_TO_DELIVER) return orders.filter((o) => !o.isDelivered);
    if (activeTab === TAB_DELIVERED) return orders.filter((o) => o.isDelivered);
    return orders;
  }, [orders, activeTab]);

  const tabCounts = useMemo(
    () => ({
      [TAB_ALL]: orders.length,
      [TAB_TO_DELIVER]: orders.filter((o) => !o.isDelivered).length,
      [TAB_DELIVERED]: orders.filter((o) => o.isDelivered).length,
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
          paddingVertical: spacing.md,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerBtn: { padding: 4, minWidth: 40, alignItems: 'flex-start' },
        headerBtnRight: { alignItems: 'flex-end' },
        screenTitle: {
          flex: 1,
          fontSize: 18,
          fontWeight: '700',
          color: colors.text,
          textAlign: 'center',
        },
        tabsWrap: {
          flexDirection: 'row',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        },
        tab: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: spacing.sm,
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
    try {
      let list = [];
      try {
        const data = await getCachedOrders();
        list = Array.isArray(data) ? data : [];
      } catch (_) {
        const data = await getAllSaleOrders();
        list = data || [];
      }
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
      }
      const [totals, pickings] = await Promise.all([
        getOrderLineTotalsForOrders(list),
        getPickingsBySaleIds(list.map((o) => o.id)),
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
  }, [customerId]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    loadOrders();
    return () => unsub?.();
  }, [loadOrders, navigation]);

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
      {/* Header: back, title, QR scan (same style as Daily Visit top bar) */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (customerId != null) {
              navigation.navigate('Orders', { customerId: null });
            } else {
              navigation.goBack();
            }
          }}
          style={styles.headerBtn}
        >
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {customerId != null ? 'Orders (Customer)' : 'Sale Orders'}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ScanQRCode')}
          style={[styles.headerBtn, styles.headerBtnRight]}
        >
          <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs: All | To deliver | Delivered */}
      <View style={styles.tabsWrap}>
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
                    : 'document-text-outline'
              }
              size={48}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyText}>
              {activeTab === TAB_ALL
                ? 'No orders'
                : activeTab === TAB_TO_DELIVER
                  ? 'No orders to deliver'
                  : 'No delivered orders yet'}
            </Text>
            <Text style={styles.emptyHint}>
              {activeTab !== TAB_ALL
                ? 'Switch to "All" to see every order'
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

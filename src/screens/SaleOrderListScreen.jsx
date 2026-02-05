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
import { useNetwork } from '../context/NetworkContext';
import { useAuth } from '../context/AuthContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedOrders } from '../services/sync.service';
import OrderCard from '../components/OrderCard';

/** Tab key: show only orders with this invoice_status */
const TAB_INVOICED = 'invoiced';
const TAB_TO_INVOICE = 'to_invoice';

export default function SaleOrderListScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { isOnline } = useNetwork();
  const { vehicleId } = useAuth();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(TAB_TO_INVOICE);

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
        tabRow: {
          flexDirection: 'row',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tab: {
          flex: 1,
          paddingVertical: 10,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
          borderWidth: 1.5,
          borderColor: colors.border,
        },
        tabActive: {
          backgroundColor: colors.primarySurface ?? colors.surface,
          borderColor: colors.primary,
        },
        tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
        tabTextActive: { color: colors.primary, fontWeight: '700' },
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
      }),
    [colors]
  );

  const loadOrders = useCallback(async () => {
    try {
      const data = await getCachedOrders(isOnline, vehicleId);
      let list = Array.isArray(data) ? data : [];
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
      }
      setOrders((prev) => {
        if (isOnline !== true && list.length === 0 && prev.length > 0) return prev;
        return list;
      });
    } catch (err) {
      console.error('Sale Order Error:', err);
      if (isOnline !== true) setOrders((prev) => prev);
      else setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, isOnline, vehicleId]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    loadOrders();
    return () => unsub?.();
  }, [loadOrders, navigation]);

  useEffect(() => {
    if (isOnline === true) loadOrders();
  }, [isOnline]);

  const openDetails = (order) => {
    navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
  };

  const filteredOrders = useMemo(() => {
    const status = (o) => (o.invoice_status || '').toLowerCase().replace(/\s/g, '_');
    if (activeTab === TAB_INVOICED) {
      return orders.filter((o) => status(o) === 'invoiced');
    }
    return orders.filter((o) => status(o) !== 'invoiced');
  }, [orders, activeTab]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header: back, title, QR scan */}
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

      {/* Tabs: Invoiced (paid) / To Invoice (unpaid) */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_TO_INVOICE && styles.tabActive]}
          onPress={() => setActiveTab(TAB_TO_INVOICE)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === TAB_TO_INVOICE && styles.tabTextActive]}>
            To Invoice
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_INVOICED && styles.tabActive]}
          onPress={() => setActiveTab(TAB_INVOICED)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === TAB_INVOICED && styles.tabTextActive]}>
            Invoiced
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              {activeTab === TAB_INVOICED ? 'No invoiced orders' : 'No orders to invoice'}
            </Text>
            {isOnline !== true && (
              <Text style={[styles.emptyText, { fontSize: 13, marginTop: 8 }]}>
                You're offline. Sync when online to see orders.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={openDetails} />
        )}
      />
    </View>
  );
}

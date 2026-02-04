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
import { spacing, borderRadius } from '../constants/theme';
import { getCachedOrders } from '../services/sync.service';
import OrderCard from '../components/OrderCard';

export default function SaleOrderListScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { isOnline } = useNetwork();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

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
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
      }),
    [colors]
  );

  const loadOrders = useCallback(async () => {
    try {
      const data = await getCachedOrders(isOnline);
      let list = Array.isArray(data) ? data : [];
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
      }
      setOrders((prev) => {
        if (!isOnline && list.length === 0 && prev.length > 0) return prev;
        return list;
      });
    } catch (err) {
      console.error('Sale Order Error:', err);
      if (!isOnline) setOrders((prev) => prev);
      else setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, isOnline]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    loadOrders();
    return () => unsub?.();
  }, [loadOrders, navigation]);

  const openDetails = (order) => {
    navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
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

      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No orders</Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard order={item} onPress={openDetails} />
        )}
      />
    </View>
  );
}

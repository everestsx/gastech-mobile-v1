import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, spacing, borderRadius } from '../constants/theme';
import { getCachedOrders } from '../services/sync.service';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

function getTotalQty(order) {
  const lines = order.order_line;
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.length;
  }
  return '—';
}

export default function DailyVisitScreen({ route, navigation }) {
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCachedOrders();
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      let filtered = all.filter((o) => (o.date_order || '').startsWith(dateStr));
      if (customerId != null) {
        filtered = filtered.filter((o) => o.partner_id?.[0] === customerId);
      }
      setOrders(filtered);
    } catch (_) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, customerId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) setSelectedDate(date);
  };

  const openOrder = (order) => {
    navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
  };

  const openQRScan = () => {
    navigation.navigate('ScanQRCode', { returnTo: 'DailyVisit' });
  };

  const clearCustomerFilter = () => {
    navigation.setParams({ customerId: null });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openOrder(item)}
      activeOpacity={0.8}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.orderNo}>{item.name}</Text>
        <View style={[styles.badge, item.state === 'sale' ? styles.badgeSale : styles.badgeDraft]}>
          <Text style={styles.badgeText}>{(item.state || 'draft').toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.customer}>{item.partner_id?.[1] || '—'}</Text>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>Total Qty: {getTotalQty(item)}</Text>
        <Text style={styles.amount}>{formatCurrency(item.amount_total)}</Text>
      </View>
      {item.date_order ? (
        <Text style={styles.date}>{item.date_order}</Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Top bar: date picker + QR scan (same style as Sales Order screen) */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
          <Ionicons name="chevron-down" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openQRScan}
          style={styles.qrBtnHeader}
        >
          <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {customerId != null && (
        <TouchableOpacity
          style={styles.filterChip}
          onPress={clearCustomerFilter}
          activeOpacity={0.8}
        >
          <Text style={styles.filterChipText}>Showing one customer — tap to show all</Text>
          <Ionicons name="close-circle" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}

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
        <TouchableOpacity
          style={styles.doneDateBtn}
          onPress={() => setShowPicker(false)}
        >
          <Text style={styles.doneDateText}>Done</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>
                {customerId != null
                  ? 'No orders for this customer on this date'
                  : 'No orders for this date'}
              </Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    gap: 8,
  },
  dateText: { fontSize: 16, fontWeight: '600', color: colors.text },
  qrBtnHeader: { padding: 4 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  list: { padding: spacing.md, paddingBottom: 100 },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNo: { fontSize: 16, fontWeight: '700', color: colors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeSale: { backgroundColor: colors.success },
  badgeDraft: { backgroundColor: colors.warning },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  customer: { fontSize: 15, color: colors.textSecondary, marginVertical: 6 },
  meta: { fontSize: 13, color: colors.textSecondary },
  amount: { fontSize: 16, fontWeight: '800', color: colors.primary },
  date: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
  doneDateBtn: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  doneDateText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});

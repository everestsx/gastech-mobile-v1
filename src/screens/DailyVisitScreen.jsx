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
  return `₹${Number(amount).toFixed(2)}`;
}

export default function DailyVisitScreen({ navigation }) {
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
      const filtered = all.filter((o) => (o.date_order || '').startsWith(dateStr));
      setOrders(filtered);
    } catch (_) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

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
        <Text style={styles.date}>{item.date_order}</Text>
        <Text style={styles.amount}>{formatCurrency(item.amount_total)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.dateBar}>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
          <Ionicons name="chevron-down" size={20} color={colors.primary} />
        </TouchableOpacity>
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
              <Text style={styles.emptyText}>No orders for this date</Text>
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
  dateBar: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    gap: 8,
  },
  dateText: { fontSize: 16, fontWeight: '600', color: colors.text },
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
  date: { fontSize: 13, color: colors.textSecondary },
  amount: { fontSize: 16, fontWeight: '800', color: colors.primary },
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

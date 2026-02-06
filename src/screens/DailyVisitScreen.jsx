import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

export default function DailyVisitScreen({ route, navigation }) {
  const { colors } = useTheme();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  const styles = useMemo(
    () =>
      StyleSheet.create({
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
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
        doneDateBtn: {
          padding: 12,
          alignItems: 'center',
          backgroundColor: colors.surface,
        },
        doneDateText: { fontSize: 16, fontWeight: '600', color: colors.primary },
      }),
    [colors]
  );

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
      if (filtered.length === 0) {
        setOrders([]);
        return;
      }
      const [totals, pickings] = await Promise.all([
        getOrderLineTotalsFromDB(filtered),
        getPickingsBySaleIdsFromDB(filtered.map((o) => o.id)),
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
        filtered.map((o) => ({
          ...o,
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          isDelivered: saleIdToPickingState[o.id] === 'done',
        }))
      );
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

  const openQRScan = () => {
    navigation.navigate('ScanQRCode', { returnTo: 'DailyVisit' });
  };

  const clearCustomerFilter = () => {
    navigation.setParams({ customerId: null });
  };

  const renderItem = ({ item }) => (
    <OrderCard order={item} onPress={onOrderPress} isDelivered={item.isDelivered} />
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

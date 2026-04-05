import React, { useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import OrderCard from '../components/OrderCard';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import { getCheckoutResumeMap } from '../services/checkoutResume.service';

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

export default function DailyVisitScreen({ route, navigation }) {
  const { colors, syncDateField } = useTheme();
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutResumeMap, setCheckoutResumeMap] = useState({});

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.sm,
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
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const data = await getCachedOrders(vehicleId);
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      let filtered = all.filter((o) => {
        const selectedDateValue = syncDateField === 'delivery_date' ? o.commitment_date : o.date_order;
        return String(selectedDateValue || '').startsWith(dateStr);
      });
      if (customerId != null) {
        filtered = filtered.filter((o) => o.partner_id?.[0] === customerId);
      }
      if (filtered.length === 0) {
        const resumeOnly = await getCheckoutResumeMap();
        setCheckoutResumeMap(resumeOnly && typeof resumeOnly === 'object' ? resumeOnly : {});
        setOrders([]);
        return;
      }
      const orderIds = filtered.map((o) => o.id);
      const [totals, pickings, allLines, resumeMap] = await Promise.all([
        getOrderLineTotalsFromDB(filtered),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
        getCheckoutResumeMap(),
      ]);
      setCheckoutResumeMap(resumeMap && typeof resumeMap === 'object' ? resumeMap : {});
      const saleIdToPickingState = {};
      (pickings || []).forEach((p) => {
        const saleId = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
        if (saleId != null) {
          if (p.state === 'done') saleIdToPickingState[saleId] = 'done';
          else if (saleIdToPickingState[saleId] !== 'done') saleIdToPickingState[saleId] = p.state;
        }
      });
      const linesByOrderId = {};
      (allLines || []).forEach((line) => {
        const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
        if (oid != null) {
          if (!linesByOrderId[oid]) linesByOrderId[oid] = [];
          linesByOrderId[oid].push(line);
        }
      });
      setOrders(
        filtered.map((o) => ({
          ...o,
          totalQty: totals[o.id] != null ? totals[o.id] : null,
          isDelivered: saleIdToPickingState[o.id] === 'done',
          orderLines: linesByOrderId[o.id] || [],
        }))
      );
    } catch (_) {
      setOrders([]);
      setCheckoutResumeMap({});
    } finally {
      setLoading(false);
    }
  }, [selectedDate, customerId, syncDateField]);

  useFocusEffect(
    useCallback(() => {
      void loadOrders();
    }, [loadOrders])
  );

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) setSelectedDate(date);
  };

  const onOrderPress = (order) => {
    const entry = checkoutResumeMap[String(order.id)];
    if (entry?.invoiceParams) {
      if (entry.phase === 'payment_proof') {
        navigation.navigate('PaymentProof', {
          saleOrderId: order.id,
          creditProofRequired: entry.invoiceParams.creditProofRequired === true,
          orderName: entry.invoiceParams.orderName,
        });
        return;
      }
      navigation.navigate('InvoiceScreen', entry.invoiceParams);
      return;
    }
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
    <OrderCard
      order={item}
      orderLines={item.orderLines}
      onPress={onOrderPress}
      isDelivered={item.isDelivered}
      checkoutResumePhase={checkoutResumeMap[String(item.id)]?.phase ?? null}
    />
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
        <SyncHeaderBadge variant="surface" />
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

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useNetwork } from '../context/NetworkContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedCustomers } from '../services/sync.service';

export default function CustomersScreen({ navigation }) {
  const { colors } = useTheme();
  const { isOnline } = useNetwork();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        list: { padding: spacing.md, paddingBottom: 100 },
        listEmpty: { flexGrow: 1 },
        item: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.md,
          marginBottom: spacing.sm,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 3,
        },
        itemIcon: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          marginRight: spacing.md,
        },
        itemContent: { flex: 1 },
        itemName: { fontSize: 16, fontWeight: '600', color: colors.text },
        itemPhone: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
        empty: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: spacing.xl,
        },
        emptyText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary, marginTop: 8 },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
      }),
    [colors]
  );

  const loadCustomers = useCallback(async () => {
    try {
      const data = await getCachedCustomers(isOnline);
      const next = Array.isArray(data) ? data : [];
      setCustomers((prev) => {
        if (!isOnline && next.length === 0 && prev.length > 0) return prev;
        return next;
      });
    } catch (_) {
      if (!isOnline) setCustomers((prev) => prev);
      else setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadCustomers);
    loadCustomers();
    return () => unsub?.();
  }, [loadCustomers, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCustomers();
    setRefreshing(false);
  };

  const onCustomerPress = (customer) => {
    navigation.navigate('Orders', { customerId: customer.id });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => onCustomerPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.itemIcon}>
        <Ionicons name="person-outline" size={22} color={colors.primary} />
      </View>
      <View style={styles.itemContent}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name || '—'}
        </Text>
        {item.phone ? (
          <Text style={styles.itemPhone} numberOfLines={1}>
            {item.phone}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={customers}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      contentContainerStyle={[
        styles.list,
        customers.length === 0 && styles.listEmpty,
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
          <Text style={styles.emptyText}>No customers yet</Text>
          <Text style={styles.emptyHint}>Sync from Menu to load customers</Text>
        </View>
      }
    />
  );
}

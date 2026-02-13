import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getUserSession, getCachedVehicleInventory } from '../services/sync.service';

export default function VehicleStockScreen({ navigation }) {
  const { colors } = useTheme();
  const [user, setUser] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const session = await getUserSession();
    setUser(session || null);
    if (session?.isAdmin === false && session.vehicleId != null) {
      const list = await getCachedVehicleInventory(session.vehicleId);
      setInventory(Array.isArray(list) ? list : []);
    } else {
      setInventory([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await load();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', load);
    return () => unsub?.();
  }, [load, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { flex: 1, padding: spacing.lg },
        empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
        emptyText: { fontSize: 16, color: colors.textSecondary, textAlign: 'center' },
        hint: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.md,
          marginBottom: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
        },
        productName: { fontSize: 16, fontWeight: '600', color: colors.text },
        row: { flexDirection: 'row', marginTop: 6, gap: spacing.lg },
        label: { fontSize: 14, color: colors.textSecondary },
        value: { fontSize: 14, fontWeight: '600', color: colors.text },
      }),
    [colors]
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.empty]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (user?.isAdmin !== false) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.emptyText}>My Stocks</Text>
        <Text style={styles.hint}>Log in as a vehicle to see that vehicle's product stock.</Text>
      </View>
    );
  }

  if (inventory.length === 0) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.emptyText}>No stock data for this vehicle</Text>
        <Text style={styles.hint}>Sync to load vehicle inventory from the server.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={inventory}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.productName}>{item.product_name || `Product ${item.product_id}`}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Quantity:</Text>
              <Text style={styles.value}>{Number(item.quantity)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Available:</Text>
              <Text style={styles.value}>{Number(item.available_quantity)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

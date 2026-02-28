import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getUserSession, getCachedVehicleInventoryByLocation, getVehicleLocationId } from '../services/sync.service';

const CARD_MIN_WIDTH = 160;
const CARD_GAP = spacing.md;

/**
 * Strips the product code prefix (e.g., "[GAS5] ") from product names.
 * "[GAS5] Gas 5 kg" -> "Gas 5 kg"
 */
function formatProductName(name) {
  if (!name) return '—';
  // Remove prefix like "[GAS5] " or "[GAS12.5] "
  return name.replace(/^\[[^\]]+\]\s*/, '').trim() || name;
}

function StockCard({ item, colors, cardWidth, isLeft }) {
  const qty = Number(item.quantity) || 0;
  const available = Number(item.available_quantity) ?? qty;
  const rawName = item.product_name || `Product ${item.product_id || ''}`.trim() || '—';
  const name = formatProductName(rawName);
  const lowStock = available <= 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, width: cardWidth },
        isLeft && { marginRight: CARD_GAP },
      ]}
    >
      <View style={[styles.cardAccent, { backgroundColor: lowStock ? colors.error : colors.primary }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardIconWrap}>
          <Ionicons
            name="cube-outline"
            size={28}
            color={lowStock ? colors.error : colors.primary}
          />
        </View>
        <Text style={[styles.cardProductName, { color: colors.text }]} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.cardQtyRow}>
          <Text style={[styles.cardQtyValue, { color: colors.text }]}>{qty}</Text>
          <Text style={[styles.cardQtyLabel, { color: colors.textSecondary }]}>On hand</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: lowStock ? colors.error + '20' : colors.primarySurface }]}>
          <Text style={[styles.badgeText, { color: lowStock ? colors.error : colors.primary }]}>
            {available} available
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: CARD_GAP,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardAccent: {
    height: 4,
    width: '100%',
  },
  cardContent: {
    padding: spacing.md,
  },
  cardIconWrap: {
    marginBottom: spacing.sm,
  },
  cardProductName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  cardQtyRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: spacing.xs,
  },
  cardQtyValue: {
    fontSize: 26,
    fontWeight: '800',
  },
  cardQtyLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

export default function VehicleStockScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [user, setUser] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const numColumns = 2;
  const horizontalGap = CARD_GAP;
  const paddingH = spacing.lg;
  const cardWidth = (width - paddingH * 2 - horizontalGap * (numColumns - 1)) / numColumns;

  // const load = useCallback(async () => {
  //   const session = await getUserSession();
  //   setUser(session || null);
  //
  //   // Convert to Number to ensure SQLite match
  //   const vId = session?.vehicleId ? Number(session.vehicleId) : null;
  //
  //   if (vId) {
  //     const data = await getCachedVehicleInventory(vId);
  //     console.log(`[UI Debug] Found ${data.length} items for vehicle ${vId}`);
  //     setInventory(Array.isArray(data) ? data : []);
  //   } else {
  //     setInventory([]);
  //   }
  // }, []);

const load = useCallback(async (forceRefresh = false) => {
  const session = await getUserSession();
  setUser(session || null);

  const vId = session?.vehicleId ? Number(session.vehicleId) : null;

  if (vId) {
    // Get the location_id for this vehicle
    const locationId = await getVehicleLocationId(vId);
    console.log(`[UI Debug] Vehicle ${vId} has location_id: ${locationId}`);

    if (locationId) {
      // Fetch inventory by location_id instead of vehicle_id
      const data = await getCachedVehicleInventoryByLocation(locationId);
      console.log(`[UI Debug] Found ${data.length} items for location ${locationId}`, data);
      setInventory(Array.isArray(data) ? data : []);
    } else {
      console.warn(`[UI Debug] No location_id found for vehicle ${vId}`);
      setInventory([]);
    }
  } else {
    setInventory([]);
  }
}, []);

// Update the focus listener to force refresh
useEffect(() => {
  const unsub = navigation.addListener?.('focus', () => load(true));
  return () => unsub?.();
}, [load, navigation]);
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

  const screenStyles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: {
          padding: spacing.lg,
          paddingBottom: spacing.xl + insets.bottom,
        },
        empty: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.xl,
        },
        emptyText: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
        hint: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.lg },
        grid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
        },
        summaryBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.lg,
          paddingVertical: spacing.sm,
        },
        summaryText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
        summaryCount: { fontSize: 14, fontWeight: '800', color: colors.primary },
      }),
    [colors, insets.bottom]
  );

  if (loading) {
    return (
      <View style={[screenStyles.container, screenStyles.empty]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[screenStyles.hint, { marginTop: spacing.md }]}>Loading vehicle stock…</Text>
      </View>
    );
  }


  if (inventory.length === 0) {
    return (
      <View style={[screenStyles.container, screenStyles.empty]}>
        <Ionicons name="archive-outline" size={56} color={colors.textSecondary} style={{ marginBottom: spacing.md }} />
        <Text style={screenStyles.emptyText}>No stock data for this vehicle</Text>
        <Text style={screenStyles.hint}>Sync from the dashboard to load vehicle inventory from the server.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={screenStyles.container}
      contentContainerStyle={screenStyles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={screenStyles.summaryBar}>
        <Text style={screenStyles.summaryText}>Item-wise stock</Text>
        <Text style={screenStyles.summaryCount}>{inventory.length} product{inventory.length !== 1 ? 's' : ''}</Text>
      </View>
      <View style={screenStyles.grid}>
        {inventory.map((item, index) => (
          <StockCard
            key={String(item.id)}
            item={item}
            colors={colors}
            cardWidth={cardWidth}
            isLeft={index % 2 === 0}
          />
        ))}
      </View>
    </ScrollView>
  );
}

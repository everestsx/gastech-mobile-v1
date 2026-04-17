import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { spacing, borderRadius } from '../constants/theme';
import { getUserSession, getCachedVehicleInventoryByLocation, getVehicleLocationId, getCachedOrders, getPickingsBySaleIdsFromDB, getOrderLinesByOrderIdsFromDB } from '../services/sync.service';
import { getGasTypeBlueColor, parseKgFromProductName } from '../utils/productDisplay';
import { buildDefaultGasVehicleInventoryRows } from '../utils/defaultGasStock';
import { getProductImageSource } from '../utils/gasImage';
import * as syncQueueDb from '../database/syncQueue.js';
import * as productsDb from '../database/products.js';
import { canonicalKgFromName, isEmptyCylinderName } from '../utils/cylinderCatalog';

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

function formatLocalYyyyMmDd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function orderDateToLocalDay(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const isoLike = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoLike) return isoLike[0];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : formatLocalYyyyMmDd(parsed);
}

const LOGO_SIZE = 48;

function StockCard({ item, colors, cardWidth, isLeft, productImageUri, deliveredQty, emptyCollectedQty, emptyOnHandQty }) {
  const rawName = item.product_name || `Product ${item.product_id || ''}`.trim() || '—';
  const name = formatProductName(rawName);
  const stockQuantity = Math.max(0, Number(item.quantity) || 0);
  const extra = Math.max(0, Number(item.available_quantity ?? item.extra_quantity ?? 0) || 0);
  const onHand = stockQuantity;
  const ordered = Math.max(0, onHand - extra);
  const delivered = Math.max(0, Number(deliveredQty) || 0);
  const lowStock = onHand <= 0;
  const logoSource = productImageUri ? { uri: productImageUri } : getProductImageSource(rawName);
  const isGasCylinder = parseKgFromProductName(rawName) != null;
  const accentColor = isGasCylinder ? getGasTypeBlueColor(rawName) : (colors.primary ?? '#6366f1');

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : accentColor, borderWidth: lowStock ? 2 : 2.5, width: cardWidth },
        isLeft && { marginRight: CARD_GAP },
      ]}
    >
      <View style={[styles.cardAccent, { backgroundColor: lowStock ? colors.error : accentColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardIconWrap}>
          {logoSource ? (
            <Image source={logoSource} style={styles.productLogo} resizeMode="contain" />
          ) : (
            <Ionicons
              name="cube-outline"
              size={28}
              color={lowStock ? colors.error : accentColor}
            />
          )}
        </View>
        <Text style={[styles.cardProductName, { color: colors.text }]} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.stockRowsWrap}>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>On Hand Stock</Text>
            <Text style={[styles.stockRowValue, { color: colors.text }]}>{onHand}</Text>
          </View>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>Ordered Stock</Text>
            <Text style={[styles.stockRowValue, { color: colors.text }]}>{ordered}</Text>
          </View>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>Extra Stock</Text>
            <Text style={[styles.stockRowValue, { color: colors.text }]}>{extra}</Text>
          </View>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>Delivered</Text>
            <Text style={[styles.stockRowValue, { color: delivered > 0 ? '#16a34a' : colors.textSecondary }]}>{delivered}</Text>
          </View>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>Empty Collected</Text>
            <Text style={[styles.stockRowValue, { color: (Number(emptyCollectedQty) || 0) > 0 ? '#0f766e' : colors.textSecondary }]}>
              {Number(emptyCollectedQty) || 0}
            </Text>
          </View>
          <View style={styles.stockRow}>
            <Text style={[styles.stockRowLabel, { color: colors.textSecondary }]}>Empty Stock</Text>
            <Text style={[styles.stockRowValue, { color: colors.text }]}>
              {Number(emptyOnHandQty) || 0}
            </Text>
          </View>
        </View>
        <View style={[styles.badge, { backgroundColor: lowStock ? colors.error + '20' : accentColor + '20' }]}>
          <Text style={[styles.badgeText, { color: lowStock ? colors.error : accentColor }]}>
            {lowStock ? 'Out of stock' : 'In stock'}
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
  productLogo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  cardProductName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  stockRowsWrap: {
    marginBottom: spacing.sm,
    gap: 4,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockRowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  stockRowValue: {
    fontSize: 15,
    fontWeight: '800',
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
  const { colors, syncDateField } = useTheme();
  const { syncCompleteTimestamp } = useSync();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [user, setUser] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [productIdToImageUri, setProductIdToImageUri] = useState({});
  const [productIdToName, setProductIdToName] = useState({});
  const [productStatsById, setProductStatsById] = useState({});
  const [emptyCollectedByKg, setEmptyCollectedByKg] = useState({});
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
  setProductStatsById({});
  const session = await getUserSession();
  setUser(session || null);
  const [imageMap, productNameMap] = await Promise.all([
    productsDb.getProductImageUriMap(),
    productsDb.getProductsMap(),
  ]);
  setProductIdToImageUri(imageMap || {});
  setProductIdToName(productNameMap || {});

  const getOrderDateForSyncMode = (order) => {
    const preferred = syncDateField === 'delivery_date' ? order?.commitment_date : order?.date_order;
    const fallback = order?.date_order || order?.commitment_date;
    return String(preferred || fallback || '');
  };

  const vId = session?.vehicleId ? Number(session.vehicleId) : null;

  if (vId) {
    const locationId = await getVehicleLocationId(vId);
    console.log(`[UI Debug] Vehicle ${vId} has location_id: ${locationId}`);

    const orders = await getCachedOrders(vId);
    const todayLocal = formatLocalYyyyMmDd(new Date());
    const todayOrders = (Array.isArray(orders) ? orders : []).filter((o) =>
      getOrderDateForSyncMode(o).startsWith(todayLocal)
    );
    const orderIds = todayOrders.map((o) => Number(o?.id)).filter((id) => Number.isFinite(id));

    const [orderLines, pickings, data] = await Promise.all([
      orderIds.length ? getOrderLinesByOrderIdsFromDB(orderIds) : Promise.resolve([]),
      orderIds.length ? getPickingsBySaleIdsFromDB(orderIds) : Promise.resolve([]),
      locationId ? getCachedVehicleInventoryByLocation(locationId) : Promise.resolve([]),
    ]);

    const deliveredOrderIds = new Set(
      todayOrders
        .filter((o) => String(o?.invoice_status || '').toLowerCase() === 'invoiced')
        .map((o) => Number(o?.id))
        .filter((id) => Number.isFinite(id))
    );
    (pickings || [])
      .filter((p) => String(p?.state || '').toLowerCase() === 'done')
      .forEach((p) => {
        const saleId = Array.isArray(p?.sale_id) ? p.sale_id[0] : p?.sale_id;
        const saleNum = Number(saleId);
        if (Number.isFinite(saleNum)) deliveredOrderIds.add(saleNum);
      });

    const deliveredByProductId = {};
    (orderLines || []).forEach((line) => {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const pid = pidRaw != null ? Number(pidRaw) : null;
      if (soId == null || pid == null || !Number.isFinite(pid)) return;
      const qty = Number(line.product_uom_qty) || 0;
      if (deliveredOrderIds.has(soId)) {
        deliveredByProductId[pid] = (deliveredByProductId[pid] || 0) + qty;
      }
    });
    setProductStatsById(
      Object.keys(deliveredByProductId).reduce((acc, key) => {
        const pid = Number(key);
        acc[pid] = { delivered: deliveredByProductId[pid] || 0 };
        return acc;
      }, {})
    );
    const paymentPayloadMap = orderIds.length
      ? await syncQueueDb.getLatestPaymentPayloadMapBySaleOrderIds(orderIds)
      : {};
    const nextEmptyByKg = {};
    for (const soId of orderIds) {
      const payload = paymentPayloadMap?.[Number(soId)]?.payload || {};
      const entries = Array.isArray(payload?.emptyCylinderEntries) ? payload.emptyCylinderEntries : [];
      for (const entry of entries) {
        const kg = Number(entry?.kg);
        const qty = Number(entry?.emptyCollectedQty) || 0;
        if (!Number.isFinite(kg) || qty <= 0) continue;
        nextEmptyByKg[kg] = (nextEmptyByKg[kg] || 0) + qty;
      }
    }
    setEmptyCollectedByKg(nextEmptyByKg);

    if (locationId) {
      console.log(`[UI Debug] Found ${data.length} items for location ${locationId}`, data);
      setInventory(Array.isArray(data) ? data : []);
    } else {
      console.warn(`[UI Debug] No location_id found for vehicle ${vId}`);
      setInventory([]);
      setProductStatsById({});
      setEmptyCollectedByKg({});
    }
  } else {
    setInventory([]);
    setProductStatsById({});
    setEmptyCollectedByKg({});
  }
}, [syncDateField]);

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
    load(true).catch(() => {});
  }, [syncCompleteTimestamp, load]);

  /** Four default cylinder sizes only; merge API/local rows, pad missing sizes with 0 on-hand / 0 extra. */
  const visibleInventory = useMemo(() => {
    if (!user?.vehicleId) return [];
    return buildDefaultGasVehicleInventoryRows(inventory || [], productIdToName);
  }, [inventory, productIdToName, user?.vehicleId]);
  const emptyStockByKg = useMemo(() => {
    const map = {};
    for (const row of inventory || []) {
      const pid = row?.product_id != null ? Number(row.product_id) : null;
      const name = (pid != null ? productIdToName?.[pid] : null) || row?.product_name || '';
      if (!isEmptyCylinderName(name)) continue;
      const kg = canonicalKgFromName(name);
      if (kg == null) continue;
      const qty = Number(row?.available_quantity ?? row?.quantity) || 0;
      map[kg] = (map[kg] || 0) + Math.max(0, qty);
    }
    return map;
  }, [inventory, productIdToName]);

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
        notSyncedText: {
          fontSize: 12,
          color: colors.error || '#dc2626',
          marginBottom: spacing.md,
          textAlign: 'center',
        },
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

  const hasVehicle = !!user?.vehicleId;
  const hasData = hasVehicle && visibleInventory.length > 0;
  const hasRawInventory = inventory.length > 0;

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
        {/* <Text style={screenStyles.summaryCount}>
          {visibleInventory.length} gas size{visibleInventory.length !== 1 ? 's' : ''}
        </Text> */}
      </View>
  
      <View style={screenStyles.grid}>
        {hasData ? (
          visibleInventory.map((item, index) => (
            <StockCard
              key={String(item.display_key ?? item.id)}
              item={{
                ...item,
                product_name: item.product_id != null
                  ? (productIdToName[item.product_id] || item.product_name)
                  : item.product_name,
              }}
              colors={colors}
              cardWidth={cardWidth}
              isLeft={index % 2 === 0}
              productImageUri={item.product_id != null ? productIdToImageUri[item.product_id] : null}
              deliveredQty={item.product_id != null ? (productStatsById[item.product_id]?.delivered ?? 0) : 0}
              emptyCollectedQty={(() => {
                const name = item.product_id != null
                  ? (productIdToName[item.product_id] || item.product_name)
                  : item.product_name;
                const kg = parseKgFromProductName(String(name || ''));
                return kg != null ? (emptyCollectedByKg[kg] || 0) : 0;
              })()}
              emptyOnHandQty={(() => {
                const name = item.product_id != null
                  ? (productIdToName[item.product_id] || item.product_name)
                  : item.product_name;
                const kg = parseKgFromProductName(String(name || ''));
                return kg != null ? (emptyStockByKg[kg] || 0) : 0;
              })()}
            />
          ))
        ) : !hasVehicle ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, width: cardWidth * 2 + CARD_GAP, marginBottom: CARD_GAP }]}>
            <View style={[styles.cardAccent, { backgroundColor: colors.border }]} />
            <View style={styles.cardContent}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="cube-outline" size={28} color={colors.textSecondary} />
              </View>
              <Text style={[styles.cardProductName, { color: colors.textSecondary }]}>No vehicle in session</Text>
              <Text style={[screenStyles.hint, { marginTop: spacing.xs }]}>Log in with a vehicle to see lorry stock.</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

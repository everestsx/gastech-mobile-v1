import { useTranslation } from 'react-i18next';
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
import * as productsDb from '../database/products.js';
import { canonicalKgFromName, isEmptyCylinderName, isGasCylinderName } from '../utils/cylinderCatalog';

const STOCK_BADGE_BLUE = '#2563eb';

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

function StockCard({ item, colors, cardWidth, isLeft, productImageUri, deliveredQty, emptyOnHandQty }) {
  const rawName = item.product_name || `Product ${item.product_id || ''}`.trim() || '—';
  const name = formatProductName(rawName);
  const stockQuantity = Math.max(0, Number(item.quantity) || 0);
  const extra = Math.max(0, Number(item.available_quantity ?? item.extra_quantity ?? 0) || 0);
  const outgoing = Math.max(0, Number(item.outgoing_quantity) || 0);
  const onHand = stockQuantity;
  const ordered = outgoing;
  const delivered = Math.max(0, Number(deliveredQty) || 0);
  const lowStock = onHand <= 0;
  const logoSource = productImageUri ? { uri: productImageUri } : getProductImageSource(rawName);
  const isGasCylinder = parseKgFromProductName(rawName) != null;
  const accentColor = isGasCylinder ? getGasTypeBlueColor(rawName) : (colors.primary ?? '#6366f1');

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : colors.border, borderWidth: 1, width: cardWidth },
        isLeft && { marginRight: CARD_GAP },
      ]}
    >
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
        <Text style={[styles.stockAvailableLabel, { color: colors.textSecondary }]}>Stock Available</Text>
        <Text style={[styles.stockAvailableValue, { color: colors.text }]}>{onHand}</Text>
        <View style={styles.statStrip}>
          <View style={styles.statCell}>
            <View style={styles.statHead}>
              <Ionicons name="bus-outline" size={18} color="#315cbf" />
              <Ionicons name="arrow-up" size={12} color="#315cbf" />
            </View>
            <Text style={styles.statLabel}>Ordered: {ordered}</Text>
          </View>
          <View style={[styles.statCell, styles.statCellMid]}>
            <View style={styles.statHead}>
              <Ionicons name="cube-outline" size={18} color="#8b5e2b" />
              <Ionicons name="arrow-up" size={12} color="#8b5e2b" />
            </View>
            <Text style={styles.statLabel}>Extra (Free): {extra}</Text>
          </View>
          <View style={styles.statCell}>
            <View style={styles.statHead}>
              <Ionicons name="people-outline" size={18} color="#15803d" />
              <Ionicons name="checkmark-circle" size={12} color="#15803d" />
            </View>
            <Text style={[styles.statLabel, { color: '#15803d' }]}>Delivered: {delivered}</Text>
          </View>
        </View>
        {isGasCylinderName(rawName) ? (
          <View style={styles.emptyRowsWrap}>
            <View style={styles.emptyRow}>
              <Text style={styles.emptyLabel}>Empty On-hand</Text>
              <Text style={[styles.emptyValue, { color: '#0f766e' }]}>{Number(emptyOnHandQty) || 0}</Text>
            </View>
          </View>
        ) : null}
        <View style={[styles.badge, { backgroundColor: lowStock ? colors.error + '20' : STOCK_BADGE_BLUE + '20' }]}>
          <Text style={[styles.badgeText, { color: lowStock ? colors.error : STOCK_BADGE_BLUE }]}>
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
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  cardContent: {
    padding: spacing.sm + 2,
  },
  cardIconWrap: {
    marginBottom: 6,
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
  productLogo: {
    width: 32,
    height: 32,
  },
  cardProductName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    minHeight: 34,
  },
  stockAvailableLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  stockAvailableValue: {
    fontSize: 49,
    fontWeight: '900',
    lineHeight: 52,
    marginBottom: 4,
  },
  statStrip: {
    flexDirection: 'row',
    backgroundColor: '#e8effa',
    borderRadius: 0,
    overflow: 'hidden',
    marginBottom: 10,
    marginHorizontal: -10,
    paddingHorizontal: 2,
  },
  statCell: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  statCellMid: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#c8d7ef',
  },
  statHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 1,
  },
  statLabel: {
    fontSize: 10,
    color: '#1f2937',
    fontWeight: '600',
  },
  emptyRowsWrap: {
    marginBottom: spacing.sm,
    gap: 5,
  },
  emptyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyLabel: {
    fontSize: 12,
    color: '#374151',
  },
  emptyValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

export default function VehicleStockScreen({ navigation }) {
  const { t } = useTranslation();
  const { colors, syncDateField } = useTheme();
  const { syncCompleteTimestamp } = useSync();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [user, setUser] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [productIdToImageUri, setProductIdToImageUri] = useState({});
  const [productIdToName, setProductIdToName] = useState({});
  const [productStatsById, setProductStatsById] = useState({});
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
    // console.log(`[UI Debug] Vehicle ${vId} has location_id: ${locationId}`);

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
    if (locationId) {
      console.log(`[UI Debug] Found ${data.length} items for location ${locationId}`, data);
      setInventory(Array.isArray(data) ? data : []);
    } else {
      console.warn(`[UI Debug] No location_id found for vehicle ${vId}`);
      setInventory([]);
      setProductStatsById({});
    }
  } else {
    setInventory([]);
    setProductStatsById({});
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
      // Match Dashboard logic: empty on-hand comes from inventory quantity.
      const qty = Number(row?.quantity) || 0;
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
        <Text style={[screenStyles.hint, { marginTop: spacing.md }]}>{t('vehiclestock.loadingVehicleStock', 'Loading vehicle stock…')}</Text>
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
        <Text style={screenStyles.summaryText}>{t('vehiclestock.itemWiseStock', 'Item-wise stock')}</Text>
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
              emptyOnHandQty={(() => {
                const name = item.product_id != null
                  ? (productIdToName[item.product_id] || item.product_name)
                  : item.product_name;
                const kg = parseKgFromProductName(String(name || ''));
                return kg != null ? (emptyStockByKg[kg] || 0) : 0;
              })()}
              t={t}
            />
          ))
        ) : !hasVehicle ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, width: cardWidth * 2 + CARD_GAP, marginBottom: CARD_GAP }]}>
            <View style={styles.cardContent}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="cube-outline" size={28} color={colors.textSecondary} />
              </View>
              <Text style={[styles.cardProductName, { color: colors.textSecondary }]}>{t('vehiclestock.noVehicleInSession', 'No vehicle in session')}</Text>
              <Text style={[screenStyles.hint, { marginTop: spacing.xs }]}>{t('vehiclestock.logInWithAVehicleToSeeLorryStock', 'Log in with a vehicle to see lorry stock.')}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

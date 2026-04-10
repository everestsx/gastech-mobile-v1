import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  LayoutAnimation,
  UIManager,
  Image,
  Modal,
  Pressable,
  Linking,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { dashboardConfig } from '../constants/dashboardConfig';
import { getGasTypeBlueColor } from '../utils/productDisplay';
import { buildDefaultGasDashboardStockCards } from '../utils/defaultGasStock';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import {
  getCachedOrders,
  getCachedRoutes,
  getLastSyncTime,
  getSyncLogRecent,
  getUserSession,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
  getOrderLinesByOrderIdsFromDB,
} from '../services/sync.service';
import * as localPaymentsDb from '../database/localPayments.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import {
  getActiveCommissionPlan,
  calculateCommissionProgressByProducts,
} from '../services/commission.service';
import * as productsDb from '../database/products.js';
import * as deliveryQtyDb from '../database/deliveryQty.js';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import DeliveryProgressBarChart from '../components/DeliveryProgressBarChart';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import { useSync } from '../context/SyncContext';
import { odooImageToUri } from '../services/employee.service';
import {
  mergePickingStateBySaleIdFromRows,
  orderIsDeliveryDoneForProgress,
} from '../utils/deliveryProgress.js';
import {
  getCheckoutResumeMap,
  pendingCheckoutSaleOrderIdsFromResumeMap,
} from '../services/checkoutResume.service';

// const SHOPS_TARGET = 60;
// const GAS_TARGET = 6000;

/** Sample data for Delivery Progress by Shop when no real data. */
const SAMPLE_DELIVERY_BY_SHOP = [
  { shopId: 'S1', shopName: 'ABC Gas Agency', delivered: 45, pending: 12 },
  { shopId: 'S2', shopName: 'Green Valley Stores', delivered: 38, pending: 0 },
  { shopId: 'S3', shopName: 'Metro Traders', delivered: 28, pending: 15 },
  { shopId: 'S4', shopName: 'Sunrise Enterprises', delivered: 0, pending: 22 },
  { shopId: 'S5', shopName: 'Central Gas Hub', delivered: 52, pending: 8 },
  { shopId: 'S6', shopName: 'Corner Shop', delivered: 18, pending: 5 },
];

function formatCurrency(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatShort(amount) {
  const n = Number(amount) || 0;
  if (n >= 1000) return `Rs. ${(n / 1000).toFixed(0)}K`;
  return `Rs. ${n}`;
}

/** Prefer a route named like "high" orders; else route with most orders today; else first cached route. */
function pickDefaultDashboardRouteId(routesList, todayOrdersList) {
  const list = routesList || [];
  const high = list.find((r) => /high/i.test(String(r?.name || '')));
  if (high?.id != null) return Number(high.id);
  const counts = {};
  for (const o of todayOrdersList || []) {
    const rid = o?.route_id?.[0] ?? o?.route_id;
    if (rid == null) continue;
    const n = Number(rid);
    if (!Number.isFinite(n)) continue;
    counts[n] = (counts[n] || 0) + 1;
  }
  let best = null;
  let bestC = -1;
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestC) {
      bestC = c;
      best = Number(k);
    }
  }
  if (best != null) return best;
  return list[0]?.id != null ? Number(list[0].id) : null;
}

function safePercentDisplay(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((p / t) * 100)));
}

function normalizePaymentType(rawType) {
  const t = String(rawType || '').toLowerCase().trim();
  if (t === 'check') return 'cheque';
  if (t === 'cash' || t === 'cheque' || t === 'credit') return t;
  return '';
}

/** Local calendar YYYY-MM-DD (avoid UTC day-shift from toISOString()). */
function formatLocalYyyyMmDd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const GAS_IMAGE_BY_KEYWORD = [
  { keys: ['37.5', '37_5', '37-5', '375kg', '37.5kg'], image: require('../../assets/Gas_Image/37.5kg.png') },
  { keys: ['12.5', '12_5', '12-5', '125kg', '12.5kg'], image: require('../../assets/Gas_Image/gas12.5k.png') },
  { keys: ['5kg', '5 kg', ' 5 ', '5.0'], image: require('../../assets/Gas_Image/5kg.png') },
  { keys: ['2.3', '2_3', '2-3', '23kg', '2.3kg'], image: require('../../assets/Gas_Image/2.3kg.png') },
];

function getGasImageByProductName(productName) {
  const normalized = String(productName || '').toLowerCase();
  for (const item of GAS_IMAGE_BY_KEYWORD) {
    if (item.keys.some((k) => normalized.includes(k))) {
      return item.image;
    }
  }
  return null;
}

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { syncCompleteTimestamp } = useSync();
  const {
    colors,
    showCreateSalesOrder: userShowCreate,
    showReturnOrder: userShowReturn,
    syncDateField,
    appLanguage,
  } = useTheme();
  // Visibility from config file; user preference (theme/settings) can further hide when config allows
  const showCreateSalesOrder = dashboardConfig.showCreateSalesOrder && userShowCreate;
  const showReturnOrder = dashboardConfig.showReturnOrder && userShowReturn;
  const [orders, setOrders] = useState([]);
  const [user, setUser] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [lineTotalsByOrder, setLineTotalsByOrder] = useState({});
  const [pickingsBySaleId, setPickingsBySaleId] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [selectedChartDate, setSelectedChartDate] = useState(() => formatLocalYyyyMmDd(new Date()));
  const [showChartDatePicker, setShowChartDatePicker] = useState(false);
  const [chartLineTotalsByOrder, setChartLineTotalsByOrder] = useState({});
  const [chartPickingsBySaleId, setChartPickingsBySaleId] = useState([]);
  /** Sum of stock.move.line qty_done per sale order (partial delivery counts). */
  const [qtyDoneBySaleId, setQtyDoneBySaleId] = useState({});
  const [chartQtyDoneBySaleId, setChartQtyDoneBySaleId] = useState({});
  /** Sale orders with Odoo qty_delivered > 0 on any line (after sync). */
  const [backendQtyDeliveredOrderIds, setBackendQtyDeliveredOrderIds] = useState(() => new Set());
  const [pendingCheckoutOrderIds, setPendingCheckoutOrderIds] = useState(() => new Set());
  const [paymentSplitsByOrderId, setPaymentSplitsByOrderId] = useState({});
  // Commission state
  const [commissionPlan, setCommissionPlan] = useState(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [todayOrderLines, setTodayOrderLines] = useState([]);
  const [orderSyncStats, setOrderSyncStats] = useState({
    pendingOrders: 0,
    localCompleted: 0,
    syncedCompleted: 0,
  });

  // Stock overview (local lorry stock) computed from vehicle_inventories.
  const [stockCards, setStockCards] = useState([]);
  const [productIdToImageUri, setProductIdToImageUri] = useState({});

  // Collection cards: tap to expand one (shows full amount), tap again to collapse
  const [expandedCollectionCard, setExpandedCollectionCard] = useState(null);
  const [routeOverrideId, setRouteOverrideId] = useState(null);
  const [routePickerVisible, setRoutePickerVisible] = useState(false);
  const [profileModal, setProfileModal] = useState(null);

  const toggleCollectionCard = useCallback((key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCollectionCard((p) => (p === key ? null : key));
  }, []);

  const formatLocalDate = useCallback((d) => formatLocalYyyyMmDd(d), []);

  const getOrderDateForSyncMode = useCallback((order) => {
    const preferred = syncDateField === 'delivery_date' ? order?.commitment_date : order?.date_order;
    const fallback = order?.date_order || order?.commitment_date;
    return String(preferred || fallback || '');
  }, [syncDateField]);

  const loadData = useCallback(async () => {
    try {
      const [userData, routesData] = await Promise.all([
        getUserSession(),
        getCachedRoutes(),
      ]);
      const user = userData || null;
      setUser(user);
      setRoutes(Array.isArray(routesData) ? routesData : []);
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const [data, resumeMap] = await Promise.all([getCachedOrders(vehicleId), getCheckoutResumeMap()]);
      const pendingCheckoutSaleOrderIds = pendingCheckoutSaleOrderIdsFromResumeMap(resumeMap);
      setPendingCheckoutOrderIds(pendingCheckoutSaleOrderIds);
      setOrders(Array.isArray(data) ? data : []);
      const allCachedOrderIds = (Array.isArray(data) ? data : [])
        .map((o) => Number(o?.id))
        .filter((id) => Number.isFinite(id));
      const backendDeliveredSet =
        allCachedOrderIds.length > 0
          ? await saleOrderLinesDb.getSaleOrderIdsWithPositiveQtyDelivered(allCachedOrderIds)
          : new Set();
      setBackendQtyDeliveredOrderIds(backendDeliveredSet);
      const imageMap = await productsDb.getProductImageUriMap();
      setProductIdToImageUri(imageMap || {});
      const today = formatLocalDate(new Date());
      const todayOrders = (Array.isArray(data) ? data : []).filter((o) => getOrderDateForSyncMode(o).startsWith(today));
      console.log('todayOrders', todayOrders);
      const orderIds = todayOrders.map((o) => o.id);
      const [totals, pickings, orderLines, splits, qtyDoneMap] = await Promise.all([
        getOrderLineTotalsFromDB(todayOrders),
        orderIds.length ? getPickingsBySaleIdsFromDB(orderIds) : Promise.resolve([]),
        orderIds.length ? getOrderLinesByOrderIdsFromDB(orderIds) : Promise.resolve([]),
        orderIds.length ? localPaymentsDb.getPaymentSplitsBySaleOrderIds(orderIds) : Promise.resolve({}),
        orderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds) : Promise.resolve({}),
      ]);
      setLineTotalsByOrder(totals || {});
      setPickingsBySaleId(pickings || []);
      setQtyDoneBySaleId(qtyDoneMap || {});
      setTodayOrderLines(orderLines || []);
      setPaymentSplitsByOrderId(splits || {});

      const saleIdToPickState = mergePickingStateBySaleIdFromRows(pickings);

      const pendingQueueItems = await syncQueueDb.getPending();

      const pendingPaymentOrderIds = new Set(
        (pendingQueueItems || [])
          .filter((item) => item.action_type === syncQueueDb.ACTION_PAYMENT)
          .map((item) => Number(item.payload?.saleOrderId ?? item.payload?.sale_order_id))
          .filter((id) => Number.isFinite(id))
      );

      const localInvoiceSaleOrderIds = await localInvoicesDb.getSaleOrderIdsWithLocalInvoices();

      function orderCountsAsCompletedToday(order) {
        const oid = Number(order?.id);
        if (Number.isFinite(oid) && pendingCheckoutSaleOrderIds.has(oid)) return false;
        if (Number.isFinite(oid) && pendingPaymentOrderIds.has(oid)) return true;
        if (Number.isFinite(oid) && localInvoiceSaleOrderIds.has(oid)) return true;
        return orderIsDeliveryDoneForProgress(
          order,
          saleIdToPickState,
          qtyDoneMap,
          backendDeliveredSet,
          pendingCheckoutSaleOrderIds
        );
      }

      // Dashboard top indicators:
      // Active — not cancelled and not yet “delivery touched” (invoiced / picking / move qty_done / Odoo qty_delivered / local invoice / pay queue).
      // Pay pending (orange) — payment upload still queued, and (invoiced OR any delivery activity).
      // Synced (green) — no payment queue pending, and (invoiced OR any delivery activity) — includes partial backend delivery without full invoice.

      let pendingOrders = 0;
      let localCompleted = 0;
      let syncedCompleted = 0;

      for (const order of todayOrders) {
        if (String(order?.state || '') === 'cancel') continue;
        if (!orderCountsAsCompletedToday(order)) pendingOrders += 1;
      }

      for (const order of todayOrders) {
        if (String(order?.state || '') === 'cancel') continue;
        const orderId = Number(order?.id);
        if (!Number.isFinite(orderId)) continue;
        if (pendingCheckoutSaleOrderIds.has(orderId)) continue;
        const deliveryDone = orderIsDeliveryDoneForProgress(
          order,
          saleIdToPickState,
          qtyDoneMap,
          backendDeliveredSet,
          pendingCheckoutSaleOrderIds
        );
        const isInvoiced =
          String(order?.invoice_status || '').toLowerCase() === 'invoiced' ||
          localInvoiceSaleOrderIds.has(orderId);
        const payPending = pendingPaymentOrderIds.has(orderId);
        if (payPending && (isInvoiced || deliveryDone)) {
          localCompleted += 1;
        } else if (!payPending && (isInvoiced || deliveryDone)) {
          syncedCompleted += 1;
        }
      }

      setOrderSyncStats({
        pendingOrders,
        localCompleted,
        syncedCompleted,
      });

      // Stock overview:
      // pending in lorry = total loaded - delivered/invoiced quantity
      // Delivered quantity is derived from:
      // 1) sale_orders.invoice_status === 'invoiced' OR
      // 2) stock.picking.state === 'done'
      // across ALL cached orders (not just today's list), so dashboard stays accurate.
      try {
        if (vehicleId != null) {
          const allOrderIds = (Array.isArray(data) ? data : [])
            .map((o) => Number(o?.id))
            .filter((id) => Number.isFinite(id));
          const [allPickings, allOrderLines, allQtyDoneBySo] = await Promise.all([
            allOrderIds.length ? getPickingsBySaleIdsFromDB(allOrderIds) : Promise.resolve([]),
            allOrderIds.length ? getOrderLinesByOrderIdsFromDB(allOrderIds) : Promise.resolve([]),
            allOrderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(allOrderIds) : Promise.resolve({}),
          ]);

          const deliveredByPicking = new Set(
            (allPickings || [])
              .filter((p) => String(p?.state || '').toLowerCase() === 'done')
              .map((p) => {
                const saleId = Array.isArray(p?.sale_id) ? p.sale_id[0] : p?.sale_id;
                return Number(saleId);
              })
              .filter((id) => Number.isFinite(id))
          );

          const deliveredOrderIds = new Set(
            (Array.isArray(data) ? data : [])
              .filter((o) => String(o?.invoice_status || '').toLowerCase() === 'invoiced')
              .map((o) => Number(o?.id))
              .filter((id) => Number.isFinite(id))
          );
          for (const id of deliveredByPicking) deliveredOrderIds.add(id);
          for (const [soKey, sum] of Object.entries(allQtyDoneBySo || {})) {
            const sid = Number(soKey);
            if (Number.isFinite(sid) && Number(sum) > 0) deliveredOrderIds.add(sid);
          }
          for (const id of pendingCheckoutSaleOrderIds) {
            deliveredOrderIds.delete(id);
          }

          const deliveredQtyByProductId = {};
          for (const line of allOrderLines || []) {
            const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
            const soId = orderId != null ? Number(orderId) : null;
            if (soId == null || !deliveredOrderIds.has(soId)) continue;

            const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
            const pid = pidRaw != null ? Number(pidRaw) : null;
            if (pid == null || !Number.isFinite(pid)) continue;

            const qty = Number(line.product_uom_qty) || 0;
            deliveredQtyByProductId[pid] = (deliveredQtyByProductId[pid] || 0) + qty;
          }

          const [inventories, productNameMap] = await Promise.all([
            vehicleInventoriesDb.getVehicleInventoryByVehicleId(vehicleId),
            productsDb.getProductsMap(),
          ]);
          const byProduct = {};
          for (const inv of inventories || []) {
            const pid = inv?.product_id != null ? Number(inv.product_id) : null;
            if (pid == null) continue;
            const total = Number(inv.quantity) || 0;
            const delivered = Number(deliveredQtyByProductId[pid]) || 0;
            const remaining = Math.max(0, total - delivered);
            const resolvedName = (productNameMap && productNameMap[pid]) || inv?.product_name || `Product ${pid}`;
            byProduct[pid] = {
              product_id: pid,
              product_name: resolvedName,
              total,
              remaining,
            };
          }
          /** Always show the four default cylinder sizes; merge Odoo rows, fill missing with 0 on-hand / 0 remaining. */
          setStockCards(buildDefaultGasDashboardStockCards(Object.values(byProduct), productNameMap || {}));
        } else {
          setStockCards([]);
        }
      } catch (_) {
        setStockCards([]);
      }
    } catch (_) {
      setOrders([]);
      setLineTotalsByOrder({});
      setPickingsBySaleId([]);
      setQtyDoneBySaleId({});
      setTodayOrderLines([]);
      setPaymentSplitsByOrderId({});
      setOrderSyncStats({ pendingOrders: 0, localCompleted: 0, syncedCompleted: 0 });
      setBackendQtyDeliveredOrderIds(new Set());
      setPendingCheckoutOrderIds(new Set());
      setStockCards([]);
      setProductIdToImageUri({});
    } finally {
      setLoading(false);
    }
  }, [formatLocalDate, getOrderDateForSyncMode]);


  const loadCommissionData = useCallback(async () => {
    if (!user?.licensePlate) return;

    setCommissionLoading(true);
    try {
      const plan = await getActiveCommissionPlan(user.licensePlate);
      console.log('[Commission] Loaded plan:', plan);
      setCommissionPlan(plan);
    } catch (_) {
      setCommissionPlan(null);
    } finally {
      setCommissionLoading(false);
    }
  }, [user?.licensePlate]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const [time, log] = await Promise.all([
        getLastSyncTime(),
        getSyncLogRecent(10),
      ]);
      setLastSyncTime(time);
      setSyncLog(log || []);
    } catch (_) {}
  }, []);

  // Load on mount and every time screen gains focus (e.g. after login or tab switch)
  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      loadData();
      loadSyncStatus();
    });
    loadData();
    loadSyncStatus();
    return () => unsub?.();
  }, [loadData, loadSyncStatus, navigation]);

  // When sync completes (from SyncContext), refresh dashboard data and last synced time
  useEffect(() => {
    if (syncCompleteTimestamp > 0) {
      loadData();
      loadSyncStatus();
    }
  }, [syncCompleteTimestamp, loadData, loadSyncStatus]);

  useEffect(() => {
    if (user?.licensePlate) {
      loadCommissionData();
    }
  }, [user?.licensePlate, loadCommissionData]);

  // Short delayed reload on first mount so dashboard amounts update immediately after first-time login
  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
      loadSyncStatus();
    }, 200);
    return () => clearTimeout(t);
  }, [loadData, loadSyncStatus]);

  useEffect(() => {
    const intervalMs = 60 * 1000;
    const tid = setInterval(() => {
      loadSyncStatus();
      loadData();
    }, intervalMs);
    return () => clearInterval(tid);
  }, [loadData, loadSyncStatus]);

  useEffect(() => {
    const today = formatLocalDate(new Date());
    if (selectedChartDate === today) {
      setChartLineTotalsByOrder(lineTotalsByOrder);
      setChartPickingsBySaleId(pickingsBySaleId);
      setChartQtyDoneBySaleId(qtyDoneBySaleId);
      return;
    }
    const dateOrders = orders.filter((o) => getOrderDateForSyncMode(o).startsWith(selectedChartDate));
    const orderIds = dateOrders.map((o) => o.id);
    if (orderIds.length === 0) {
      setChartLineTotalsByOrder({});
      setChartPickingsBySaleId([]);
      setChartQtyDoneBySaleId({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [totals, pickings, qtyMap] = await Promise.all([
          getOrderLineTotalsFromDB(dateOrders),
          getPickingsBySaleIdsFromDB(orderIds),
          deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds),
        ]);
        if (!cancelled) {
          setChartLineTotalsByOrder(totals || {});
          setChartPickingsBySaleId(pickings || []);
          setChartQtyDoneBySaleId(qtyMap || {});
        }
      } catch (_) {
        if (!cancelled) {
          setChartLineTotalsByOrder({});
          setChartPickingsBySaleId([]);
          setChartQtyDoneBySaleId({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChartDate,
    orders,
    lineTotalsByOrder,
    pickingsBySaleId,
    qtyDoneBySaleId,
    formatLocalDate,
    getOrderDateForSyncMode,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    await loadSyncStatus();
    await loadCommissionData();
    setRefreshing(false);
  };

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setLastSyncResult(null);
    try {
      const result = await runSync();
      setLastSyncResult(result);
      await loadData();
      await loadSyncStatus();
    } catch (err) {
      setLastSyncResult({ error: err?.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const today = formatLocalDate(new Date());
  const todayOrders = orders.filter((o) => getOrderDateForSyncMode(o).startsWith(today));

  /** Sum line price_total per order so dashboard matches invoice after local line edits. */
  const lineTotalByOrderId = useMemo(() => {
    const m = {};
    for (const line of todayOrderLines || []) {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      if (oid == null) continue;
      if ((Number(line.product_uom_qty) || 0) <= 0) continue;
      const id = Number(oid);
      const pt = Number(line.price_total);
      if (!Number.isFinite(pt)) continue;
      m[id] = (m[id] || 0) + pt;
    }
    return m;
  }, [todayOrderLines]);

  const orderMoneyTotal = useCallback(
    (o) => {
      if (!o) return 0;
      const lt = lineTotalByOrderId[o.id];
      if (lt != null && lt > 0) return lt;
      return Number(o.amount_total) || 0;
    },
    [lineTotalByOrderId]
  );

  /** Distinct routes on today's non-cancelled orders (this vehicle's list). */
  const vehicleRouteIdsToday = useMemo(() => {
    const s = new Set();
    for (const o of todayOrders || []) {
      if (String(o?.state || '').toLowerCase() === 'cancel') continue;
      const rid = o?.route_id?.[0] ?? o?.route_id;
      if (rid == null) continue;
      const n = Number(rid);
      if (Number.isFinite(n)) s.add(n);
    }
    return s;
  }, [todayOrders]);

  const routesInVehicleTodayPicker = useMemo(() => {
    const fromCache = (routes || []).filter((r) => vehicleRouteIdsToday.has(Number(r.id)));
    const byId = new Map(fromCache.map((r) => [Number(r.id), r]));
    for (const id of vehicleRouteIdsToday) {
      if (!byId.has(id)) {
        const o = (todayOrders || []).find((x) => {
          if (String(x?.state || '').toLowerCase() === 'cancel') return false;
          const rid = x?.route_id?.[0] ?? x?.route_id;
          return Number(rid) === id;
        });
        const name = o?.route_id?.[1] || `Route ${id}`;
        byId.set(id, { id, name });
      }
    }
    return Array.from(byId.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [routes, todayOrders, vehicleRouteIdsToday]);

  const showRoutePicker = vehicleRouteIdsToday.size > 1;

  useEffect(() => {
    if (!showRoutePicker) setRoutePickerVisible(false);
  }, [showRoutePicker]);

  const defaultRouteId = useMemo(
    () => pickDefaultDashboardRouteId(routes, todayOrders),
    [routes, todayOrders]
  );
  const selectedRouteId = routeOverrideId ?? defaultRouteId;

  const todayOrdersForDashboard = useMemo(() => {
    if (selectedRouteId == null) return todayOrders;
    return todayOrders.filter((o) => {
      const rid = o.route_id?.[0] ?? o.route_id;
      return rid != null && Number(rid) === Number(selectedRouteId);
    });
  }, [todayOrders, selectedRouteId]);

  const pickingStateBySaleId = useMemo(
    () => mergePickingStateBySaleIdFromRows(pickingsBySaleId),
    [pickingsBySaleId]
  );

  /**
   * Delivery progress: count as delivered when any qty was recorded on move lines, picking is done/cancel, or order is invoiced.
   * Does not require full Odoo invoice — matches “any delivery on this order” for progress bars and totals.
   */
  const deliveredTodayOrders = useMemo(
    () =>
      todayOrdersForDashboard.filter((o) =>
        orderIsDeliveryDoneForProgress(
          o,
          pickingStateBySaleId,
          qtyDoneBySaleId,
          backendQtyDeliveredOrderIds,
          pendingCheckoutOrderIds
        )
      ),
    [
      todayOrdersForDashboard,
      pickingStateBySaleId,
      qtyDoneBySaleId,
      backendQtyDeliveredOrderIds,
      pendingCheckoutOrderIds,
    ]
  );

  const todayOrderLinesForDashboard = useMemo(() => {
    const ids = new Set(todayOrdersForDashboard.map((o) => Number(o.id)));
    return (todayOrderLines || []).filter((line) => {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      return ids.has(Number(oid));
    });
  }, [todayOrderLines, todayOrdersForDashboard]);

  const deliveredQtyByProductId = useMemo(() => {
    const deliveredOrderIds = new Set(deliveredTodayOrders.map((o) => Number(o.id)));
    const map = {};
    (todayOrderLinesForDashboard || []).forEach((line) => {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      if (soId == null || !deliveredOrderIds.has(soId)) return;

      const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const pid = pidRaw != null ? Number(pidRaw) : null;
      if (pid == null || !Number.isFinite(pid)) return;

      const qty = Number(line.product_uom_qty) || 0;
      map[pid] = (map[pid] || 0) + qty;
    });
    return map;
  }, [deliveredTodayOrders, todayOrderLinesForDashboard]);

  // const deliveredTodayOrders = todayOrders;

  // Helper: lookup split by order id (keys may be number or string from DB)
  const getSplitForOrder = (order) => {
    const id = order?.id;
    if (id == null) return undefined;
    return paymentSplitsByOrderId[Number(id)] ?? paymentSplitsByOrderId[id] ?? paymentSplitsByOrderId[String(id)];
  };
  // Collection totals: local split first; else synced amounts (amount_cash/amount_cheque/amount_credit); else payment_type + amount_total
  const cashTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (Number(split.cash) > 0 || Number(split.cheque ?? split.check) > 0 || Number(split.credit) > 0)) {
      return s + (Number(split.cash) || 0);
    }
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sc;
    const pt = normalizePaymentType(o.payment_type);
    return s + (pt === 'cash' ? orderMoneyTotal(o) : 0);
  }, 0);
  const chequeTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (Number(split.cash) > 0 || Number(split.cheque ?? split.check) > 0 || Number(split.credit) > 0)) {
      return s + (Number(split.cheque ?? split.check) || 0);
    }
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sq;
    const pt = normalizePaymentType(o.payment_type);
    return s + (pt === 'cheque' ? orderMoneyTotal(o) : 0);
  }, 0);
  const creditTotal = deliveredTodayOrders.reduce((s, o) => {
    const split = getSplitForOrder(o);
    if (split && (Number(split.cash) > 0 || Number(split.cheque ?? split.check) > 0 || Number(split.credit) > 0)) {
      return s + (Number(split.credit) || 0);
    }
    const sc = Number(o.amount_cash) || 0;
    const sq = Number(o.amount_cheque) || 0;
    const sr = Number(o.amount_credit) || 0;
    if (sc > 0 || sq > 0 || sr > 0) return s + sr;
    const pt = normalizePaymentType(o.payment_type);
    // Do not treat unknown/empty payment_type as full credit (fresh device after sync was inflating credit).
    return s + (pt === 'credit' ? orderMoneyTotal(o) : 0);
  }, 0);
  const collectionTotal = cashTotal + chequeTotal + creditTotal || 1;
  const cashTotalDisplay = cashTotal;
  const chequeTotalDisplay = chequeTotal;
  const creditTotalDisplay = creditTotal;
  const collectionTotalDisplay = cashTotalDisplay + chequeTotalDisplay + creditTotalDisplay || 1;
  const cashPctDisplay = safePercentDisplay(cashTotalDisplay, collectionTotalDisplay);
  const chequePctDisplay = safePercentDisplay(chequeTotalDisplay, collectionTotalDisplay);
  const creditPctDisplay = safePercentDisplay(creditTotalDisplay, collectionTotalDisplay);

  const routeName =
    routes.find((r) => Number(r.id) === Number(selectedRouteId))?.name ||
    todayOrdersForDashboard[0]?.route_id?.[1] ||
    routes[0]?.name ||
    '—';
  const vehicleName = user?.licensePlate || user?.vehicleName || 'Vehicle';
  const driverName = user?.driverName;
  const driverPhone = user?.driverPhone != null && String(user.driverPhone).trim() !== '' ? String(user.driverPhone).trim() : '';
  const driverHeaderUri = user?.driverImageBase64 ? odooImageToUri(user.driverImageBase64) : null;
  const crewPorters = Array.isArray(user?.selectedPorters) ? user.selectedPorters : [];


  // Use commission rate from API, default to Rs. 1 per item if not available
  const commissionPercentage = commissionPlan?.commission_percentage || 1;
  const productRateMap = commissionPlan?.productRateMap || {};

  // Calculate totals for fallback commission calculation
  const allOrdersTotal = todayOrdersForDashboard.reduce((s, o) => s + orderMoneyTotal(o), 0);
  const deliveredOrdersTotal = deliveredTodayOrders.reduce((s, o) => s + orderMoneyTotal(o), 0);

  // Get order lines for delivered orders (for achieved commission)
  const deliveredOrderIds = new Set(deliveredTodayOrders.map((o) => o.id));
  const deliveredOrderLines = todayOrderLinesForDashboard.filter((line) => {
    const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
    return deliveredOrderIds.has(orderId);
  });


  const hasProductRates = Object.keys(productRateMap).length > 0;
  const defaultRate = hasProductRates ? commissionPercentage : 1;


  const commissionProgress = calculateCommissionProgressByProducts(
    todayOrderLinesForDashboard,
    deliveredOrderLines,
    productRateMap,
    defaultRate
  );

  const commissionTarget = commissionProgress.target;
  const commissionEarned = commissionProgress.achieved;
  const commissionPct = commissionProgress.percentage;

  const shopsCompleted = deliveredTodayOrders.length;
  const totalShopsToday = todayOrdersForDashboard.length;
  const shopsPct = totalShopsToday > 0 ? Math.min(100, Math.round((shopsCompleted / totalShopsToday) * 100)) : 0;
  const totalGasDelivered = deliveredTodayOrders.reduce(
      (s, o) => s + (Number(lineTotalsByOrder[o.id]) || 0),
      0
  );
  const totalGasInOrders = todayOrdersForDashboard.reduce(
      (s, o) => s + (Number(lineTotalsByOrder[o.id]) || 0),
      0
  );
  const gasPct = totalGasInOrders > 0 ? Math.min(100, Math.round((totalGasDelivered / totalGasInOrders) * 100)) : 0;

  const chartDateOrders = useMemo(
      () => orders.filter((o) => getOrderDateForSyncMode(o).startsWith(selectedChartDate)),
      [orders, selectedChartDate, getOrderDateForSyncMode]
  );
  const chartPickingStateBySaleId = useMemo(
    () => mergePickingStateBySaleIdFromRows(chartPickingsBySaleId),
    [chartPickingsBySaleId]
  );
  const chartDeliveryByShop = useMemo(() => {
    const byPartner = {};
    chartDateOrders.forEach((o) => {
      const partnerId = o.partner_id?.[0] ?? o.partner_id;
      const partnerName = getLocalizedCustomerNameFromOrder(o, appLanguage) || `Shop ${partnerId}`;
      const key = partnerId ?? 'unknown';
      if (!byPartner[key]) byPartner[key] = { shopId: `S${partnerId}`, shopName: partnerName, delivered: 0, pending: 0 };
      const qty = Math.round(Number(chartLineTotalsByOrder[o.id]) || 0);
      const isDone = orderIsDeliveryDoneForProgress(
        o,
        chartPickingStateBySaleId,
        chartQtyDoneBySaleId,
        backendQtyDeliveredOrderIds,
        pendingCheckoutOrderIds
      );
      if (isDone) byPartner[key].delivered += qty;
      else byPartner[key].pending += qty;
    });
    const real = Object.values(byPartner).filter((r) => r.delivered > 0 || r.pending > 0);
    return real;
  }, [
    chartDateOrders,
    chartLineTotalsByOrder,
    chartPickingStateBySaleId,
    chartQtyDoneBySaleId,
    backendQtyDeliveredOrderIds,
    pendingCheckoutOrderIds,
    appLanguage,
  ]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { paddingBottom: 80 },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        topBar: {
          backgroundColor: colors.primary ?? '#6366f1',
          paddingTop: spacing.lg,
          paddingHorizontal: spacing.md,
          paddingBottom: 14,
        },
        topBarRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        topBarRowWithMargin: { marginBottom: 4 },
        topBarLeft: {
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 4,
          flex: 1,
        },
        vehicleName: { fontSize: 16, fontWeight: '700', color: '#fff' },
        dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        dateText: { fontSize: 14, color: 'rgba(255,255,255,0.95)' },
        routePill: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 20,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.4)',
          gap: 6,
        },
        routePillText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.95)' },
        driverHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 4,
        },
        driverHeaderAvatar: {
          width: 46,
          height: 46,
          borderRadius: 23,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.45)',
          backgroundColor: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        },
        driverHeaderAvatarPh: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        crewSectionWrap: {
          marginTop: spacing.md,
          marginHorizontal: spacing.md,
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        crewSectionLabel: {
          fontSize: 15,
          fontWeight: '800',
          color: colors.text,
          letterSpacing: 0.2,
          marginBottom: 10,
        },
        crewRowScroll: { flexGrow: 0, paddingVertical: 4 },
        crewChipSurface: { alignItems: 'center', width: 76, marginRight: 10 },
        crewAvatarSurface: {
          width: 52,
          height: 52,
          borderRadius: 26,
          borderWidth: 2,
          borderColor: colors.primary + '44',
          overflow: 'hidden',
          backgroundColor: colors.background,
        },
        crewNameSurface: {
          fontSize: 11,
          fontWeight: '700',
          color: colors.text,
          marginTop: 6,
          textAlign: 'center',
          maxWidth: 76,
          lineHeight: 14,
        },
        headerButtons: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
        },
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.md,
        },
        greeting: { fontSize: 22, fontWeight: '800', color: colors.text },
        hint: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
        lastSyncedBlock: { alignItems: 'flex-end' },
        syncingUnderSync: {
          alignSelf: 'flex-end',
          marginTop: 4,
          minHeight: 32,
          justifyContent: 'center',
        },
        lastSyncedLabel: {
          fontSize: 10,
          fontWeight: '600',
          color: 'rgba(255,255,255,0.75)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        lastSyncTimeText: {
          fontSize: 12,
          fontWeight: '600',
          color: 'rgba(255,255,255,0.95)',
          marginTop: 2,
        },
        syncCountersRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 6,
        },
        syncCounterCol: { alignItems: 'center', justifyContent: 'center', minWidth: 32 },
        syncCounterPill: {
          minWidth: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          paddingHorizontal: 8,
        },
        syncCounterText: {
          fontSize: 12,
          fontWeight: '800',
          color: '#fff',
        },
        dailyVisitBtnTop: {
          backgroundColor: 'transparent',
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.9)',
        },
        dailyVisitBtnTopText: { fontSize: 14, fontWeight: '700', color: '#fff' },
        sectionTitle: {
          fontSize: 17,
          fontWeight: '700',
          color: colors.text,
          marginBottom: spacing.sm,
        },
        commissionCard: {
          backgroundColor: colors.primary ?? '#4f46e5',
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginTop: spacing.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.22)',
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 6,
        },
        commissionTitle: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.92)', letterSpacing: 0.5 },
        commissionAmount: { fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 6 },
        commissionPct: { fontSize: 14, color: 'rgba(255,255,255,0.92)', marginTop: 6 },
        collectionSectionLabel: {
          fontSize: 12,
          fontWeight: '700',
          color: colors.textSecondary,
          letterSpacing: 0.5,
          paddingHorizontal: spacing.md,
          marginBottom: 4,
          marginTop: 2,
        },
        collectionRow: {
          flexDirection: 'row',
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.sm,
        },
        collectionCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.sm,
          borderWidth: 1.5,
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        collectionCardExpanded: {
          flex: 2.5,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        },
        collectionCardSqueezed: {
          flex: 0.5,
          paddingVertical: spacing.xs,
          paddingHorizontal: 4,
        },
        collectionIcon: { width: 20, height: 20 },
        collectionAmount: { fontSize: 12, fontWeight: '800', marginTop: 2 },
        collectionAmountExpanded: { fontSize: 12, fontWeight: '800', marginTop: 2 },
        collectionLabel: { fontSize: 9, fontWeight: '700', color: colors.text, marginTop: 2 },
        collectionLabelExpanded: { fontSize: 9, marginTop: 2 },
        collectionPct: { fontSize: 9, fontWeight: '600', marginTop: 1 },
        collectionPctExpanded: { fontSize: 9, marginTop: 1 },
        shopsGasRow: {
          flexDirection: 'row',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.md,
        },
        shopsGasCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          alignItems: 'center',
          justifyContent: 'center',
        },
        shopsGasValue: { fontSize: 28, fontWeight: '800', color: colors.text },
        shopsGasTarget: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
        shopsGasLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 4, letterSpacing: 0.3 },
        shopsGasPct: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
        metricsRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginBottom: spacing.md,
        },
        metricCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          alignItems: 'center',
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        metricValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 4 },
        metricLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
        totalsCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        totalSalesRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        cashCreditRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          paddingTop: 10,
          alignItems: 'center',
        },
        halfBox: {
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: 32,
        },
        totalsLabel: { fontSize: 13, color: colors.textSecondary },
        totalsValue: { fontSize: 16, fontWeight: '800', color: colors.text },
        chartCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          overflow: 'hidden',
        },
        chartTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
        actionsRow: { flexDirection: 'row', gap: spacing.md },
        actionCard: {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          alignItems: 'center',
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        actionIconWrap: {
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 8,
        },
        actionLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
        syncStatusCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          padding: spacing.sm,
          marginBottom: spacing.md,
          borderLeftWidth: 4,
          borderLeftColor: colors.primary,
        },
        syncStatusText: { fontSize: 12, color: colors.textSecondary },
        syncStatusTime: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 2 },
        syncError: { fontSize: 12, color: colors.error || '#c00', marginTop: 4 },
        syncCounts: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
        syncLogTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 },
        syncLogItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 8,
        },
        syncLogStatus: { width: 8, height: 8, borderRadius: 4 },
        syncLogText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
        modalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: spacing.lg,
        },
        modalCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          maxHeight: '85%',
        },
        modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
        modalSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
        routePickRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 14,
          paddingHorizontal: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        routePickRowActive: { backgroundColor: colors.primary + '12' },
        routePickName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
        profileHero: { alignItems: 'center', marginBottom: spacing.md },
        profileAvatarLg: {
          width: 96,
          height: 96,
          borderRadius: 48,
          borderWidth: 3,
          borderColor: colors.primary + '55',
          overflow: 'hidden',
          backgroundColor: colors.background,
        },
        profileNameLg: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: spacing.md, textAlign: 'center' },
        profileRole: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 4 },
        profilePhoneRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: spacing.md,
          padding: spacing.md,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        profilePhoneText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
        profileNoPhone: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic', marginTop: spacing.sm },
        modalCloseBtn: {
          marginTop: spacing.lg,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          backgroundColor: colors.primary,
          alignItems: 'center',
        },
        modalCloseBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
      }),
    [colors]
  );

  if (loading) {
    return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
  }

  const todayDateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const openDial = (raw) => {
    const s = String(raw || '').replace(/[^\d+]/g, '');
    if (!s) return;
    Linking.openURL(`tel:${s}`).catch(() => {});
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      {/* 1. Top bar: date + route left; sync indicator (when syncing) + Last Synced right */}
      <View style={[styles.topBar, { paddingTop: spacing.lg + insets.top }]}>
        <View style={[styles.topBarRow, styles.topBarRowWithMargin]}>
          <View style={styles.topBarLeft}>
            <TouchableOpacity
              style={styles.driverHeaderRow}
              activeOpacity={0.85}
              onPress={() =>
                setProfileModal({
                  kind: 'driver',
                  name: driverName || vehicleName,
                  subtitle: driverName ? vehicleName : 'Driver',
                  phone: driverPhone,
                  imageBase64: user?.driverImageBase64,
                })
              }
            >
              {driverHeaderUri ? (
                <Image source={{ uri: driverHeaderUri }} style={styles.driverHeaderAvatar} resizeMode="cover" />
              ) : (
                <View style={[styles.driverHeaderAvatar, styles.driverHeaderAvatarPh]}>
                  <Ionicons name="person" size={24} color="rgba(255,255,255,0.95)" />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.vehicleName} numberOfLines={1}>
                  {driverName || vehicleName}
                </Text>
                {driverName ? (
                  <Text
                    style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.88)', marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {vehicleName}
                  </Text>
                ) : null}
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>Tap for profile</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.95)" />
              <Text style={styles.dateText}>{todayDateStr}</Text>
            </View>
            {showRoutePicker ? (
              <TouchableOpacity
                style={styles.routePill}
                onPress={() => setRoutePickerVisible(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Choose route for today"
              >
                <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.95)" />
                <Text style={styles.routePillText} numberOfLines={1}>
                  Route: {routeName}
                </Text>
                <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.95)" />
              </TouchableOpacity>
            ) : (
              <View
                style={styles.routePill}
                accessibilityRole="text"
                accessibilityLabel={`Route ${routeName}`}
              >
                <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.95)" />
                <Text style={styles.routePillText} numberOfLines={1}>
                  Route: {routeName}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.headerButtons}>
              <View style={styles.lastSyncedBlock}>
                <Text style={styles.lastSyncedLabel}>Last Synced</Text>
                <Text style={styles.lastSyncTimeText} numberOfLines={1}>
                  {lastSyncTime
                    ? new Date(lastSyncTime).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                    : '—'}
                </Text>
                <View style={styles.syncCountersRow}>
                  <View
                    style={styles.syncCounterCol}
                    accessibilityLabel={`Orders pending sync: ${orderSyncStats.pendingOrders}`}
                  >
                    <View
                      style={[
                        styles.syncCounterPill,
                        {
                          backgroundColor: 'rgba(71, 85, 105, 0.65)',
                          borderColor: 'rgba(148, 163, 184, 0.85)',
                        },
                      ]}
                    >
                      <Text style={styles.syncCounterText}>{orderSyncStats.pendingOrders}</Text>
                    </View>
                  </View>
                  <View
                    style={styles.syncCounterCol}
                    accessibilityLabel={`Payment pending upload: ${orderSyncStats.localCompleted}`}
                  >
                    <View
                      style={[
                        styles.syncCounterPill,
                        {
                          backgroundColor: `${colors.warning ?? '#d97706'}CC`,
                          borderColor: `${colors.warning ?? '#d97706'}F0`,
                        },
                      ]}
                    >
                      <Text style={styles.syncCounterText}>{orderSyncStats.localCompleted}</Text>
                    </View>
                  </View>
                  <View
                    style={styles.syncCounterCol}
                    accessibilityLabel={`Synced completed orders: ${orderSyncStats.syncedCompleted}`}
                  >
                    <View
                      style={[
                        styles.syncCounterPill,
                        {
                          backgroundColor: `${colors.success ?? '#22c55e'}CC`,
                          borderColor: `${colors.success ?? '#22c55e'}F0`,
                        },
                      ]}
                    >
                      <Text style={styles.syncCounterText}>{orderSyncStats.syncedCompleted}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.syncingUnderSync}>
                  <SyncHeaderBadge variant="dashboard" />
                </View>
              </View>
            {/* //Daily Visit Keep Commented for now */}
            {/* <TouchableOpacity
              style={styles.dailyVisitBtnTop}
              onPress={() => navigation.navigate('Orders', { customerId: null })}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={20} color="#fff" />
              <Text style={styles.dailyVisitBtnTopText}>Visit</Text>
            </TouchableOpacity> */}
            </View>
          </View>
        </View>

        {/* 2. Stock overview (lorry stock) */}
        <View style={{ paddingHorizontal: spacing.md, marginTop: -10, marginBottom: spacing.sm }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('MyStocks')}
            activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}
          >
            <Text style={styles.sectionTitle}></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {/* <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>Open My Stocks</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} /> */}
            </View>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {stockCards.length > 0 ? (
              stockCards.map((s) => {
                const onHandStock = Number(s.total) || 0;
                const LOW_STOCK_THRESHOLD = 2;
                const isOut = onHandStock <= 0;
                const gasBlueColor = getGasTypeBlueColor(String(s.product_name || ''));
                const statusColor = isOut ? '#dc2626' : gasBlueColor;
                const productLabel = String(s.product_name || '').replace(/^\[[^\]]+\]\s*/, '');
                const backendImageUri = s.product_id != null ? productIdToImageUri[s.product_id] : null;
                const gasImageSource = backendImageUri ? { uri: backendImageUri } : getGasImageByProductName(productLabel);
                const deliveredQty =
                  s.product_id != null ? Number(deliveredQtyByProductId[s.product_id]) || 0 : 0;

                return (
                  <TouchableOpacity
                    key={String(s.display_key ?? s.product_id ?? s._defaultGasKg)}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('MyStocks')}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: borderRadius.lg,
                      padding: spacing.md,
                      borderWidth: isOut ? 2 : 2.5,
                      borderColor: statusColor,
                      marginRight: spacing.sm,
                      minWidth: 160,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {gasImageSource ? (
                        <Image
                          source={gasImageSource}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                        />
                      ) : (
                        <View
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: statusColor,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.background,
                          }}
                        >
                          <Ionicons name="flame-outline" size={16} color={statusColor} />
                        </View>
                      )}
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, flex: 1 }} numberOfLines={2}>
                        {productLabel}
                      </Text>
                    </View>
                    <View style={{ height: 6 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '800' }}>
                      On Hand Stock
                    </Text>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: isOut ? '#dc2626' : '#3b82f6', marginTop: 4 }}>
                      {(Number(s.total) || 0).toLocaleString('en-IN')}
                    </Text>
                    <View style={{ height: 6 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '800' }}>
                      Delivered
                    </Text>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: deliveredQty > 0 ? '#16a34a' : colors.textSecondary, marginTop: 4 }}>
                      {deliveredQty.toLocaleString('en-IN')}
                    </Text>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={{ paddingVertical: spacing.md }}>
                <Text style={{ color: colors.textSecondary }}>No stock data available.</Text>
              </View>
            )}
          </ScrollView>
        </View>

        {/* 3. Collection today - Cash, Cheque, Credit (tap to expand / tap again to collapse) */}
        <Text style={styles.collectionSectionLabel}>Sales Today</Text>
        <View style={styles.collectionRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.cash ?? '#059669' },
              expandedCollectionCard === 'cash' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'cash' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('cash')}
          >
            <Ionicons name="cash-outline" size={20} color={colors.cash ?? '#059669'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'cash') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'cash' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.cash ?? '#059669' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'cash' ? 2 : 1}
                >
                  {expandedCollectionCard === 'cash' ? formatCurrency(cashTotalDisplay) : formatShort(cashTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cash' && styles.collectionLabelExpanded]}>CASH</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'cash' && styles.collectionPctExpanded, { color: colors.cash ?? '#059669' }]}>
                  ( {cashPctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.cheque ?? '#d97706' },
              expandedCollectionCard === 'cheque' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'cheque' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('cheque')}
          >
            <Ionicons name="card-outline" size={20} color={colors.cheque ?? '#d97706'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'cheque') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'cheque' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.cheque ?? '#d97706' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'cheque' ? 2 : 1}
                >
                  {expandedCollectionCard === 'cheque' ? formatCurrency(chequeTotalDisplay) : formatShort(chequeTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cheque' && styles.collectionLabelExpanded]}>CHEQUE</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'cheque' && styles.collectionPctExpanded, { color: colors.cheque ?? '#d97706' }]}>
                  ( {chequePctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.collectionCard,
              { borderColor: colors.credit ?? '#6366f1' },
              expandedCollectionCard === 'credit' && styles.collectionCardExpanded,
              expandedCollectionCard != null && expandedCollectionCard !== 'credit' && styles.collectionCardSqueezed,
            ]}
            onPress={() => toggleCollectionCard('credit')}
          >
            <Ionicons name="wallet-outline" size={20} color={colors.credit ?? '#6366f1'} />
            {(expandedCollectionCard == null || expandedCollectionCard === 'credit') && (
              <>
                <Text
                  style={[
                    expandedCollectionCard === 'credit' ? styles.collectionAmountExpanded : styles.collectionAmount,
                    { color: colors.credit ?? '#6366f1' },
                  ]}
                  numberOfLines={expandedCollectionCard === 'credit' ? 2 : 1}
                >
                  {expandedCollectionCard === 'credit' ? formatCurrency(creditTotalDisplay) : formatShort(creditTotalDisplay)}
                </Text>
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'credit' && styles.collectionLabelExpanded]}>CREDIT</Text>
                <Text style={[styles.collectionPct, expandedCollectionCard === 'credit' && styles.collectionPctExpanded, { color: colors.credit ?? '#6366f1' }]}>
                  ( {creditPctDisplay}%)
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

      

        {/* 4. Shops Completed (delivered/total) & Gas Delivered (delivered/total) - tap to open Orders / Delivered tab */}
        <View style={styles.shopsGasRow}>
          <TouchableOpacity
            style={styles.shopsGasCard}
            onPress={() => navigation.navigate('Orders')}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.shopsGasValue, { color: colors.primary }]}>{shopsCompleted}</Text>
              <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{totalShopsToday}</Text>
            </View>
            <Text style={styles.shopsGasLabel}>ORDERS COMPLETED</Text>
            <Text style={styles.shopsGasPct}>{shopsPct}% Complete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shopsGasCard}
            onPress={() => navigation.navigate('DeliveredOrders')}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[styles.shopsGasValue, { color: colors.warning ?? '#d97706' }]}>
                {totalGasDelivered.toLocaleString('en-IN')}
              </Text>
              <Text style={[styles.shopsGasTarget, { color: colors.textSecondary }]}>/{totalGasInOrders.toLocaleString('en-IN')}</Text>
            </View>
            <Text style={styles.shopsGasLabel}>GAS DELIVERED</Text>
            <Text style={styles.shopsGasPct}>{gasPct}% Complete</Text>
          </TouchableOpacity>
        </View>

      {/* 5. Delivery Progress by Shop - bar chart with date picker (default today) */}
      <View style={{ paddingHorizontal: spacing.md }}>
        <DeliveryProgressBarChart
          data={chartDeliveryByShop}
          title="Delivery Progress"
          rightElement={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <TouchableOpacity
                onPress={() => {
                  const d = new Date(selectedChartDate + 'T12:00:00');
                  d.setDate(d.getDate() - 1);
                  setSelectedChartDate(formatLocalDate(d));
                }}
                style={{ padding: 6 }}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: colors.textSecondary, minWidth: 72, textAlign: 'center' }}>
                {selectedChartDate === formatLocalDate(new Date())
                  ? 'Today'
                  : new Date(selectedChartDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  const d = new Date(selectedChartDate + 'T12:00:00');
                  d.setDate(d.getDate() + 1);
                  setSelectedChartDate(formatLocalDate(d));
                }}
                style={{ padding: 6 }}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-forward" size={22} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowChartDatePicker(true)}
                style={{ padding: 6, marginLeft: 2 }}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
              {showChartDatePicker && (
                <DateTimePicker
                  value={new Date(selectedChartDate + 'T12:00:00')}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, date) => {
                    if (Platform.OS === 'android') setShowChartDatePicker(false);
                    if (date) setSelectedChartDate(formatLocalDate(date));
                  }}
                />
              )}
              {showChartDatePicker && Platform.OS === 'ios' && (
                <TouchableOpacity
                  onPress={() => setShowChartDatePicker(false)}
                  style={{ paddingVertical: 4, paddingHorizontal: 8 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.primary }}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>
      {crewPorters.length > 0 && (
          <View style={styles.crewSectionWrap}>
            <Text style={styles.crewSectionLabel}>Porters on shift</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.crewRowScroll}
              contentContainerStyle={{ flexDirection: 'row', alignItems: 'flex-start', paddingRight: 12 }}
            >
              {crewPorters.map((p) => {
                const uri = p?.imageBase64 ? odooImageToUri(p.imageBase64) : null;
                const porterPhone = p?.phone != null && String(p.phone).trim() !== '' ? String(p.phone).trim() : '';
                return (
                  <TouchableOpacity
                    key={String(p.id)}
                    style={styles.crewChipSurface}
                    activeOpacity={0.85}
                    onPress={() =>
                      setProfileModal({
                        kind: 'porter',
                        name: p.name || 'Porter',
                        subtitle: 'Porter on shift',
                        phone: porterPhone,
                        imageBase64: p.imageBase64,
                      })
                    }
                  >
                    <View style={styles.crewAvatarSurface}>
                      {uri ? (
                        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="people-outline" size={22} color={colors.textSecondary} />
                        </View>
                      )}
                    </View>
                    <Text style={styles.crewNameSurface} numberOfLines={2}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      {/* Commission section (separate card below Delivery Progress) */}
      {/* <View style={{ paddingHorizontal: spacing.md }}>
        <TouchableOpacity
          style={styles.commissionCard}
          activeOpacity={0.86}
          onPress={() => navigation.navigate('MyCommissions')}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.commissionTitle}>YOUR COMMISSION TODAY</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </View>
          <Text style={styles.commissionAmount}>
            {formatCurrency(commissionEarned)} / {Number(commissionTarget).toFixed(2)}
          </Text>
          <Text style={styles.commissionPct}>
            {commissionPct}% of target achieved
            {commissionLoading && ' (loading...)'}
          </Text>
        </TouchableOpacity>
      </View> */}

        {/* 6. Configurable: Create Sales Order & Return */}
        {(showCreateSalesOrder || showReturnOrder) && (
            <View style={[styles.actionsRow, { paddingHorizontal: spacing.md, marginBottom: spacing.lg }]}>
              {showCreateSalesOrder && (
                  <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => navigation.navigate('Orders', { customerId: null })}
                      activeOpacity={0.8}
                  >
                    <View style={styles.actionIconWrap}>
                      <Ionicons name="add" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.actionLabel}>Create Sales Order</Text>
                  </TouchableOpacity>
              )}
              {showReturnOrder && (
                  <TouchableOpacity
                      style={styles.actionCard}
                      onPress={() => navigation.navigate('Orders')}
                      activeOpacity={0.8}
                  >
                    <View style={styles.actionIconWrap}>
                      <Ionicons name="return-down-back-outline" size={28} color={colors.primary} />
                    </View>
                    <Text style={styles.actionLabel}>Return Order</Text>
                  </TouchableOpacity>
              )}
            </View>
        )}
      </ScrollView>

      <Modal visible={routePickerVisible} transparent animationType="fade" onRequestClose={() => setRoutePickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRoutePickerVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Choose route</Text>
            <Text style={styles.modalSubtitle}>
              Pick a route to filter your list, or Recommended for today's usual route.
            </Text>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[styles.routePickRow, routeOverrideId === null && styles.routePickRowActive]}
                onPress={() => {
                  setRouteOverrideId(null);
                  setRoutePickerVisible(false);
                }}
              >
                <Text style={styles.routePickName}>Recommended (today)</Text>
                {routeOverrideId === null ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
              </TouchableOpacity>
              {routesInVehicleTodayPicker.map((r) => {
                const id = Number(r.id);
                const active = routeOverrideId != null && Number(routeOverrideId) === id;
                return (
                  <TouchableOpacity
                    key={String(r.id)}
                    style={[styles.routePickRow, active && styles.routePickRowActive]}
                    onPress={() => {
                      setRouteOverrideId(id);
                      setRoutePickerVisible(false);
                    }}
                  >
                    <Text style={styles.routePickName}>{r.name || `Route ${r.id}`}</Text>
                    {active ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setRoutePickerVisible(false)} activeOpacity={0.88}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={profileModal != null} transparent animationType="fade" onRequestClose={() => setProfileModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setProfileModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {profileModal ? (
              <>
                <View style={styles.profileHero}>
                  <View style={styles.profileAvatarLg}>
                    {(() => {
                      const uri = profileModal.imageBase64 ? odooImageToUri(profileModal.imageBase64) : null;
                      return uri ? (
                      <Image
                        source={{ uri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="person" size={44} color={colors.textSecondary} />
                      </View>
                    );
                    })()}
                  </View>
                  <Text style={styles.profileNameLg}>{profileModal.name}</Text>
                  <Text style={styles.profileRole}>{profileModal.subtitle}</Text>
                  {profileModal.phone ? (
                    <TouchableOpacity style={styles.profilePhoneRow} onPress={() => openDial(profileModal.phone)} activeOpacity={0.85}>
                      <Ionicons name="call-outline" size={22} color={colors.primary} />
                      <Text style={styles.profilePhoneText}>{profileModal.phone}</Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.profileNoPhone}>No phone number on file</Text>
                  )}
                </View>
                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setProfileModal(null)} activeOpacity={0.88}>
                  <Text style={styles.modalCloseBtnText}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

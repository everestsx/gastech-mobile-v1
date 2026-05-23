import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
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
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { dashboardConfig } from '../constants/dashboardConfig';
import { getGasTypeBlueColor, parseKgFromProductName } from '../utils/productDisplay';
import { buildDefaultGasDashboardStockCards } from '../utils/defaultGasStock';
import { canonicalKgFromName, isEmptyCylinderName, isGasCylinderName } from '../utils/cylinderCatalog';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import {
  getCachedOrders,
  getCachedRoutes,
  getLastSyncTime,
  getSyncLogRecent,
  hasPendingUploadWork,
  hasActiveUploadWork,
  hasActionablePendingUploadWork,
  ensurePendingUploadRetryLoop,
  stopPendingUploadRetryLoop,
  schedulePendingUploadSync,
  getUserSession,
  getOrderLineTotalsFromDB,
  getPickingsBySaleIdsFromDB,
  getOrderLinesByOrderIdsFromDB,
  consumePostLoginSyncSuccessPending,
  saveUserSession,
  isDashboardInitialLoadMemoryDone,
  hydrateDashboardInitialLoadFromStorage,
  markDashboardInitialLoadComplete,
  setDashboardUploadIndicators,
} from '../services/sync.service';
import * as localPaymentsDb from '../database/localPayments.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import {
  getActiveCommissionPlan,
  calculateCommissionProgressByProducts,
} from '../services/commission.service';
import {
  getMonthDateRange,
  getTodayDateRange,
  getYesterdayDateRange,
  formatDateRangeLabel,
  getDeliverySummaryByEmployeeByDate,
  getCommissionByEmployeeByDate,
  mergeCommissionRowsByEmployee,
} from '../services/commisrioNew.service';
import * as productsDb from '../database/products.js';
import * as deliveryQtyDb from '../database/deliveryQty.js';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import DeliveryProgressBarChart from '../components/DeliveryProgressBarChart';
import RichNotification from '../components/RichNotification';
import PendingBackOfficeReminderModal from '../components/PendingBackOfficeReminderModal';
import NetworkStatusPill from '../components/NetworkStatusPill';
import { useSync } from '../context/SyncContext';

const ORANGE_UPLOAD_SINCE_KEY = '@gastech_orange_upload_pending_since';
const ORANGE_UPLOAD_REMINDER_MS = 10 * 60 * 1000;
import { odooImageToUri, getDrivingEmployees, getPortersEmployees } from '../services/employee.service';
import {
  mergePickingStateBySaleIdFromRows,
  orderIsDeliveryDoneForProgress,
  orderCountsAsDeliveredForDashboard,
  effectiveDeliveredQtyForLine,
} from '../utils/deliveryProgress.js';
import {
  getCheckoutResumeMap,
  pendingCheckoutSaleOrderIdsFromResumeMap,
  pruneStaleCheckoutResumeEntries,
} from '../services/checkoutResume.service';

let lastDashboardSnapshot = null;

function hasValidEmployeeImage(imageBase64) {
  if (imageBase64 == null) return false;
  const s = String(imageBase64).trim();
  return !!s && s.toLowerCase() !== 'false' && s.toLowerCase() !== 'null';
}

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { syncCompleteTimestamp, isSyncing, syncResult, syncErrorMessage } = useSync();
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
  const [orders, setOrders] = useState(() => lastDashboardSnapshot?.orders ?? []);
  const [user, setUser] = useState(() => lastDashboardSnapshot?.user ?? null);
  const [routes, setRoutes] = useState(() => lastDashboardSnapshot?.routes ?? []);
  const [lineTotalsByOrder, setLineTotalsByOrder] = useState(() => lastDashboardSnapshot?.lineTotalsByOrder ?? {});
  const [pickingsBySaleId, setPickingsBySaleId] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncLog, setSyncLog] = useState([]);
  const [selectedChartDate, setSelectedChartDate] = useState(() => formatLocalYyyyMmDd(new Date()));
  const [showChartDatePicker, setShowChartDatePicker] = useState(false);
  const [chartLineTotalsByOrder, setChartLineTotalsByOrder] = useState({});
  const [chartOrderLines, setChartOrderLines] = useState([]);
  const [chartPickingsBySaleId, setChartPickingsBySaleId] = useState([]);
  /** Sum of stock.move.line qty_done per sale order (partial delivery counts). */
  const [qtyDoneBySaleId, setQtyDoneBySaleId] = useState({});
  const [chartQtyDoneBySaleId, setChartQtyDoneBySaleId] = useState({});
  /** Sale orders with Odoo qty_delivered > 0 on any line (after sync). */
  const [backendQtyDeliveredOrderIds, setBackendQtyDeliveredOrderIds] = useState(() => new Set());
  const [localInvoicedSaleOrderIds, setLocalInvoicedSaleOrderIds] = useState(() => new Set());
  const [pendingCheckoutOrderIds, setPendingCheckoutOrderIds] = useState(() => new Set());
  const [paymentSplitsByOrderId, setPaymentSplitsByOrderId] = useState({});
  // Commission state
  const [commissionPlan, setCommissionPlan] = useState(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [employeeCommissionCards, setEmployeeCommissionCards] = useState([]);
  const [commissionRangePreset, setCommissionRangePreset] = useState('today');
  const [commissionDateRange, setCommissionDateRange] = useState(() => getTodayDateRange());
  const [commissionRangeModalVisible, setCommissionRangeModalVisible] = useState(false);
  const [commissionRangeDraft, setCommissionRangeDraft] = useState({ dateFrom: '', dateTo: '' });
  const [commissionRangePickerField, setCommissionRangePickerField] = useState(null);
  const [todayOrderLines, setTodayOrderLines] = useState(() => lastDashboardSnapshot?.todayOrderLines ?? []);
  const [orderSyncStats, setOrderSyncStats] = useState(
    () =>
      lastDashboardSnapshot?.orderSyncStats ?? {
        pendingOrders: 0,
        localCompleted: 0,
        syncedCompleted: 0,
      }
  );

  // Stock overview (local lorry stock) computed from vehicle_inventories.
  const [stockCards, setStockCards] = useState(() => lastDashboardSnapshot?.stockCards ?? []);
  const [productIdToImageUri, setProductIdToImageUri] = useState({});
  const [emptyStockByKg, setEmptyStockByKg] = useState(() => lastDashboardSnapshot?.emptyStockByKg ?? {});

  // Collection cards: tap to expand one (shows full amount), tap again to collapse
  const [expandedCollectionCard, setExpandedCollectionCard] = useState(null);
  const [routeOverrideId, setRouteOverrideId] = useState(null);
  const [routePickerVisible, setRoutePickerVisible] = useState(false);
  const [profileModal, setProfileModal] = useState(null);
  const [postLoginSyncModalVisible, setPostLoginSyncModalVisible] = useState(false);
  const [pendingBackOfficeModalVisible, setPendingBackOfficeModalVisible] = useState(false);
  const pendingBackOfficeDismissedRef = useRef(false);
  const [notification, setNotification] = useState({ visible: false, title: '', message: '', type: 'info' });
  const [initialLoadGateActive, setInitialLoadGateActive] = useState(
    () => !isDashboardInitialLoadMemoryDone()
  );
  const dashboardSessionKeyRef = useRef(null);
  const lastSyncNotificationRef = React.useRef(null);
  const previousSyncedPaymentIdsRef = React.useRef(new Set());
  const initialSyncStartedRef = React.useRef(false);

  // Compute session key as a stable string for use in useEffect
  const sessionKey = useMemo(() => {
    if (!user) return null;
    if (user.isAdmin) {
      return user.vehicleId != null ? `admin|${Number(user.vehicleId)}` : 'admin';
    }
    if (user.driverId == null && user.vehicleId == null) return null;
    return `${Number(user.driverId) || 0}|${Number(user.vehicleId) || 0}`;
  }, [user?.isAdmin, user?.vehicleId, user?.driverId]);

  // Re-arm initial load gate when session changes (user/vehicle switched)
  useEffect(() => {
    if (!sessionKey) return;
    if (dashboardSessionKeyRef.current === sessionKey) return;
    dashboardSessionKeyRef.current = sessionKey;
    setInitialLoadGateActive(true);
    setLoading(true);
  }, [sessionKey]);

  const postLoginSyncCopy = useMemo(() => {
    return {
      en: {
        title: "You're all synced",
        subtitle:
          'Orders, deliveries, and payment breakdown are up to date on this device.',
        button: 'Great',
      },
      ta: {
        title: 'ஒத்திசைவு முடிந்தது',
        subtitle:
          'இந்த சாதனத்தில் ஆர்டர்கள், விநியோகம் மற்றும் கட்டண விவரங்கள் புதுப்பிக்கப்பட்டன.',
        button: 'சரி',
      },
      si: {
        title: 'සමමුහුර්තය අවසන්',
        subtitle:
          'මෙම උපාංගයෙන් ඇණවුම්, බෙදාහැරීම් සහ ගෙවීම් විස්තර යාවත්කාලීනයි.',
        button: 'හරි',
      },
    }[appLanguage] || {
      en: {
        title: "You're all synced",
        subtitle:
          'Orders, deliveries, and payment breakdown are up to date on this device.',
        button: 'Great',
      },
    };
  }, [appLanguage]);

  useEffect(() => {
    lastDashboardSnapshot = {
      orders,
      user,
      routes,
      lineTotalsByOrder,
      todayOrderLines,
      orderSyncStats,
      stockCards,
      emptyStockByKg,
    };
  }, [orders, user, routes, lineTotalsByOrder, todayOrderLines, orderSyncStats, stockCards, emptyStockByKg]);

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
    setLoading(true);
    try {
      const [userData, routesData] = await Promise.all([
        getUserSession(),
        getCachedRoutes(),
      ]);
      let user = userData || null;
      setUser(user);
      // Do not block dashboard data load on employee image API calls.
      // Hydrate missing crew images in background so first screen paints fast.
      if (user) {
        void (async () => {
          try {
            let nextUser = user;
            if (Array.isArray(nextUser.selectedPorters) && nextUser.selectedPorters.length > 0) {
              const needImages = nextUser.selectedPorters.some((p) => !p?.imageBase64);
              if (needImages) {
                const withImages = await getPortersEmployees();
                if (Array.isArray(withImages) && withImages.length) {
                  const byId = new Map(withImages.map((p) => [Number(p.id), p]));
                  nextUser = {
                    ...nextUser,
                    selectedPorters: nextUser.selectedPorters.map((p) => {
                      const full = byId.get(Number(p?.id));
                      if (!full) return p;
                      return {
                        ...p,
                        imageBase64: p.imageBase64 || full.imageBase64,
                        phone: (p.phone && String(p.phone).trim()) ? p.phone : (full.phone || ''),
                      };
                    }),
                  };
                }
              }
            }
            if (!hasValidEmployeeImage(nextUser?.driverImageBase64) && nextUser?.driverId != null) {
              let employees = await getDrivingEmployees();
              let matchedDriver = (employees || []).find((e) => Number(e?.id) === Number(nextUser.driverId));
              // Defensive fallback: some DBs may have driver mis-assigned to another department.
              if (!matchedDriver?.imageBase64) {
                employees = await getPortersEmployees();
                matchedDriver = (employees || []).find((e) => Number(e?.id) === Number(nextUser.driverId));
              }
              if (matchedDriver?.imageBase64) {
                nextUser = { ...nextUser, driverImageBase64: matchedDriver.imageBase64 };
              }
            }
            if (nextUser !== user) {
              try {
                await saveUserSession(nextUser);
              } catch (_) {}
              setUser((prev) => (prev ? { ...prev, ...nextUser } : nextUser));
            }
          } catch (e) {
            console.warn('[Dashboard] employee media hydrate failed', e?.message ?? e);
          }
        })();
      }
      setRoutes(Array.isArray(routesData) ? routesData : []);
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      let data = [];
      try {
        data = (await getCachedOrders(vehicleId)) || [];
      } catch (_) {
        data = [];
      }
      await pruneStaleCheckoutResumeEntries();
      const resumeMap = await getCheckoutResumeMap();
      let pendingCheckoutSaleOrderIds = pendingCheckoutSaleOrderIdsFromResumeMap(resumeMap);
      setOrders(Array.isArray(data) ? data : []);
      const allCachedOrderIds = (Array.isArray(data) ? data : [])
        .map((o) => Number(o?.id))
        .filter((id) => Number.isFinite(id));
      const backendDeliveredSet =
        allCachedOrderIds.length > 0
          ? await saleOrderLinesDb.getSaleOrderIdsWithPositiveQtyDelivered(allCachedOrderIds)
          : new Set();
      setBackendQtyDeliveredOrderIds(backendDeliveredSet);
      const imageMap = await productsDb.getProductImageUriMap().catch(() => ({}));
      setProductIdToImageUri(imageMap || {});
      const today = formatLocalDate(new Date());
      const todayOrders = (Array.isArray(data) ? data : []).filter((o) => getOrderDateForSyncMode(o).startsWith(today));
      // console.log('todayOrders', todayOrders);
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

      const pendingQueueItems = await syncQueueDb.getPending().catch(() => []);

      const pendingPaymentOrderIds = new Set(
        (pendingQueueItems || [])
          .filter((item) => item.action_type === syncQueueDb.ACTION_PAYMENT)
          .map((item) => Number(item.payload?.saleOrderId ?? item.payload?.sale_order_id))
          .filter((id) => Number.isFinite(id))
      );

      const localInvoiceSaleOrderIds = await localInvoicesDb.getSaleOrderIdsWithLocalInvoices().catch(() => new Set());
      setLocalInvoicedSaleOrderIds(localInvoiceSaleOrderIds);

      setPendingCheckoutOrderIds(pendingCheckoutSaleOrderIds);

      function orderCountsAsCompletedToday(order) {
        const oid = Number(order?.id);
        if (Number.isFinite(oid) && pendingCheckoutSaleOrderIds.has(oid)) return false;
        if (Number.isFinite(oid) && pendingPaymentOrderIds.has(oid)) {
          const deliveryDone = orderIsDeliveryDoneForProgress(
            order,
            saleIdToPickState,
            qtyDoneMap,
            backendDeliveredSet,
            pendingCheckoutSaleOrderIds
          );
          const isInvoiced =
            String(order?.invoice_status || '').toLowerCase() === 'invoiced' ||
            localInvoiceSaleOrderIds.has(oid);
          return isInvoiced || deliveryDone;
        }
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
      setDashboardUploadIndicators(pendingOrders, localCompleted);

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
          const [allPickings, allOrderLines, allQtyDoneBySo, allBackendDeliveredSet] = await Promise.all([
            allOrderIds.length ? getPickingsBySaleIdsFromDB(allOrderIds) : Promise.resolve([]),
            allOrderIds.length ? getOrderLinesByOrderIdsFromDB(allOrderIds) : Promise.resolve([]),
            allOrderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(allOrderIds) : Promise.resolve({}),
            allOrderIds.length
              ? saleOrderLinesDb.getSaleOrderIdsWithPositiveQtyDelivered(allOrderIds)
              : Promise.resolve(new Set()),
          ]);

          const allPickingState = mergePickingStateBySaleIdFromRows(allPickings);
          const orderByIdAll = {};
          for (const o of Array.isArray(data) ? data : []) {
            orderByIdAll[Number(o.id)] = o;
          }

          const deliveredQtyByProductId = {};
          for (const line of allOrderLines || []) {
            const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
            const soId = orderId != null ? Number(orderId) : null;
            if (soId == null || !Number.isFinite(soId)) continue;
            const order = orderByIdAll[soId];
            if (!order) continue;
            if (
              !orderCountsAsDeliveredForDashboard(
                order,
                allPickingState,
                allQtyDoneBySo,
                allBackendDeliveredSet,
                pendingCheckoutSaleOrderIds,
                localInvoiceSaleOrderIds,
                allOrderLines
              )
            ) {
              continue;
            }

            const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
            const pid = pidRaw != null ? Number(pidRaw) : null;
            if (pid == null || !Number.isFinite(pid)) continue;

            const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
            const qty = effectiveDeliveredQtyForLine(line, { isInvoiced });
            if (qty <= 0) continue;
            deliveredQtyByProductId[pid] = (deliveredQtyByProductId[pid] || 0) + qty;
          }

          const [inventories, productNameMap] = await Promise.all([
            vehicleInventoriesDb.getVehicleInventoryByVehicleId(vehicleId),
            productsDb.getProductsMap(),
          ]);
          const nextEmptyStockByKg = {};
          for (const inv of inventories || []) {
            const pid = inv?.product_id != null ? Number(inv.product_id) : null;
            const resolvedName = (pid != null ? productNameMap?.[pid] : null) || inv?.product_name || '';
            if (!isEmptyCylinderName(resolvedName)) continue;
            const kg = canonicalKgFromName(resolvedName);
            if (kg == null) continue;
            const qty = Math.max(0, Number(inv?.quantity) || 0);
            nextEmptyStockByKg[kg] = (nextEmptyStockByKg[kg] || 0) + qty;
          }
          setEmptyStockByKg(nextEmptyStockByKg);
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
          setStockCards((prev) => (prev?.length ? prev : []));
        }
      } catch (_) {
        setStockCards((prev) => (prev?.length ? prev : []));
      }

      lastDashboardSnapshot = {
        orders: Array.isArray(data) ? data : [],
        user,
        routes: Array.isArray(routesData) ? routesData : [],
        lineTotalsByOrder: totals || {},
        todayOrderLines: orderLines || [],
        orderSyncStats: {
          pendingOrders,
          localCompleted,
          syncedCompleted,
        },
        stockCards: Array.isArray(stockCards) ? stockCards : [],
        emptyStockByKg: emptyStockByKg || {},
      };
    } catch (err) {
      // Keep last known dashboard data on transient read failures.
      console.warn('[Dashboard] loadData failed, preserving previous view state', err?.message ?? err);
    } finally {
      setLoading(false);
    }
  }, [formatLocalDate, getOrderDateForSyncMode]);


  const loadCommissionData = useCallback(async () => {
    if (!user) return;

    setCommissionLoading(true);
    try {
      const [plan, deliveryRows, commissionRows] = await Promise.all([
        user?.licensePlate ? getActiveCommissionPlan(user.licensePlate) : Promise.resolve(null),
        (async () => {
          const { dateFrom, dateTo } = commissionDateRange;
          const raw = [
            user?.driverId != null ? Number(user.driverId) : null,
            ...((Array.isArray(user?.selectedPorters) ? user.selectedPorters : [])
              .map((p) => Number(p?.id))
              .filter((id) => Number.isFinite(id))),
          ];
          const employeeIds = [...new Set(raw.filter((id) => Number.isFinite(id)).map((id) => Number(id)))];
          if (employeeIds.length === 0) return [];
          return getDeliverySummaryByEmployeeByDate({ dateFrom, dateTo, employeeIds });
        })(),
        (async () => {
          const { dateFrom, dateTo } = commissionDateRange;
          const raw = [
            user?.driverId != null ? Number(user.driverId) : null,
            ...((Array.isArray(user?.selectedPorters) ? user.selectedPorters : [])
              .map((p) => Number(p?.id))
              .filter((id) => Number.isFinite(id))),
          ];
          const employeeIds = [...new Set(raw.filter((id) => Number.isFinite(id)).map((id) => Number(id)))];
          if (employeeIds.length === 0) return [];
          return getCommissionByEmployeeByDate({ dateFrom, dateTo, employeeIds });
        })(),
      ]);
      setCommissionPlan(plan);
      setEmployeeCommissionCards(mergeCommissionRowsByEmployee(deliveryRows, commissionRows));
    } catch (_) {
      setCommissionPlan(null);
      setEmployeeCommissionCards([]);
    } finally {
      setCommissionLoading(false);
    }
  }, [user, commissionDateRange]);

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
    const tryPostLoginBanner = () => {
      void (async () => {
        try {
          const show = await consumePostLoginSyncSuccessPending();
          if (show) setPostLoginSyncModalVisible(true);
        } catch (_) {}
      })();
    };
    const unsub = navigation.addListener?.('focus', () => {
      loadData();
      loadSyncStatus();
      tryPostLoginBanner();
      void hasActiveUploadWork().then((pending) => {
        if (!pending) {
          stopPendingUploadRetryLoop();
          return;
        }
        schedulePendingUploadSync({
          immediate: true,
          aggressive: true,
          queuePasses: 16,
          includeAttachments: true,
        });
        void hasActionablePendingUploadWork().then((actionable) => {
          if (actionable) ensurePendingUploadRetryLoop();
          else stopPendingUploadRetryLoop();
        });
      });
    });
    loadData();
    loadSyncStatus();
    tryPostLoginBanner();
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
    const orange = orderSyncStats.localCompleted;
    if (orange <= 0) {
      pendingBackOfficeDismissedRef.current = false;
      setPendingBackOfficeModalVisible(false);
      void AsyncStorage.removeItem(ORANGE_UPLOAD_SINCE_KEY);
      return undefined;
    }

    const evaluate = async () => {
      if (pendingBackOfficeDismissedRef.current) return;
      let sinceRaw = await AsyncStorage.getItem(ORANGE_UPLOAD_SINCE_KEY);
      if (!sinceRaw) {
        sinceRaw = String(Date.now());
        await AsyncStorage.setItem(ORANGE_UPLOAD_SINCE_KEY, sinceRaw);
      }
      const since = Number(sinceRaw);
      if (Number.isFinite(since) && Date.now() - since >= ORANGE_UPLOAD_REMINDER_MS) {
        setPendingBackOfficeModalVisible(true);
      }
    };

    void evaluate();
    const id = setInterval(() => {
      void evaluate();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [orderSyncStats.localCompleted]);

  useEffect(() => {
    if (isSyncing || !syncResult) return;
    if (lastSyncNotificationRef.current === syncResult) return;
    lastSyncNotificationRef.current = syncResult;

    if (syncResult === 'success') {
      void (async () => {
        let nextSyncedIds = new Set();
        try {
          nextSyncedIds = await syncQueueDb.getSyncedPaymentSaleOrderIds();
        } catch (_) {
          nextSyncedIds = new Set();
        }

        const newlySyncedOrderIds = [];
        for (const id of nextSyncedIds) {
          if (!previousSyncedPaymentIdsRef.current.has(id)) {
            newlySyncedOrderIds.push(Number(id));
          }
        }
        previousSyncedPaymentIdsRef.current = new Set(nextSyncedIds);

        if (newlySyncedOrderIds.length > 0) {
          const latestOrderId = newlySyncedOrderIds[newlySyncedOrderIds.length - 1];
          const matchedOrder = (orders || []).find((o) => Number(o?.id) === Number(latestOrderId));
          const customerName = matchedOrder
            ? getLocalizedCustomerNameFromOrder(matchedOrder, appLanguage)
            : `SO #${latestOrderId}`;

          setNotification({
            visible: true,
            title: t('common.orderSyncCompletedTitle', 'Order sync completed'),
            message: t('common.orderSyncCompletedBody', '{{customer}} order sync completed.', { customer: customerName }),
            type: 'success',
          });
          return;
        }
      })();
      return;
    }

    setNotification({
      visible: true,
      title: t('common.syncFailedTitle', 'Sync failed'),
      message: syncErrorMessage || t('common.syncFailedBody', 'Data sync failed. Please try again.'),
      type: 'error',
    });
  }, [isSyncing, syncResult, syncErrorMessage, t, orders, appLanguage]);

  useEffect(() => {
    if (user?.licensePlate) {
      loadCommissionData();
    }
  }, [user?.licensePlate, loadCommissionData, commissionDateRange.dateFrom, commissionDateRange.dateTo]);

  const totalCrewCommission = useMemo(
    () => (employeeCommissionCards || []).reduce((s, r) => s + (Number(r.totalCommission) || 0), 0),
    [employeeCommissionCards]
  );

  useEffect(() => {
    if (!user?.pendingInitialSync) {
      initialSyncStartedRef.current = false;
      return;
    }
    if (isSyncing) {
      initialSyncStartedRef.current = true;
      return;
    }
    if (!initialSyncStartedRef.current) return;
    let cancelled = false;
    (async () => {
      const u = await getUserSession();
      if (cancelled || !u?.pendingInitialSync) return;
      try {
        await saveUserSession({ ...u, pendingInitialSync: false });
      } catch (_) {}
      setUser((prev) => (prev ? { ...prev, pendingInitialSync: false } : prev));
      initialSyncStartedRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.pendingInitialSync, isSyncing]);

  // If the user already completed the one-time initial dashboard load (stored + memory), open without the full-screen gate
  // after a cold start or when the Dashboard unmounts/remounts in the same app session.
  useLayoutEffect(() => {
    let cancelled = false;
    (async () => {
      const { done } = await hydrateDashboardInitialLoadFromStorage();
      if (cancelled) return;
      if (done) setInitialLoadGateActive(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One-time initial login gate:
  // show only full-screen loader (no empty dashboard) until first complete data load finishes.
  useEffect(() => {
    if (!initialLoadGateActive) return;
    if (loading) return;
    if (user?.pendingInitialSync) return;
    void markDashboardInitialLoadComplete(user);
    setInitialLoadGateActive(false);
  }, [initialLoadGateActive, loading, user?.pendingInitialSync, user]);

  // Safety: if first dashboard load is complete and sync is no longer running,
  // clear pendingInitialSync so full-screen blocker never repeats on later visits.
  useEffect(() => {
    if (!user?.pendingInitialSync) return;
    if (loading || isSyncing) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await getUserSession();
        if (cancelled || !u?.pendingInitialSync) return;
        await saveUserSession({ ...u, pendingInitialSync: false });
      } catch (_) {}
      if (!cancelled) {
        setUser((prev) => (prev ? { ...prev, pendingInitialSync: false } : prev));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.pendingInitialSync, loading, isSyncing]);

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
      setChartOrderLines(todayOrderLines);
      setChartPickingsBySaleId(pickingsBySaleId);
      setChartQtyDoneBySaleId(qtyDoneBySaleId);
      return;
    }
    const dateOrders = orders.filter((o) => getOrderDateForSyncMode(o).startsWith(selectedChartDate));
    const orderIds = dateOrders.map((o) => o.id);
    if (orderIds.length === 0) {
      setChartLineTotalsByOrder({});
      setChartOrderLines([]);
      setChartPickingsBySaleId([]);
      setChartQtyDoneBySaleId({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [totals, lines, pickings, qtyMap] = await Promise.all([
          getOrderLineTotalsFromDB(dateOrders),
          getOrderLinesByOrderIdsFromDB(orderIds),
          getPickingsBySaleIdsFromDB(orderIds),
          deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds),
        ]);
        if (!cancelled) {
          setChartLineTotalsByOrder(totals || {});
          setChartOrderLines(lines || []);
          setChartPickingsBySaleId(pickings || []);
          setChartQtyDoneBySaleId(qtyMap || {});
        }
      } catch (_) {
        if (!cancelled) {
          setChartLineTotalsByOrder({});
          setChartOrderLines([]);
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
    todayOrderLines,
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

  const syncButtonActive = syncing || isSyncing;

  const onSync = async () => {
    if (syncing || isSyncing) return;
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
        orderCountsAsDeliveredForDashboard(
          o,
          pickingStateBySaleId,
          qtyDoneBySaleId,
          backendQtyDeliveredOrderIds,
          pendingCheckoutOrderIds,
          localInvoicedSaleOrderIds,
          todayOrderLines
        )
      ),
    [
      todayOrdersForDashboard,
      pickingStateBySaleId,
      qtyDoneBySaleId,
      backendQtyDeliveredOrderIds,
      pendingCheckoutOrderIds,
      localInvoicedSaleOrderIds,
      todayOrderLines,
    ]
  );

  const deliveredTodayOrdersAllRoutes = useMemo(
    () =>
      todayOrders.filter((o) =>
        orderCountsAsDeliveredForDashboard(
          o,
          pickingStateBySaleId,
          qtyDoneBySaleId,
          backendQtyDeliveredOrderIds,
          pendingCheckoutOrderIds,
          localInvoicedSaleOrderIds,
          todayOrderLines
        )
      ),
    [
      todayOrders,
      pickingStateBySaleId,
      qtyDoneBySaleId,
      backendQtyDeliveredOrderIds,
      pendingCheckoutOrderIds,
      localInvoicedSaleOrderIds,
      todayOrderLines,
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
    const deliveredOrderIds = new Set(deliveredTodayOrdersAllRoutes.map((o) => Number(o.id)));
    const orderById = {};
    deliveredTodayOrdersAllRoutes.forEach((o) => {
      orderById[Number(o.id)] = o;
    });
    const map = {};
    (todayOrderLines || []).forEach((line) => {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      if (soId == null || !deliveredOrderIds.has(soId)) return;

      const pidRaw = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const pid = pidRaw != null ? Number(pidRaw) : null;
      if (pid == null || !Number.isFinite(pid)) return;

      const order = orderById[soId];
      const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
      const qty = effectiveDeliveredQtyForLine(line, { isInvoiced });
      if (qty <= 0) return;
      map[pid] = (map[pid] || 0) + qty;
    });
    return map;
  }, [deliveredTodayOrdersAllRoutes, todayOrderLines]);

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
  const driverHeaderUri = hasValidEmployeeImage(user?.driverImageBase64)
    ? odooImageToUri(user.driverImageBase64)
    : null;
  const crewPorters = Array.isArray(user?.selectedPorters) ? user.selectedPorters : [];


  // Use commission rate from API, default to Rs. 1 per item if not available
  const commissionPercentage = commissionPlan?.commission_percentage || 1;
  const productRateMap = commissionPlan?.productRateMap || {};

  // Calculate totals for fallback commission calculation
  const allOrdersTotal = todayOrders.reduce((s, o) => s + orderMoneyTotal(o), 0);
  const deliveredOrdersTotal = deliveredTodayOrdersAllRoutes.reduce(
    (s, o) => s + orderMoneyTotal(o),
    0
  );

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

  const shopsCompleted = deliveredTodayOrdersAllRoutes.length;
  const totalShopsToday = todayOrders.length;
  const shopsPct = totalShopsToday > 0 ? Math.min(100, Math.round((shopsCompleted / totalShopsToday) * 100)) : 0;
  const totalGasDelivered = useMemo(() => {
    const orderById = {};
    deliveredTodayOrdersAllRoutes.forEach((o) => {
      orderById[Number(o.id)] = o;
    });
    let sum = 0;
    for (const line of todayOrderLines || []) {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      if (soId == null || !orderById[soId]) continue;
      const isInvoiced = String(orderById[soId]?.invoice_status || '').toLowerCase() === 'invoiced';
      sum += effectiveDeliveredQtyForLine(line, { isInvoiced });
    }
    return sum;
  }, [deliveredTodayOrdersAllRoutes, todayOrderLines]);
  const totalGasInOrders = todayOrders.reduce(
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
    const gasSort = (a, b) => {
      const an = Number(String(a).replace(/[^0-9.]/g, ''));
      const bn = Number(String(b).replace(/[^0-9.]/g, ''));
      const aFinite = Number.isFinite(an);
      const bFinite = Number.isFinite(bn);
      if (aFinite && bFinite) return an - bn;
      if (aFinite) return -1;
      if (bFinite) return 1;
      return String(a).localeCompare(String(b));
    };

    const orderById = {};
    chartDateOrders.forEach((o) => {
      orderById[Number(o.id)] = o;
      const partnerId = o.partner_id?.[0] ?? o.partner_id;
      const partnerName = getLocalizedCustomerNameFromOrder(o, appLanguage) || `Shop ${partnerId}`;
      const key = partnerId ?? 'unknown';
      if (!byPartner[key]) {
        byPartner[key] = {
          shopId: `S${partnerId}`,
          shopName: partnerName,
          delivered: 0,
          pending: 0,
          total: 0,
          stacks: {},
        };
      }
    });

    (chartOrderLines || []).forEach((line) => {
      const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      const soId = orderId != null ? Number(orderId) : null;
      if (soId == null || !Number.isFinite(soId)) return;
      const order = orderById[soId];
      if (!order) return;

      const partnerId = order.partner_id?.[0] ?? order.partner_id;
      const key = partnerId ?? 'unknown';
      if (!byPartner[key]) return;

      const orderedQty = Math.round(Number(line.product_uom_qty) || 0);
      if (orderedQty <= 0) return;

      const productName = (Array.isArray(line.product_id) ? line.product_id[1] : null) || line.name || '';
      const canonicalKg = canonicalKgFromName(productName);
      const parsedKg = canonicalKg == null ? parseKgFromProductName(productName) : null;
      const gasTypeKey = canonicalKg != null
        ? `${canonicalKg}kg`
        : Number.isFinite(Number(parsedKg))
          ? `${Number(parsedKg)}kg`
          : 'Other';

      byPartner[key].stacks[gasTypeKey] = (Number(byPartner[key].stacks[gasTypeKey]) || 0) + orderedQty;

      byPartner[key].total += orderedQty;

      const isDone = orderCountsAsDeliveredForDashboard(
        order,
        chartPickingStateBySaleId,
        chartQtyDoneBySaleId,
        backendQtyDeliveredOrderIds,
        pendingCheckoutOrderIds,
        localInvoicedSaleOrderIds,
        chartOrderLines
      );
      const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
      const deliveredQty = Math.round(effectiveDeliveredQtyForLine(line, { isInvoiced }));
      if (isDone) byPartner[key].delivered += deliveredQty > 0 ? deliveredQty : orderedQty;
      else byPartner[key].pending += orderedQty;
    });

    const real = Object.values(byPartner)
      .map((r) => {
        const orderedStacks = {};
        Object.keys(r.stacks || {})
          .sort(gasSort)
          .forEach((k) => {
            orderedStacks[k] = r.stacks[k];
          });
        return { ...r, stacks: orderedStacks };
      })
      .filter((r) => r.total > 0);

    return real;
  }, [
    chartDateOrders,
    chartOrderLines,
    chartPickingStateBySaleId,
    chartQtyDoneBySaleId,
    backendQtyDeliveredOrderIds,
    pendingCheckoutOrderIds,
    localInvoicedSaleOrderIds,
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
        syncNowBtn: {
          alignSelf: 'flex-end',
          marginTop: 8,
          minHeight: 36,
          minWidth: 108,
          borderRadius: 18,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.65)',
          backgroundColor: 'rgba(255,255,255,0.12)',
        },
        syncNowBtnSyncing: {
          minWidth: 108,
          paddingHorizontal: 12,
        },
        syncNowBtnIconWrap: {
          marginRight: 6,
        },
        syncNowBtnText: {
          fontSize: 12,
          fontWeight: '800',
          color: '#fff',
          letterSpacing: 0.2,
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
        commissionEmptyCard: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        commissionEmptyText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
        employeeCommissionName: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1, minHeight: 36 },
        employeeCommissionType: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize', marginTop: 2 },
        employeeCommissionAmount: { fontSize: 22, fontWeight: '900', color: colors.primary, textAlign: 'center' },
        employeeCommissionQty: { fontSize: 12, color: colors.textSecondary, marginTop: 4, fontWeight: '700' },
        commissionDetailRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        commissionDetailLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
        commissionDetailValue: { fontSize: 14, color: colors.text, fontWeight: '800' },
        commissionRangeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: spacing.sm,
          flexWrap: 'wrap',
        },
        commissionRangeChip: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingVertical: 6,
          paddingHorizontal: 10,
          backgroundColor: colors.surface,
        },
        commissionRangeChipActive: {
          borderColor: colors.primary,
          backgroundColor: (colors.primary || '#6366f1') + '18',
        },
        commissionRangeChipText: {
          fontSize: 12,
          fontWeight: '700',
          color: colors.textSecondary,
        },
        commissionRangeChipTextActive: {
          color: colors.primary,
        },
        commissionDateRangeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 10,
          paddingHorizontal: 12,
          marginBottom: spacing.sm,
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        commissionDateRangeRowText: {
          flex: 1,
          fontSize: 13,
          fontWeight: '600',
          color: colors.text,
        },
        commissionModalRangeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
          paddingHorizontal: 4,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        commissionModalRangeLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
        commissionModalRangeValue: { fontSize: 15, fontWeight: '700', color: colors.primary },
        employeeCommissionCard: {
          width: 200,
          borderWidth: 0,
          borderRadius: borderRadius.lg,
          backgroundColor: colors.surface,
          marginRight: spacing.sm,
          overflow: 'hidden',
          borderLeftWidth: 4,
          borderLeftColor: colors.primary,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.1,
          shadowRadius: 5,
          elevation: 3,
        },
        employeeCardInner: {
          padding: spacing.md,
          backgroundColor: (colors.primary || '#4f46e5') + '0C',
        },
        employeeCommissionNameRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 6,
        },
        employeeTypePill: {
          alignSelf: 'flex-start',
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: colors.background,
        },
        employeeTypePillText: { fontSize: 10, fontWeight: '800', color: colors.textSecondary, textTransform: 'capitalize' },
        employeeMoneyBand: {
          marginTop: spacing.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.sm,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          alignItems: 'center',
        },
        employeeCommissionSubLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
        employeeCommissionFooter: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          marginTop: spacing.sm,
        },
        employeeCommissionFooterText: { fontSize: 12, fontWeight: '700', color: colors.text },
        commissionSectionCard: {
          marginHorizontal: spacing.md,
          marginBottom: spacing.md,
          borderRadius: borderRadius.xl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 4,
        },
        commissionHero: {
          paddingVertical: 18,
          paddingHorizontal: spacing.md,
          backgroundColor: colors.primary,
        },
        commissionHeroKicker: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.88)', letterSpacing: 1.2 },
        commissionHeroTotal: { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: 6 },
        commissionHeroHint: { fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 6, lineHeight: 18 },
        commissionBody: { padding: spacing.md, backgroundColor: colors.surface },
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
        syncSuccessAccent: {
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.primary + '18',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: spacing.md,
        },
        syncSuccessTitle: {
          fontSize: 20,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        syncSuccessSubtitle: {
          fontSize: 14,
          lineHeight: 21,
          color: colors.textSecondary,
          textAlign: 'center',
          marginBottom: spacing.lg,
        },
        initialSyncOverlayRoot: { flex: 1 },
        initialSyncCenter: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
        },
        initialSyncTitle: {
          marginTop: spacing.lg,
          fontSize: 17,
          fontWeight: '700',
          color: '#f8fafc',
          textAlign: 'center',
        },
        initialSyncSub: {
          marginTop: spacing.sm,
          fontSize: 14,
          color: 'rgba(248, 250, 252, 0.9)',
          textAlign: 'center',
        },
      }),
    [colors]
  );

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

  const hasAnyDashboardData =
    (orders?.length || 0) > 0 ||
    (todayOrderLines?.length || 0) > 0 ||
    (stockCards?.length || 0) > 0 ||
    Object.keys(lineTotalsByOrder || {}).length > 0;
  /** Keep full-screen loader until first dashboard load finishes (same as earlier behavior). */
  const shouldShowInitialFullScreenLoader =
    (initialLoadGateActive && (loading || isSyncing || !!user?.pendingInitialSync)) ||
    (loading && !hasAnyDashboardData);

  /** Blur overlay on first-session sync when dashboard shell is visible but data sync is still in flight */
  const shouldBlockDashboard =
    initialLoadGateActive && (isSyncing || !!user?.pendingInitialSync);

  if (shouldShowInitialFullScreenLoader) {
    return (
      <View style={[styles.container, styles.initialSyncCenter]}>
        <Ionicons name="cloud-download-outline" size={36} color={colors.primary} />
        <Text style={[styles.initialSyncTitle, { color: colors.text }]}>
          {t('dashboard.initialSyncTitle', 'Loading your data...')}
        </Text>
        <Text style={[styles.initialSyncSub, { color: colors.textSecondary }]}>
          {t('dashboard.initialSyncSub', 'This only takes a moment.')}
        </Text>
        <ActivityIndicator style={{ marginTop: 16 }} size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <RichNotification
      visible={notification.visible}
      title={notification.title}
      message={notification.message}
      type={notification.type}
      onHide={() => setNotification((prev) => ({ ...prev, visible: false }))}
    />
    <View style={styles.initialSyncOverlayRoot}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    >
      {/* 1. Top bar: date + route left; last synced + sync counters + Sync now (same control shows rotating icon while sync runs) */}
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
                <NetworkStatusPill />
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
                accessibilityLabel={t('dashboard.chooseRouteForToday', 'Choose route for today')}
              >
                <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.95)" />
                <Text style={styles.routePillText} numberOfLines={1}>
                  {t('dashboard.route', 'Route:')} {routeName}
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
                  {t('dashboard.route', 'Route:')} {routeName}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.headerButtons}>
              <View style={styles.lastSyncedBlock}>
                <Text style={styles.lastSyncedLabel}>{t("dashboard.lastSynced")}</Text>
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
                <TouchableOpacity
                  style={[styles.syncNowBtn, syncButtonActive && styles.syncNowBtnSyncing]}
                  onPress={onSync}
                  activeOpacity={0.85}
                  disabled={syncButtonActive}
                  accessibilityRole="button"
                  accessibilityLabel={
                    syncButtonActive
                      ? t('common.syncing', 'Syncing')
                      : t('dashboard.syncNow', 'Sync now')
                  }
                >
                  {syncButtonActive ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" style={styles.syncNowBtnIconWrap} />
                      <Text style={styles.syncNowBtnText}>{t('menu.syncing', 'Syncing...')}</Text>
                    </>
                  ) : (
                    <Text style={styles.syncNowBtnText}>{t('dashboard.syncNow', 'Sync now')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            {/* //Daily Visit Keep Commented for now */}
            {/* <TouchableOpacity
              style={styles.dailyVisitBtnTop}
              onPress={() => navigation.navigate('Orders', { customerId: null })}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={20} color="#fff" />
              <Text style={styles.dailyVisitBtnTopText}>{t("dashboard.visit")}</Text>
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
                const cardKg = s._defaultGasKg != null ? Number(s._defaultGasKg) : parseKgFromProductName(productLabel);
                const showEmptyCollected = s._defaultGasKg != null && isGasCylinderName(productLabel);
                const emptyCollectedQty =
                  showEmptyCollected && cardKg != null ? Number(emptyStockByKg[cardKg]) || 0 : 0;

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
                      {t('dashboard.onHandStock', 'On Hand Stock')}
                    </Text>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: isOut ? '#dc2626' : '#3b82f6', marginTop: 4 }}>
                      {(Number(s.total) || 0).toLocaleString('en-IN')}
                    </Text>
                    <View style={{ height: 6 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '800' }}>
                      {t('dashboard.delivered', 'Delivered')}
                    </Text>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: deliveredQty > 0 ? '#16a34a' : colors.textSecondary, marginTop: 4 }}>
                      {deliveredQty.toLocaleString('en-IN')}
                    </Text>
                    {showEmptyCollected ? (
                      <>
                        <View style={{ height: 6 }} />
                        <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '800' }}>
                          {t('dashboard.emptyCollected', 'Empty Collected')}
                        </Text>
                        <Text style={{ fontSize: 18, fontWeight: '900', color: emptyCollectedQty > 0 ? '#0f766e' : colors.textSecondary, marginTop: 4 }}>
                          {emptyCollectedQty.toLocaleString('en-IN')}
                        </Text>
                      </>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={{ paddingVertical: spacing.md }}>
                <Text style={{ color: colors.textSecondary }}>{t('dashboard.noStockDataAvailable', 'No stock data available.')}</Text>
              </View>
            )}
          </ScrollView>
        </View>

        {/* 3. Collection today - Cash, Cheque, Credit (tap to expand / tap again to collapse) */}
        <Text style={styles.collectionSectionLabel}>{t("dashboard.salesToday")}</Text>
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
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cash' && styles.collectionLabelExpanded]}>{t("dashboard.cash", "CASH")}</Text>
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
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'cheque' && styles.collectionLabelExpanded]}>{t("dashboard.cheque", "CHEQUE")}</Text>
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
                <Text style={[styles.collectionLabel, expandedCollectionCard === 'credit' && styles.collectionLabelExpanded]}>{t("dashboard.credit", "CREDIT")}</Text>
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
            <Text style={styles.shopsGasLabel}>{t("dashboard.ordersCompleted", "ORDERS COMPLETED")}</Text>
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
            <Text style={styles.shopsGasLabel}>{t("dashboard.gasDelivered", "GAS DELIVERED")}</Text>
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
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.primary }}>{t("dashboard.done", "Done")}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>
      {crewPorters.length > 0 && (
          <View style={styles.crewSectionWrap}>
            <Text style={styles.crewSectionLabel}>{t("dashboard.portersOnShift", "Porters on shift")}</Text>
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
      {/* Employee commission — web-style card: total + filters + crew strip */}
      <View style={styles.commissionSectionCard}>
        <View style={styles.commissionHero}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.commissionHeroKicker}>
              {t('dashboard.crewEarnings', 'CREW EARNINGS').toUpperCase()}
            </Text>
            {commissionLoading ? <ActivityIndicator size="small" color="#fff" /> : null}
          </View>
          <Text style={styles.commissionHeroTotal}>{formatCurrency(totalCrewCommission)}</Text>
          <Text style={styles.commissionHeroHint}>
            {t(
              'dashboard.crewEarningsHint',
              'Combined commission for your vehicle team in the period below. Tap a name for details.'
            )}
          </Text>
        </View>
        <View style={styles.commissionBody}>
          <View style={[styles.commissionRangeRow, { marginBottom: spacing.sm }]}>
            {[
              { key: 'today', label: t('dashboard.commissionToday', 'Today'), range: getTodayDateRange() },
              { key: 'yesterday', label: t('dashboard.commissionYesterday', 'Yesterday'), range: getYesterdayDateRange() },
              { key: 'month', label: t('dashboard.commissionThisMonth', 'This month'), range: getMonthDateRange() },
            ].map((opt) => {
              const active = commissionRangePreset === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.commissionRangeChip, active && styles.commissionRangeChipActive]}
                  activeOpacity={0.86}
                  onPress={() => {
                    setCommissionRangePreset(opt.key);
                    setCommissionDateRange(opt.range);
                  }}
                >
                  <Text style={[styles.commissionRangeChipText, active && styles.commissionRangeChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            style={styles.commissionDateRangeRow}
            activeOpacity={0.86}
            onPress={() => {
              setCommissionRangeDraft({
                dateFrom: commissionDateRange.dateFrom,
                dateTo: commissionDateRange.dateTo,
              });
              setCommissionRangePickerField(null);
              setCommissionRangeModalVisible(true);
            }}
          >
            <Ionicons name="calendar" size={20} color={colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.commissionDateRangeRowText} numberOfLines={2}>
              {formatDateRangeLabel(commissionDateRange.dateFrom, commissionDateRange.dateTo)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        {employeeCommissionCards.length === 0 ? (
          <View style={[styles.commissionEmptyCard, { marginTop: spacing.sm, marginBottom: 0 }]}>
            <Ionicons name="people-outline" size={22} color={colors.textSecondary} />
            <Text style={styles.commissionEmptyText}>
              {t('dashboard.noEmployeeCommission', 'No commission records for this date range.')}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: spacing.md }}
            contentContainerStyle={{ paddingRight: 8 }}
          >
            {employeeCommissionCards.map((row) => (
              <TouchableOpacity
                key={String(row.employeeId)}
                activeOpacity={0.86}
                style={styles.employeeCommissionCard}
                onPress={() =>
                  navigation.navigate('MyCommissions', {
                    employeeId: Number(row.employeeId),
                    employeeName: row.employeeName,
                    employeeType: row.employeeType || 'employee',
                    dateFrom: commissionDateRange.dateFrom,
                    dateTo: commissionDateRange.dateTo,
                  })
                }
              >
                <View style={styles.employeeCardInner}>
                  <View style={styles.employeeCommissionNameRow}>
                    <Text style={styles.employeeCommissionName} numberOfLines={2}>
                      {row.employeeName}
                    </Text>
                    <View style={styles.employeeTypePill}>
                      <Text style={styles.employeeTypePillText}>{row.employeeType || 'employee'}</Text>
                    </View>
                  </View>
                  <View style={styles.employeeMoneyBand}>
                    <Text style={styles.employeeCommissionAmount}>{formatCurrency(row.totalCommission)}</Text>
                    <Text style={styles.employeeCommissionSubLabel}>
                      {t('dashboard.commissionEarned', 'Commission')}
                    </Text>
                  </View>
                  <View style={styles.employeeCommissionFooter}>
                    <Ionicons name="flame-outline" size={16} color={colors.primary} />
                    <Text style={styles.employeeCommissionFooterText}>
                      {t('dashboard.gasQtyTotal', 'Gas qty')}: {Number(row.totalQty || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        </View>
      </View>

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
                    <Text style={styles.actionLabel}>{t("dashboard.createSalesOrder", "Create Sales Order")}</Text>
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
                    <Text style={styles.actionLabel}>{t("dashboard.returnOrder", "Return Order")}</Text>
                  </TouchableOpacity>
              )}
            </View>
        )}
      </ScrollView>

      {shouldBlockDashboard ? (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 50 }]} pointerEvents="auto">
          <BlurView
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            intensity={52}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255, 255, 255, 0.22)' }]} />
          <View style={styles.initialSyncCenter} pointerEvents="box-none">
            <View
              style={{
                width: '100%',
                maxWidth: 360,
                backgroundColor: colors.surface + 'EE',
                borderRadius: borderRadius.xl,
                paddingVertical: 28,
                paddingHorizontal: 24,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.border,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.15,
                shadowRadius: 18,
                elevation: 10,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: (colors.primary || '#4f46e5') + '14',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Ionicons name="cloud-download-outline" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.initialSyncTitle, { color: colors.text }]}>
                {t('dashboard.initialSyncTitle', 'Loading your data...')}
              </Text>
              <Text style={[styles.initialSyncSub, { color: colors.textSecondary }]}>
                {t('dashboard.initialSyncSub', 'This only takes a moment.')}
              </Text>
              <ActivityIndicator style={{ marginTop: 18 }} size="large" color={colors.primary} />
            </View>
          </View>
        </View>
      ) : null}

    </View>

      <Modal
        visible={commissionRangeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCommissionRangeModalVisible(false);
          setCommissionRangePickerField(null);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setCommissionRangeModalVisible(false);
            setCommissionRangePickerField(null);
          }}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('dashboard.commissionDateRange', 'Date range')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('dashboard.commissionDateRangeHint', 'Choose from and to, then apply. You can also use Today / Yesterday / This month.')}
            </Text>
            <TouchableOpacity
              style={styles.commissionModalRangeRow}
              onPress={() => setCommissionRangePickerField('from')}
              activeOpacity={0.8}
            >
              <Text style={styles.commissionModalRangeLabel}>{t('dashboard.dateFrom', 'From')}</Text>
              <Text style={styles.commissionModalRangeValue}>
                {formatDateRangeLabel(commissionRangeDraft.dateFrom, commissionRangeDraft.dateFrom)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.commissionModalRangeRow}
              onPress={() => setCommissionRangePickerField('to')}
              activeOpacity={0.8}
            >
              <Text style={styles.commissionModalRangeLabel}>{t('dashboard.dateTo', 'To')}</Text>
              <Text style={styles.commissionModalRangeValue}>
                {formatDateRangeLabel(commissionRangeDraft.dateTo, commissionRangeDraft.dateTo)}
              </Text>
            </TouchableOpacity>
            {commissionRangePickerField ? (
              <DateTimePicker
                value={(() => {
                  const key = commissionRangePickerField === 'from' ? 'dateFrom' : 'dateTo';
                  const raw =
                    commissionRangeDraft[key] ||
                    commissionDateRange[key] ||
                    getTodayDateRange().dateFrom;
                  const d = new Date(`${String(raw).slice(0, 10)}T12:00:00`);
                  return Number.isNaN(d.getTime()) ? new Date() : d;
                })()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(e, date) => {
                  if (e?.type === 'dismissed') {
                    if (Platform.OS === 'android') setCommissionRangePickerField(null);
                    return;
                  }
                  if (!date) {
                    if (Platform.OS === 'android') setCommissionRangePickerField(null);
                    return;
                  }
                  const which = commissionRangePickerField;
                  if (which !== 'from' && which !== 'to') return;
                  const y = date.getFullYear();
                  const m = String(date.getMonth() + 1).padStart(2, '0');
                  const d0 = String(date.getDate()).padStart(2, '0');
                  const s = `${y}-${m}-${d0}`;
                  setCommissionRangeDraft((prev) => ({
                    ...prev,
                    [which === 'from' ? 'dateFrom' : 'dateTo']: s,
                  }));
                  if (Platform.OS === 'android') setCommissionRangePickerField(null);
                }}
              />
            ) : null}
            {commissionRangePickerField && Platform.OS === 'ios' ? (
              <TouchableOpacity
                onPress={() => setCommissionRangePickerField(null)}
                style={{ alignSelf: 'flex-end', padding: 8 }}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('dashboard.done', 'Done')}</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.sm }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                }}
                onPress={() => {
                  setCommissionRangeModalVisible(false);
                  setCommissionRangePickerField(null);
                }}
                activeOpacity={0.86}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                  {t('common.cancel', 'Cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                }}
                onPress={() => {
                  let dateFrom = commissionRangeDraft.dateFrom;
                  let dateTo = commissionRangeDraft.dateTo;
                  if (!dateFrom || !dateTo) {
                    Alert.alert(
                      t('dashboard.rangeInvalid', 'Date range'),
                      t('dashboard.selectBothDates', 'Please choose both from and to dates.')
                    );
                    return;
                  }
                  if (dateFrom > dateTo) {
                    const t0 = dateFrom;
                    dateFrom = dateTo;
                    dateTo = t0;
                  }
                  setCommissionDateRange({ dateFrom, dateTo });
                  setCommissionRangePreset('custom');
                  setCommissionRangeModalVisible(false);
                  setCommissionRangePickerField(null);
                }}
                activeOpacity={0.86}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{t('dashboard.apply', 'Apply')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={routePickerVisible} transparent animationType="fade" onRequestClose={() => setRoutePickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRoutePickerVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("dashboard.chooseRoute", "Choose route")}</Text>
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
                <Text style={styles.routePickName}>{t("dashboard.recommendedToday", "Recommended (today)")}</Text>
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
              <Text style={styles.modalCloseBtnText}>{t("settings.close", "Close")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <PendingBackOfficeReminderModal
        visible={pendingBackOfficeModalVisible}
        orderCount={orderSyncStats.localCompleted}
        syncActive={syncButtonActive}
        onClose={() => {
          pendingBackOfficeDismissedRef.current = true;
          setPendingBackOfficeModalVisible(false);
        }}
        onSyncPress={() => {
          setPendingBackOfficeModalVisible(false);
          void onSync();
        }}
      />

      <Modal
        visible={postLoginSyncModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPostLoginSyncModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPostLoginSyncModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.syncSuccessAccent}>
              <Ionicons name="cloud-done" size={40} color={colors.primary} />
            </View>
            <Text style={styles.syncSuccessTitle}>{postLoginSyncCopy.title}</Text>
            <Text style={styles.syncSuccessSubtitle}>{postLoginSyncCopy.subtitle}</Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setPostLoginSyncModalVisible(false)}
              activeOpacity={0.88}
            >
              <Text style={styles.modalCloseBtnText}>{postLoginSyncCopy.button}</Text>
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
                  <Text style={styles.modalCloseBtnText}>{t("settings.close", "Close")}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

    </>
  );
}

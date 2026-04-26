import { useTranslation } from 'react-i18next';
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedOrders,
  getCachedCustomers,
  getCachedJournals,
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import { mergePickingStateBySaleIdFromRows, orderIsDeliveryDoneForProgress } from '../utils/deliveryProgress';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as localPaymentsDb from '../database/localPayments.js';
import * as deliveryQtyDb from '../database/deliveryQty.js';
import OrderCard from '../components/OrderCard';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import {
  getCheckoutResumeMap,
  pendingCheckoutSaleOrderIdsFromResumeMap,
} from '../services/checkoutResume.service';

const TAB_CASH = 'cash';
const TAB_CHEQUE = 'cheque';
const TAB_CREDIT = 'credit';
const TAB_ALL = 'all';

function normalizePaymentType(rawType) {
  const t = String(rawType || '').toLowerCase().trim();
  if (t === 'check') return TAB_CHEQUE;
  if (t === TAB_CASH || t === TAB_CHEQUE || t === TAB_CREDIT) return t;
  return '';
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isToday(d) {
  const today = formatDate(new Date());
  return formatDate(d) === today;
}

function lineProductId(line) {
  const raw = Array.isArray(line?.product_id) ? line.product_id[0] : line?.product_id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** Sum a numeric line field per product (e.g. qty_delivered, product_uom_qty). */
function sumQtyByProductFromLines(orderLines, field) {
  const m = {};
  for (const line of orderLines || []) {
    const pid = lineProductId(line);
    if (!Number.isFinite(pid)) continue;
    const q = Number(line?.[field]) || 0;
    if (q <= 0) continue;
    m[pid] = (m[pid] || 0) + q;
  }
  return m;
}

/**
 * Delivered tab badges: prefer stock move qty_done, sale line qty_delivered, and for invoiced
 * orders local line qty (product_uom_qty) so increased / adjusted quantities match the invoice.
 */
function buildDisplayDeliveredQtyByProduct(moveMap, orderLines, isInvoiced) {
  const fromMoves = { ...(moveMap || {}) };
  const fromDeliveredField = sumQtyByProductFromLines(orderLines, 'qty_delivered');
  const fromOrdered = sumQtyByProductFromLines(orderLines, 'product_uom_qty');
  const pids = new Set([
    ...Object.keys(fromMoves),
    ...Object.keys(fromDeliveredField),
    ...(isInvoiced ? Object.keys(fromOrdered) : []),
  ]);
  const out = {};
  for (const k of pids) {
    const p = Number(k);
    const move = Number(fromMoves[p]) || 0;
    const qd = Number(fromDeliveredField[p]) || 0;
    let v = Math.max(move, qd);
    if (isInvoiced) {
      const ord = Number(fromOrdered[p]) || 0;
      v = Math.max(v, ord);
    }
    if (v > 0) out[p] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Categorize by payment amounts: Cash tab / Cheque tab / Credit tab.
 * Primary = tab with highest amount. Tie-break: cheque > cash > credit.
 * Uses stored amounts and payment_type only (no journal name check) so vehicle-specific
 * journals display correctly.
 * @param {Object} paymentSplit - { cash, cheque, credit, cashJournalId?, chequeJournalId? }
 * @param {string} fallbackPaymentType - used when all amounts are zero
 */
function getPrimaryPaymentType(paymentSplit, fallbackPaymentType) {
  const cash = Number(paymentSplit?.cash) || 0;
  const cheque = Number(paymentSplit?.cheque ?? paymentSplit?.check) || 0;
  const credit = Number(paymentSplit?.credit) || 0;
  if (!paymentSplit || (cash === 0 && cheque === 0 && credit === 0)) {
    const t = normalizePaymentType(fallbackPaymentType);
    if (t) return t;
    return TAB_CREDIT;
  }
  const max = Math.max(cash, cheque, credit);
  if (max === 0) return normalizePaymentType(fallbackPaymentType) || TAB_CREDIT;
  if (cheque === max) return TAB_CHEQUE;
  if (cash === max) return TAB_CASH;
  return TAB_CREDIT;
}

export default function DeliveredOrdersScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { colors, syncDateField } = useTheme();
  const insets = useSafeAreaInsets();
  const customerId = route?.params?.customerId ?? null;
  const customerNameFromParams = route?.params?.customerName ?? null;
  const scannedDateParam = route?.params?.scannedDate ?? null;
  const [orders, setOrders] = useState([]);
  const [pickingStateBySaleId, setPickingStateBySaleId] = useState({});
  const [qtyDoneBySaleId, setQtyDoneBySaleId] = useState({});
  const [qtyDoneBySaleAndProduct, setQtyDoneBySaleAndProduct] = useState({});
  const [backendQtyDeliveredOrderIds, setBackendQtyDeliveredOrderIds] = useState(() => new Set());
  const [pendingCheckoutOrderIds, setPendingCheckoutOrderIds] = useState(() => new Set());
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => {
    if (scannedDateParam) {
      const d = new Date(`${scannedDateParam}T12:00:00`);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  });
  const [customerNameForEmpty, setCustomerNameForEmpty] = useState(customerNameFromParams ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState(TAB_ALL);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('customer');
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);

  /**
   * Same rule as dashboard: invoiced, picking done/cancel, move qty_done, or Odoo line qty_delivered (partial delivery).
   */
  const deliveredOrders = useMemo(
    () =>
      orders.filter((o) =>
        orderIsDeliveryDoneForProgress(
          o,
          pickingStateBySaleId,
          qtyDoneBySaleId,
          backendQtyDeliveredOrderIds,
          pendingCheckoutOrderIds
        )
      ),
    [orders, pickingStateBySaleId, qtyDoneBySaleId, backendQtyDeliveredOrderIds, pendingCheckoutOrderIds]
  );

  const searchFieldLabels = {
    customer: t('deliveredorders.searchCustomer', 'Customer'),
    orderId: t('deliveredorders.searchOrderId', 'Order ID'),
  };

  const deliveredOrdersForCustomer = useMemo(() => {
    if (customerId == null) return deliveredOrders;
    return deliveredOrders.filter((o) => o.partner_id?.[0] === customerId);
  }, [deliveredOrders, customerId]);

  /** Stable digest so tab counts / filters refresh when Odoo-synced payment columns change on the same order list. */
  const deliveredPaymentDigest = useMemo(
    () =>
      deliveredOrdersForCustomer
        .map(
          (o) =>
            `${o.id}:${o.amount_cash ?? ''}:${o.amount_cheque ?? ''}:${o.amount_credit ?? ''}:${o.payment_type ?? ''}:${o.paymentSplit ? `${o.paymentSplit.cash}|${o.paymentSplit.cheque}|${o.paymentSplit.credit}` : ''}`
        )
        .join(';'),
    [deliveredOrdersForCustomer]
  );

  /** Each order appears in exactly one tab: by payment amounts (cash / cheque / credit), highest amount wins. */
  const filteredOrders = useMemo(() => {
    const base =
      activeTab === TAB_ALL
        ? deliveredOrdersForCustomer
        : deliveredOrdersForCustomer.filter(
            (o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === activeTab
          );
    return base;
  }, [deliveredOrdersForCustomer, activeTab, deliveredPaymentDigest]);

  const ordersFilteredBySearch = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return filteredOrders;
    return filteredOrders.filter((o) => {
      if (searchField === 'customer') {
        const name = o.partner_id?.[1] ? String(o.partner_id[1]) : '';
        return name.toLowerCase().includes(q);
      }
      if (searchField === 'orderId') {
        const name = o.name ? String(o.name) : '';
        return name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filteredOrders, searchQuery, searchField]);

  const tabCounts = useMemo(
    () => ({
      [TAB_CASH]: deliveredOrdersForCustomer.filter((o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CASH)
        .length,
      [TAB_CHEQUE]: deliveredOrdersForCustomer.filter(
        (o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CHEQUE
      ).length,
      [TAB_CREDIT]: deliveredOrdersForCustomer.filter(
        (o) => getPrimaryPaymentType(o.paymentSplit, o.payment_type) === TAB_CREDIT
      ).length,
      [TAB_ALL]: deliveredOrdersForCustomer.length,
    }),
    [deliveredOrdersForCustomer, deliveredPaymentDigest]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
        },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerLeft: { flex: 1, minWidth: 0 },
        headerBtn: { padding: 4, minWidth: 40, alignItems: 'flex-start' },
        headerCenter: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
        headerRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 },
        countPill: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 10,
          backgroundColor: colors.primary + '18',
          borderWidth: 1,
          borderColor: colors.primary + '40',
        },
        countPillText: { fontSize: 13, fontWeight: '700', color: colors.primary },
        dateNav: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingVertical: 4,
          paddingHorizontal: 8,
        },
        dateNavText: { fontSize: 16, fontWeight: '600', color: colors.text },
        dateNavDateTouch: { paddingVertical: 4, paddingHorizontal: 6 },
        dateNavChevron: { padding: 4 },
        dateNavChevronDisabled: { opacity: 0.35 },
        doneDateBtn: {
          padding: 10,
          alignItems: 'center',
          backgroundColor: colors.surface,
        },
        doneDateText: { fontSize: 16, fontWeight: '600', color: colors.primary },
        tabsWrap: {
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tabsScroll: {
          flexDirection: 'row',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        },
        tab: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.lg,
          backgroundColor: colors.background,
        },
        tabActive: { backgroundColor: colors.primary },
        tabText: { fontSize: 14, fontWeight: '600', color: colors.text },
        tabTextActive: { color: '#fff' },
        tabBadge: {
          minWidth: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
        },
        tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
        tabBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
        tabBadgeTextActive: { color: '#fff' },
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
        customerFilterBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          backgroundColor: colors.primary + '14',
          borderBottomWidth: 1,
          borderBottomColor: colors.primary + '35',
        },
        customerFilterBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
        customerFilterClear: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        customerFilterClearText: { fontSize: 12, fontWeight: '700', color: colors.primary },
        searchRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        },
        searchInput: {
          flex: 1,
          height: 42,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing.md,
          fontSize: 15,
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
        },
        searchFieldBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          height: 42,
          paddingHorizontal: spacing.sm,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 4,
        },
        searchFieldBtnText: { fontSize: 13, fontWeight: '600', color: colors.text, maxWidth: 88 },
        dropdownModal: {
          flex: 1,
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          paddingTop: 168,
          paddingRight: spacing.md,
        },
        dropdownBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
        dropdownMenu: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          minWidth: 160,
        },
        dropdownItem: {
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        dropdownItemText: { fontSize: 15, fontWeight: '500', color: colors.text },
      }),
    [colors, insets.top]
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const [data, cachedCustomers, resumeMap] = await Promise.all([
        getCachedOrders(vehicleId),
        customerId != null ? getCachedCustomers() : Promise.resolve([]),
        getCheckoutResumeMap(),
      ]);
      setPendingCheckoutOrderIds(pendingCheckoutSaleOrderIdsFromResumeMap(resumeMap));
      const all = Array.isArray(data) ? data : [];
      const dateStr = formatDate(selectedDate);
      let list = all.filter((o) => {
        const selectedDateValue = syncDateField === 'delivery_date'
          ? (o.commitment_date || o.date_order)
          : (o.date_order || o.commitment_date);
        return String(selectedDateValue || '').startsWith(dateStr);
      });
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
        const partner = Array.isArray(cachedCustomers)
          ? cachedCustomers.find((c) => c.id === customerId)
          : null;
        if (partner?.name) setCustomerNameForEmpty((prev) => prev || partner.name);
      }
      const orderIds = list.map((o) => o.id);
      const [totals, pickings, allLines, paymentSplits, journalsList, qtyMap, qtyByProductMap, backendDeliveredSet] =
        await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
        localPaymentsDb.getPaymentSplitsWithJournalsBySaleOrderIds(orderIds),
        getCachedJournals(),
        orderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds) : Promise.resolve({}),
        orderIds.length ? deliveryQtyDb.getQtyDoneBySaleOrderProductMap(orderIds) : Promise.resolve({}),
        orderIds.length ? saleOrderLinesDb.getSaleOrderIdsWithPositiveQtyDelivered(orderIds) : Promise.resolve(new Set()),
      ]);
      setBackendQtyDeliveredOrderIds(backendDeliveredSet instanceof Set ? backendDeliveredSet : new Set());
      setJournals(Array.isArray(journalsList) ? journalsList : []);
      const saleIdToPickingState = mergePickingStateBySaleIdFromRows(pickings || []);
      const linesByOrderId = {};
      (allLines || []).forEach((line) => {
        const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
        if (oid != null) {
          if (!linesByOrderId[oid]) linesByOrderId[oid] = [];
          linesByOrderId[oid].push(line);
        }
      });
      const getSplit = (order) => {
        const id = order?.id;
        if (id == null) return null;
        return paymentSplits[Number(id)] ?? paymentSplits[id] ?? paymentSplits[String(id)] ?? null;
      };
      // Backend sync can store amount_cash, amount_cheque, amount_credit (split); else use local split or payment_type + amount_total
      const syntheticSplit = (o) => {
        const split = getSplit(o);
        if (split && (Number(split.cash) || Number(split.cheque ?? split.check) || Number(split.credit))) {
          return {
            cash: Number(split.cash) || 0,
            cheque: Number(split.cheque ?? split.check) || 0,
            credit: Number(split.credit) || 0,
          };
        }
        const sc = Number(o.amount_cash) || 0;
        const sq = Number(o.amount_cheque) || 0;
        const sr = Number(o.amount_credit) || 0;
        if (sc > 0 || sq > 0 || sr > 0)
          return { cash: sc, cheque: sq, credit: sr };
        const pt = normalizePaymentType(o.payment_type);
        const amt = Number(o.amount_total) || 0;
        if (amt <= 0 || !pt) return split || null;
        return {
          cash: pt === 'cash' ? amt : 0,
          cheque: pt === 'cheque' ? amt : 0,
          credit: pt === 'credit' ? amt : 0,
        };
      };
      setPickingStateBySaleId(saleIdToPickingState);
      setQtyDoneBySaleId(qtyMap || {});
      const mergedQtyBySaleAndProduct = {};
      for (const o of list) {
        const oid = o.id;
        const lines = linesByOrderId[oid] || [];
        const moveMap = qtyByProductMap[oid] || {};
        const inv = String(o.invoice_status || '').toLowerCase() === 'invoiced';
        const merged = buildDisplayDeliveredQtyByProduct(moveMap, lines, inv);
        if (merged != null) mergedQtyBySaleAndProduct[oid] = merged;
      }
      setQtyDoneBySaleAndProduct(mergedQtyBySaleAndProduct);
      setOrders(
        list.map((o) => {
          const inv = String(o.invoice_status).toLowerCase() === 'invoiced';
          const st = String(saleIdToPickingState[o.id] || '').toLowerCase();
          const q = Number(qtyMap[o.id]) || 0;
          const deliveryDone = inv || st === 'done' || st === 'cancel' || q > 0;
          return {
            ...o,
            totalQty: totals[o.id] != null ? totals[o.id] : null,
            isDelivered: deliveryDone,
            orderLines: linesByOrderId[o.id] || [],
            paymentSplit: syntheticSplit(o) || null,
          };
        })
      );
    } catch (err) {
      console.error('Delivered Orders Error:', err);
      setOrders([]);
      setPickingStateBySaleId({});
      setQtyDoneBySaleId({});
      setQtyDoneBySaleAndProduct({});
      setBackendQtyDeliveredOrderIds(new Set());
      setPendingCheckoutOrderIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [selectedDate, syncDateField, customerId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (customerNameFromParams) setCustomerNameForEmpty((prev) => prev || customerNameFromParams);
  }, [customerNameFromParams]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadOrders);
    return () => unsub?.();
  }, [loadOrders, navigation]);

  const canGoToNextDay = !isToday(selectedDate);

  const goToPreviousDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };

  const goToNextDay = () => {
    if (!canGoToNextDay) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
  };

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) setSelectedDate(date);
  };

  const onBackPress = () => {
    if (customerId != null) {
      navigation.navigate('DeliveredOrders', {
        customerId: null,
        customerName: null,
        scannedDate: null,
      });
    } else {
      navigation.navigate('Dashboard');
    }
  };

  const onOrderPress = (order) => {
    navigation.navigate('InvoiceScreen', {
      saleOrderId: order.id,
      invoiceNumber: order?.invoice_number || null,
      total: order.amount_total,
      skipEvidenceModal: true,
      promptSignatures: false,
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
    >
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onBackPress} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <View style={styles.dateNav}>
            <TouchableOpacity onPress={goToPreviousDay} style={styles.dateNavChevron} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateNavDateTouch} onPress={() => setShowPicker(true)} activeOpacity={0.7}>
              <Text style={styles.dateNavText}>{formatDate(selectedDate)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goToNextDay}
              disabled={!canGoToNextDay}
              style={[styles.dateNavChevron, !canGoToNextDay && styles.dateNavChevronDisabled]}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.headerRight, { flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }]}>
          <SyncHeaderBadge variant="surface" />
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{ordersFilteredBySearch.length}</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('ScanQRCode', {
                returnTo: 'DeliveredOrders',
                scanContext: 'delivered',
              })
            }
            style={[styles.headerBtn, { alignItems: 'flex-end' }]}
            accessibilityLabel="Scan customer QR to filter delivered orders"
          >
            <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
          </TouchableOpacity>
        </View>
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
        <TouchableOpacity style={styles.doneDateBtn} onPress={() => setShowPicker(false)}>
          <Text style={styles.doneDateText}>{t('deliveredorders.done', 'Done')}</Text>
        </TouchableOpacity>
      )}

      {customerId != null ? (
        <View style={styles.customerFilterBanner}>
          <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
          <Text style={styles.customerFilterBannerText} numberOfLines={2}>
            {t('deliveredorders.deliveriesForCustomer', 'Deliveries for {{customer}} · change date above if needed', {
              customer: customerNameForEmpty || t('deliveredorders.thisCustomer', 'this customer'),
            })}
          </Text>
          <TouchableOpacity
            style={styles.customerFilterClear}
            onPress={() =>
              navigation.navigate('DeliveredOrders', {
                customerId: null,
                customerName: null,
                scannedDate: null,
              })
            }
            activeOpacity={0.85}
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.customerFilterClearText}>{t('deliveredorders.clear', 'Clear')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={20} color={colors.textSecondary} style={{ opacity: 0.85 }} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('deliveredorders.searchPlaceholder', 'Search {{field}}…', {
            field: String(searchFieldLabels[searchField] || t('deliveredorders.customerName', 'Customer name')).toLowerCase(),
          })}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
        />
        <TouchableOpacity
          style={styles.searchFieldBtn}
          onPress={() => setShowFieldDropdown(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchFieldBtnText} numberOfLines={1}>
            {searchFieldLabels[searchField] || t('deliveredorders.field', 'Field')}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={showFieldDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFieldDropdown(false)}
      >
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowFieldDropdown(false)}>
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownMenu}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setSearchField('customer');
                  setShowFieldDropdown(false);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('deliveredorders.customerName', 'Customer name')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setSearchField('orderId');
                  setShowFieldDropdown(false);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('deliveredorders.orderID', 'Order ID')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <View style={styles.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScroll}
        >
           <TouchableOpacity
            style={[styles.tab, activeTab === TAB_ALL && styles.tabActive]}
            onPress={() => setActiveTab(TAB_ALL)}
            activeOpacity={0.8}
          >
            <Ionicons name="list-outline" size={18} color={activeTab === TAB_ALL ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_ALL && styles.tabTextActive]}>{t('deliveredorders.all', 'All')}</Text>
            <View style={[styles.tabBadge, activeTab === TAB_ALL && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_ALL && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_ALL]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CASH && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CASH)}
            activeOpacity={0.8}
          >
            <Ionicons name="cash-outline" size={18} color={activeTab === TAB_CASH ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CASH && styles.tabTextActive]}>{t('deliveredorders.cash', 'Cash')}</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CASH && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CASH && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CASH]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CHEQUE && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CHEQUE)}
            activeOpacity={0.8}
          >
            <Ionicons name="card-outline" size={18} color={activeTab === TAB_CHEQUE ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CHEQUE && styles.tabTextActive]}>{t('deliveredorders.cheque', 'Cheque')}</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CHEQUE && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CHEQUE && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CHEQUE]}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_CREDIT && styles.tabActive]}
            onPress={() => setActiveTab(TAB_CREDIT)}
            activeOpacity={0.8}
          >
            <Ionicons name="wallet-outline" size={18} color={activeTab === TAB_CREDIT ? '#fff' : colors.text} />
            <Text style={[styles.tabText, activeTab === TAB_CREDIT && styles.tabTextActive]}>{t('deliveredorders.credit', 'Credit')}</Text>
            <View style={[styles.tabBadge, activeTab === TAB_CREDIT && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === TAB_CREDIT && styles.tabBadgeTextActive]}>
                {tabCounts[TAB_CREDIT]}
              </Text>
            </View>
          </TouchableOpacity>   
        </ScrollView>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={ordersFilteredBySearch}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name={activeTab === TAB_ALL ? 'checkmark-done-outline' : activeTab === TAB_CASH ? 'cash-outline' : activeTab === TAB_CHEQUE ? 'card-outline' : 'wallet-outline'}
              size={48}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyText}>
              {searchQuery.trim()
                ? t('deliveredorders.noDeliveredOrdersMatchYourSearch', 'No delivered orders match your search')
                : activeTab === TAB_ALL
                  ? customerId != null
                    ? t('deliveredorders.noDeliveredOrdersForCustomerOnThisDate', 'No delivered orders for {{customer}} on this date', {
                        customer: customerNameForEmpty || t('deliveredorders.thisCustomer', 'this customer'),
                      })
                    : t('deliveredorders.noDeliveredOrdersForThisDate', 'No delivered orders for this date')
                  : t('deliveredorders.noDeliveredOrdersPaidByForThisDate', 'No delivered orders paid by {{payment}} for this date', {
                      payment: activeTab === TAB_CASH ? t('deliveredorders.cash', 'Cash') : activeTab === TAB_CHEQUE ? t('deliveredorders.cheque', 'Cheque') : t('deliveredorders.credit', 'Credit'),
                    })}
            </Text>
            <Text style={styles.emptyHint}>
              {searchQuery.trim()
                ? t('deliveredorders.tryAnotherWordOrClearSearch', 'Try another word or clear search.')
                : customerId != null
                  ? t('deliveredorders.tryAnotherDateOrClearCustomerFilter', 'Try another date or clear the customer filter.')
                  : t('deliveredorders.paidDeliveriesShowHereAfterYouCompletePayment', 'Paid deliveries show here after you complete payment.')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            orderLines={item.orderLines}
            onPress={onOrderPress}
            isDelivered={true}
            paymentSplit={item.paymentSplit}
            qtyDoneByProductId={qtyDoneBySaleAndProduct[item.id] || null}
          />
        )}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

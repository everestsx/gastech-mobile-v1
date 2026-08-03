import { useTranslation } from 'react-i18next';
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  Alert,
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
  getOrderLineTotalsFromDB,
  getOrderLinesByOrderIdsFromDB,
  getPickingsBySaleIdsFromDB,
  getUserSession,
} from '../services/sync.service';
import {
  getStoredCancellationReasonsForUI,
  refreshCancellationReasonsCache,
} from '../services/saleOrder.service';
import { cancelSaleOrderOfflineFirst } from '../utils/orderCancel.js';
import OrderCard from '../components/OrderCard';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as deliveryQtyDb from '../database/deliveryQty.js';
import * as localPaymentsDb from '../database/localPayments.js';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import { getCheckoutResumeMap, pruneStaleCheckoutResumeEntries } from '../services/checkoutResume.service';
import { useSync } from '../context/SyncContext';
import { isSaleOrderDeliveredInUi, subscribeUiDeliveredOrders } from '../utils/completedOrderUi';

const TAB_TO_DELIVER = 'to_deliver';

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

/** Keeps last Orders tab list visible instantly when switching tabs (UI cache only). */
let lastSaleOrdersListSnapshot = null;

export default function SaleOrderListScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { colors, syncDateField } = useTheme();
  const insets = useSafeAreaInsets();
  const customerId = route?.params?.customerId ?? null;
  const customerNameFromParams = route?.params?.customerName ?? null;
  const scannedDateParam = route?.params?.scannedDate ?? null;
  const [orders, setOrders] = useState(() => lastSaleOrdersListSnapshot?.orders ?? []);
  const [selectedDate, setSelectedDate] = useState(() => {
    if (scannedDateParam) {
      const d = new Date(scannedDateParam + 'T12:00:00');
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  });
  const [customerNameForEmpty, setCustomerNameForEmpty] = useState(customerNameFromParams ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('customer');
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const [checkoutResumeMap, setCheckoutResumeMap] = useState(
    () => lastSaleOrdersListSnapshot?.checkoutResumeMap ?? {}
  );
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTargetOrder, setCancelTargetOrder] = useState(null);
  const [cancelReasons, setCancelReasons] = useState([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonsLoading, setCancelReasonsLoading] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const [listLoading, setListLoading] = useState(() => !lastSaleOrdersListSnapshot?.orders?.length);
  const { syncCompleteTimestamp } = useSync();
  const [uiDeliveredTick, setUiDeliveredTick] = useState(0);

  useEffect(() => subscribeUiDeliveredOrders(() => setUiDeliveredTick((n) => n + 1)), []);

  // Orders tab: hide once invoiced or delivered — unless checkout (invoice / payment photo) is still in progress.
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (isSaleOrderDeliveredInUi(Number(o.id))) return false;
        if (String(o.state || '') === 'cancel') return false;
        const rid = String(o.id);
        const resumeEntry = checkoutResumeMap[rid];
        if (resumeEntry?.invoiceParams || resumeEntry?.phase === 'payment') return true;
        const inv = String(o.invoice_status || '').toLowerCase() === 'invoiced';
        const st = String(o.pickingState || '').toLowerCase();
        // Do not treat qty_done > 0 as delivered before explicit completion.
        return !(inv || st === 'done' || st === 'cancel');
      }),
    [orders, checkoutResumeMap, uiDeliveredTick]
  );
  const searchFieldLabels = { customer: 'Customer', orderId: 'Order ID' };
  const ordersFilteredBySearch = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return filteredOrders;
    return filteredOrders.filter((o) => {
      if (searchField === 'customer') {
        const name = (o.partner_id && o.partner_id[1]) ? String(o.partner_id[1]) : '';
        return name.toLowerCase().includes(q);
      }
      if (searchField === 'orderId') {
        const name = o.name ? String(o.name) : '';
        return name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filteredOrders, searchQuery, searchField]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
        },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        loadingOverlay: {
          ...StyleSheet.absoluteFillObject,
          alignItems: 'center',
          justifyContent: 'center',
        },
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
        headerLeft: {
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
        },
        headerCenter: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        },
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
        headerRight: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          minWidth: 0,
          gap: spacing.sm,
        },
        headerBtn: { padding: 4, minWidth: 40, alignItems: 'flex-start' },
        headerBtnRight: { alignItems: 'flex-end' },
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
        list: { padding: spacing.md, paddingBottom: 140 },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
        emptyText: { fontSize: 16, color: colors.textSecondary, marginTop: 12 },
        emptyHint: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
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
          height: 40,
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
          height: 40,
          paddingHorizontal: spacing.sm,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 4,
        },
        searchFieldBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
        dropdownModal: {
          flex: 1,
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          paddingTop: 100,
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
          minWidth: 140,
        },
        dropdownItem: {
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        dropdownItemText: { fontSize: 15, fontWeight: '500', color: colors.text },
        cancelConfirmBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
        },
        cancelConfirmCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          alignItems: 'center',
          gap: 12,
        },
        cancelConfirmIconWrap: {
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: `${colors.error || '#dc2626'}18`,
          alignItems: 'center',
          justifyContent: 'center',
        },
        cancelConfirmTitle: {
          fontSize: 18,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
        },
        cancelConfirmMessage: {
          fontSize: 14,
          lineHeight: 20,
          color: colors.textSecondary,
          textAlign: 'center',
        },
        cancelConfirmOrderLabel: {
          fontSize: 13,
          fontWeight: '700',
          color: colors.text,
          textAlign: 'center',
        },
        cancelConfirmActions: {
          flexDirection: 'row',
          gap: 10,
          marginTop: 4,
          alignSelf: 'stretch',
        },
        cancelConfirmBtn: {
          flex: 1,
          minHeight: 44,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
        },
        cancelConfirmBtnSecondary: {
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
        },
        cancelConfirmBtnPrimary: {
          backgroundColor: colors.error || '#dc2626',
        },
        cancelConfirmBtnTextSecondary: {
          fontSize: 14,
          fontWeight: '700',
          color: colors.text,
        },
        cancelConfirmBtnTextPrimary: {
          fontSize: 14,
          fontWeight: '700',
          color: '#fff',
        },
        cancelModalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          justifyContent: 'flex-end',
        },
        cancelModalContent: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.md),
        },
        cancelModalHeaderIcon: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${colors.primary}18`,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.sm,
        },
        cancelModalTitle: {
          fontSize: 18,
          fontWeight: '800',
          color: colors.text,
        },
        cancelModalHint: {
          fontSize: 13,
          lineHeight: 18,
          color: colors.textSecondary,
          marginTop: 6,
        },
        cancelModalBody: {
          marginTop: spacing.md,
        },
        cancelReasonList: {
          gap: 8,
        },
        cancelReasonItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          gap: 10,
        },
        cancelReasonItemSelected: {
          borderColor: colors.primary,
          backgroundColor: colors.primary + '12',
        },
        cancelReasonRadio: {
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        cancelReasonRadioSelected: {
          borderColor: colors.primary,
        },
        cancelReasonRadioInner: {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.primary,
        },
        cancelReasonText: {
          flex: 1,
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
        },
        cancelModalActions: {
          flexDirection: 'row',
          gap: 10,
          marginTop: spacing.lg,
        },
        cancelModalBtn: {
          flex: 1,
          minHeight: 44,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
        },
        cancelModalBtnSecondary: {
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
        },
        cancelModalBtnPrimary: {
          backgroundColor: colors.error || '#dc2626',
        },
        cancelModalBtnTextSecondary: {
          fontSize: 14,
          fontWeight: '700',
          color: colors.text,
        },
        cancelModalBtnTextPrimary: {
          fontSize: 14,
          fontWeight: '700',
          color: '#fff',
        },
      }),
    [colors, insets]
  );

  const loadOrders = useCallback(async () => {
    setListLoading(true);
    try {
      const user = await getUserSession();
      const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
      const [data, cachedCustomers] = await Promise.all([
        getCachedOrders(vehicleId),
        customerId != null ? getCachedCustomers() : Promise.resolve([]),
      ]);
      await pruneStaleCheckoutResumeEntries();
      const resumeMap = await getCheckoutResumeMap();
      setCheckoutResumeMap(resumeMap && typeof resumeMap === 'object' ? resumeMap : {});
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
      const resumeForSort = resumeMap && typeof resumeMap === 'object' ? resumeMap : {};
      const [totals, pickings, allLines, qtyDoneMap, paymentSplits, attachCounts, pendingUploadSet] =
        await Promise.all([
        getOrderLineTotalsFromDB(list),
        getPickingsBySaleIdsFromDB(orderIds),
        getOrderLinesByOrderIdsFromDB(orderIds),
        orderIds.length ? deliveryQtyDb.getTotalQtyDoneBySaleOrderIds(orderIds) : Promise.resolve({}),
        orderIds.length ? localPaymentsDb.getPaymentSplitsBySaleOrderIds(orderIds) : Promise.resolve({}),
        orderIds.length ? offlineAttachmentsDb.getAttachmentCountsBySaleOrderIds(orderIds) : Promise.resolve({}),
        orderIds.length
          ? offlineAttachmentsDb.getSaleOrderIdsWithPendingAttachmentUploads()
          : Promise.resolve(new Set()),
      ]);
      const listPriority = (o) => {
        const id = Number(o.id);
        const rid = String(id);
        const entry = resumeForSort[rid];
        if (entry?.phase === 'payment_proof') return 0;
        if (entry?.phase === 'payment') return 1;
        if (entry?.phase === 'invoice') return 2;
        const split = paymentSplits[id] ?? paymentSplits[String(id)];
        const cred = Number(split?.credit) || 0;
        const att = Number(attachCounts[id] ?? attachCounts[String(id)] ?? 0) || 0;
        if (cred > 0 && att === 0) return 3;
        if (pendingUploadSet.has(id)) return 4;
        return 10;
      };
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
      const enriched = list.map((o) => ({
        ...o,
        totalQty: totals[o.id] != null ? totals[o.id] : null,
        pickingState: saleIdToPickingState[o.id] ?? '',
        qtyDoneSum: Number(qtyDoneMap?.[o.id]) || 0,
        isDelivered: saleIdToPickingState[o.id] === 'done',
        orderLines: linesByOrderId[o.id] || [],
      }));
      enriched.sort((a, b) => {
        const d = listPriority(a) - listPriority(b);
        if (d !== 0) return d;
        const ra = resumeForSort[String(a.id)];
        const rb = resumeForSort[String(b.id)];
        const hasA = Boolean(ra?.invoiceParams || ra?.phase === 'payment');
        const hasB = Boolean(rb?.invoiceParams || rb?.phase === 'payment');
        if (hasA && hasB) {
          const ta = Number(ra.updatedAt) || 0;
          const tb = Number(rb.updatedAt) || 0;
          if (ta !== tb) return tb - ta;
        } else if (hasA !== hasB) {
          return hasA ? -1 : 1;
        }
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      setOrders(enriched);
      lastSaleOrdersListSnapshot = {
        orders: enriched,
        checkoutResumeMap: resumeMap && typeof resumeMap === 'object' ? resumeMap : {},
      };
    } catch (err) {
      console.error('Sale Order Error:', err);
      setOrders([]);
      setCheckoutResumeMap({});
    } finally {
      setListLoading(false);
    }
  }, [customerId, selectedDate, syncDateField]);

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

  useEffect(() => {
    if (syncCompleteTimestamp > 0) loadOrders();
  }, [syncCompleteTimestamp, loadOrders]);

  useEffect(() => {
    if (!showCancelModal) return undefined;
    let active = true;
    const loadReasons = async () => {
      setCancelReasonsLoading(true);
      setCancelError(null);
      try {
        const stored = await getStoredCancellationReasonsForUI();
        if (!active) return;
        setCancelReasons(stored);
        setCancelReason((prev) => prev || stored[0]?.value || '');
        if (stored.length === 0) {
          void refreshCancellationReasonsCache().then((fresh) => {
            if (!active || !Array.isArray(fresh) || fresh.length === 0) return;
            setCancelReasons(fresh);
            setCancelReason((prev) => prev || fresh[0]?.value || '');
          });
        }
      } catch (_) {
        if (!active) return;
        setCancelReasons([]);
      } finally {
        if (active) setCancelReasonsLoading(false);
      }
    };
    loadReasons();
    return () => {
      active = false;
    };
  }, [showCancelModal]);

  /** Exact Odoo reasons from SQLite only (loaded on last sync/login). */
  const effectiveCancelReasons = cancelReasons;

  const closeCancelFlow = useCallback(() => {
    setShowCancelConfirmModal(false);
    setShowCancelModal(false);
    setCancelTargetOrder(null);
    setCancelReason('');
    setCancelError(null);
    setCancelReasons([]);
    setCancelReasonsLoading(false);
    setCanceling(false);
  }, []);

  const handleOpenCancelFlow = useCallback((order) => {
    if (!order?.id) return;
    if (String(order?.state || '') === 'cancel') return;
    setCancelTargetOrder(order);
    setCancelError(null);
    setShowCancelConfirmModal(true);
  }, []);

  const openCancelReasonModal = useCallback(() => {
    setShowCancelConfirmModal(false);
    setCancelError(null);
    setShowCancelModal(true);
  }, []);

  const handleCancelOrder = useCallback(async () => {
    if (!cancelTargetOrder?.id || canceling || String(cancelTargetOrder?.state || '') === 'cancel') return;
    if (!cancelReason) {
      Alert.alert(
        t('saleorder.reasonNeededTitle', 'Reason needed'),
        t('saleorder.reasonNeededMessage', 'Pick a cancel reason from the list.')
      );
      return;
    }

    setCancelError(null);
    setCanceling(true);
    try {
      await cancelSaleOrderOfflineFirst(cancelTargetOrder.id, cancelReason);
      closeCancelFlow();
      await loadOrders();
      Alert.alert(
        t('saleorder.cancelSavedTitle', 'Order cancelled'),
        t(
          'saleorder.cancelSavedMessage',
          'Cancelled on this device. It will sync to the back office automatically when you are online.'
        )
      );
    } catch (err) {
      const msg = err?.message ?? t('saleorder.cancelFailedTryAgain', 'Cancel failed. Try again.');
      setCancelError(msg);
      await loadOrders();
    } finally {
      setCanceling(false);
    }
  }, [cancelReason, canceling, cancelTargetOrder, closeCancelFlow, loadOrders, t]);

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
      navigation.navigate('Orders', { customerId: null });
    } else {
      navigation.navigate('Dashboard');
    }
  };

  const onOrderPress = (order) => {
    // Pending checkout: open order details (modify / proceed) — not straight to invoice; banner can resume invoice/proof.
    navigation.navigate('SaleOrderDetails', { saleOrderId: order.id });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
    >
    <View style={{ flex: 1 }}>
      {/* Header: back (to Dashboard), date navigator (center, tap = calendar), QR (right) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onBackPress} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <View style={styles.dateNav}>
            <TouchableOpacity
              onPress={goToPreviousDay}
              style={styles.dateNavChevron}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dateNavDateTouch}
              onPress={() => setShowPicker(true)}
              activeOpacity={0.7}
            >
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
            <Text style={styles.countPillText}>
              {ordersFilteredBySearch.length}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('ScanQRCode')}
            style={[styles.headerBtn, styles.headerBtnRight]}
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
          <Text style={styles.doneDateText}>{t('saleorderlist.done', 'Done')}</Text>
        </TouchableOpacity>
      )}

      {/* Search: input (left) + field selector dropdown (right) */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={`Search by ${searchFieldLabels[searchField]?.toLowerCase() || 'customer'}…`}
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
            {searchFieldLabels[searchField] || 'Field'}
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
                onPress={() => { setSearchField('customer'); setShowFieldDropdown(false); }}
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('saleorderlist.customerName', 'Customer name')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => { setSearchField('orderId'); setShowFieldDropdown(false); }}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.dropdownItemText}>{t('saleorderlist.orderID', 'Order ID')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

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
            <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              {searchQuery.trim()
                ? 'No orders match your search'
                : customerId != null
                  ? `No orders for ${customerNameForEmpty || 'this customer'} on this date.`
                  : 'No orders to deliver'}
            </Text>
            <Text style={styles.emptyHint}>
              {searchQuery.trim()
                ? 'Try another search or clear the box.'
                : customerId != null
                  ? 'Sync or pick another date.'
                  : 'Sync to load orders for this date.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            orderLines={item.orderLines}
            onPress={onOrderPress}
            onCancelPress={handleOpenCancelFlow}
            isDelivered={false}
            checkoutResumePhase={checkoutResumeMap[String(item.id)]?.phase ?? null}
          />
        )}
      />
      {listLoading ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      <Modal
        visible={showCancelConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={closeCancelFlow}
      >
        <Pressable
          style={styles.cancelConfirmBackdrop}
          onPress={closeCancelFlow}
        >
          <Pressable style={styles.cancelConfirmCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.cancelConfirmIconWrap}>
              <Ionicons name="warning-outline" size={28} color={colors.error || '#dc2626'} />
            </View>
            <Text style={styles.cancelConfirmTitle}>{t('saleorder.cancelThisOrder', 'Cancel this order?')}</Text>
            <Text style={styles.cancelConfirmMessage}>
              {t(
                'saleorder.cancelWarningMessage',
                "The order will be closed and taken off your delivery list. You can't undo this step."
              )}
            </Text>
            {cancelTargetOrder?.name ? (
              <Text style={styles.cancelConfirmOrderLabel} numberOfLines={1}>
                {cancelTargetOrder.name}
              </Text>
            ) : null}
            <View style={styles.cancelConfirmActions}>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, styles.cancelConfirmBtnSecondary]}
                onPress={closeCancelFlow}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelConfirmBtnTextSecondary}>{t('saleorder.keepOrder', 'Keep order')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, styles.cancelConfirmBtnPrimary]}
                onPress={openCancelReasonModal}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelConfirmBtnTextPrimary}>{t('saleorder.continue', 'Continue')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showCancelModal}
        transparent
        animationType="slide"
        onRequestClose={closeCancelFlow}
      >
        <Pressable style={styles.cancelModalOverlay} onPress={closeCancelFlow}>
          <Pressable style={styles.cancelModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.cancelModalHeaderIcon}>
              <Ionicons name="clipboard-outline" size={22} color={colors.primary} />
            </View>
            <Text style={styles.cancelModalTitle}>{t('saleorder.reasonForCancellation', 'Reason for cancellation')}</Text>
            <Text style={styles.cancelModalHint}>
              {t(
                'saleorder.reasonForCancellationHint',
                'Tap the reason that fits best. The order will be closed and removed from your list.'
              )}
            </Text>

            <View style={styles.cancelModalBody}>
              {cancelReasonsLoading ? (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ marginTop: 8, color: colors.textSecondary }}>
                    {t('saleorder.loadingReasons', 'Loading reasons…')}
                  </Text>
                </View>
              ) : effectiveCancelReasons.length === 0 ? (
                <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, paddingVertical: spacing.sm }}>
                  {t(
                    'saleorder.noCancelReasonsCached',
                    'Cancel reasons are not loaded yet. Connect to the internet and run Sync once, then try again.'
                  )}
                </Text>
              ) : (
                <ScrollView
                  style={{ maxHeight: 300 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.cancelReasonList}>
                    {effectiveCancelReasons.map((item) => (
                      <TouchableOpacity
                        key={item.value}
                        style={[
                          styles.cancelReasonItem,
                          cancelReason === item.value && styles.cancelReasonItemSelected,
                        ]}
                        onPress={() => setCancelReason(item.value)}
                        activeOpacity={0.8}
                      >
                        <View style={[
                          styles.cancelReasonRadio,
                          cancelReason === item.value && styles.cancelReasonRadioSelected,
                        ]}>
                          {cancelReason === item.value && <View style={styles.cancelReasonRadioInner} />}
                        </View>
                        <Text style={styles.cancelReasonText}>{item.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}

              {cancelError ? (
                <Text style={{ marginTop: spacing.sm, color: colors.error || '#c00', fontSize: 13 }}>
                  {cancelError}
                </Text>
              ) : null}
            </View>

            <View style={styles.cancelModalActions}>
              <TouchableOpacity
                style={[styles.cancelModalBtn, styles.cancelModalBtnSecondary]}
                onPress={closeCancelFlow}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelModalBtnTextSecondary}>{t('saleorder.keepOrder', 'Keep order')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelModalBtn, styles.cancelModalBtnPrimary]}
                onPress={handleCancelOrder}
                disabled={canceling || effectiveCancelReasons.length === 0 || !cancelReason}
                activeOpacity={0.8}
              >
                {canceling ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.cancelModalBtnTextPrimary}>{t('saleorder.cancelOrder', 'Cancel order')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

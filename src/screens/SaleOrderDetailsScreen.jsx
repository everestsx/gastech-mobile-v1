import { useTranslation } from 'react-i18next';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  Alert,
  Pressable,
  Keyboard,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getSaleOrderDetailsFromDB, getCachedVehicleInventoryByLocation, getVehicleLocationId, getDeliveryDataFromDB } from '../services/sync.service';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as stockMoveLinesDb from '../database/stockMoveLines.js';
import * as stockMovesDb from '../database/stockMoves.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as productsDb from '../database/products.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import {
  getStoredCancellationReasonsForUI,
  refreshCancellationReasonsCache,
} from '../services/saleOrder.service';
import { cancelSaleOrderOfflineFirst } from '../utils/orderCancel.js';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getProductDisplayName, getGasSizeFromProductName } from '../utils/productDisplay';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import { getProductImageSource } from '../utils/gasImage';
import { isNewIssueName } from '../utils/cylinderCatalog';
import { lineTaxAtQuantity } from '../utils/orderLineTax.js';
import { getCheckoutResumeEntry } from '../services/checkoutResume.service';
import { mergeInventoryQueueKeepingEmpty } from '../utils/emptyCollectionLocal.js';
import { getSaleOrderDetailsUiCache, setSaleOrderDetailsUiCache } from '../utils/saleOrderDetailsUiCache';
import { linesAfterDemandEditSave, orderAmountsFromLines } from '../utils/saleOrderLinePricing';

function formatCurrency(amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return 'Rs 0.00';

    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `Rs ${parts.join('.')}`;
}
/** Format number with space as thousands separator (e.g. 12 000). */
// function formatWithSpace(amount) {
//   const n = Number(amount);
//   if (Number.isNaN(n)) return '0';
//   const [int, dec] = n.toFixed(2).split('.');
//   const withSpaces = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
//   return dec === '00' ? withSpaces : `${withSpaces}.${dec}`;
// }
function formatWithComma(amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) return '0.00';
    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

/** Odoo can return negative reserved qty; UI and caps use non‑negative stock only. */
function clampNonNegativeStock(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, x);
}
export default function SaleOrderDetailsScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { colors, appLanguage } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const GAS_SIZE_COLORS = useMemo(
    () => ({
      small: colors.success ?? '#059669',
      medium: colors.primary ?? '#4f46e5',
      large: colors.warning ?? '#d97706',
      big: colors.secondary ?? '#4338ca',
    }),
    [colors]
  );
  const FALLBACK_ACCENT = colors.primaryLight ?? colors.primary ?? '#818cf8';
  const { saleOrderId } = route.params;
  const cachedDetails = getSaleOrderDetailsUiCache(saleOrderId);

  const [order, setOrder] = useState(cachedDetails?.order ?? null);
  const [lines, setLines] = useState(cachedDetails?.lines ?? []);
  const [isDelivered, setIsDelivered] = useState(cachedDetails?.isDelivered ?? false);
  // True when the picking/delivery is already validated ("done") locally.
  // In that case, lorry stock has already been deducted once, so we should
  // allow editing delivered quantity even if remaining stock is 0.
  const [isDeliveryDone, setIsDeliveryDone] = useState(cachedDetails?.isDeliveryDone ?? false);
  const [modifyEnabled, setModifyEnabled] = useState(false);
  const [qtyChanged, setQtyChanged] = useState(false);
  const [loading, setLoading] = useState(!cachedDetails?.order);
  const [updating, setUpdating] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [productIdToAvailable, setProductIdToAvailable] = useState(cachedDetails?.productIdToAvailable ?? {});
  const [productIdToOnHand, setProductIdToOnHand] = useState(cachedDetails?.productIdToOnHand ?? {});
  const [productIdToImageUri, setProductIdToImageUri] = useState(cachedDetails?.productIdToImageUri ?? {});
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReasons, setCancelReasons] = useState([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonsLoading, setCancelReasonsLoading] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [checkoutResumeEntry, setCheckoutResumeEntry] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const e = await getCheckoutResumeEntry(saleOrderId);
          if (!alive) return;
          setCheckoutResumeEntry(e && e.invoiceParams ? e : null);
        } catch {
          if (!alive) return;
          setCheckoutResumeEntry(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, [saleOrderId])
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
          stockWarningText: {
            fontSize: 12,
            color: colors.error || '#c00',
            marginTop: 4,
            fontWeight: '600'
          },
        container: { flex: 1, backgroundColor: colors.background },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
        scroll: { flex: 1 },
        scrollContent: { padding: spacing.md, paddingBottom: Math.max(24, insets.bottom + 220) },
        errorText: { fontSize: 16, color: colors.textSecondary },
        customerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, paddingVertical: 4 },
        customerLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
        customerName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
        modifyUpdateBtn: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.primary,
        },
        modifyUpdateBtnUpdate: { backgroundColor: colors.warning, borderColor: colors.warning },
        modifyUpdateBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
        modifyUpdateBtnTextUpdate: { color: '#fff' },
        changedBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.surface,
          borderLeftWidth: 4,
          borderLeftColor: colors.warning,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
        },
        changedBannerText: { fontSize: 13, fontWeight: '600', color: colors.warning, flex: 1 },
        sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
        orderLinesHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        },
        emptyLines: { padding: spacing.lg, alignItems: 'center' },
        emptyText: { fontSize: 15, color: colors.textSecondary },
        grossTotalCard: {
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.lg,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        grossRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
        grossTotalRow: { marginTop: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, marginBottom: 0 },
        grossLabel: { fontSize: 14, color: colors.textSecondary },
        grossValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        grossTotalLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
        grossTotalValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
        lineCard: {
          backgroundColor: colors.surface,
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.xs,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          overflow: 'hidden',
        },
        lineCardWithImage: {
          borderTopRightRadius: borderRadius.xl + 8,
          borderBottomRightRadius: borderRadius.xl + 8,
        },
        lineCardInnerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        },
        lineCardLeft: { flex: 1, minWidth: 0 },
        lineCardImageWrap: {
          width: 64,
          height: 64,
          borderRadius: 32,
          overflow: 'hidden',
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 3,
          justifyContent: 'center',
          alignItems: 'center',
        },
        lineCardImage: {
          width: 48,
          height: 48,
          resizeMode: 'contain',
          alignSelf: 'center',
          justifyContent: 'center',
          alignItems: 'center',
        },
        lineProductName: { fontSize: 14, fontWeight: '700', color: colors.primary, marginBottom: 6 },
        lineGasSwatch: { width: 10, height: 10, borderRadius: 2, flexShrink: 0 },
        lineQtyValue: { fontSize: 14, fontWeight: '700', color: colors.text },
        lineNameQtyRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 4,
        },
        lineUnitPriceRow: { marginTop: 2 ,flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopColor: colors.border},
        lineUnitPriceLabel: { fontSize: 12, color: colors.textSecondary },
        lineUnitPriceValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        lineTotalRow: {
          // flexDirection: 'row',
          // justifyContent: 'flex-end',
          // alignItems: 'center',
          // marginTop: 6,
          // paddingTop: 6,
          // borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        lineTotalLabel: { fontSize: 12, color: colors.textSecondary, marginRight: 6 },
        lineTotalValue: { fontSize: 17, fontWeight: '800', color: colors.primary },
        lineOneRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        },
        lineLeftExpr: { fontSize: 15, fontWeight: '600', color: colors.text },
        lineRightTotal: { fontSize: 15, fontWeight: '700', color: colors.primary },
        availableStockRow: { marginTop: 4, width: '90%', flexDirection: 'row', justifyContent: 'flex-end' },
        availableStockText: { fontSize: 14, fontWeight: '400', color: colors.success ?? '#059669' },
        qtyInput: {
          fontSize: 16,
          fontWeight: '700',
          color: colors.text,
          borderWidth: 1.5,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          minWidth: 52,
          width: 52,
          textAlign: 'center',
          backgroundColor: colors.background,
        },
        qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        qtyControlsDisabled: { opacity: 0.7 },
        qtyInputDisabled: { backgroundColor: colors.border + '40', color: colors.textSecondary },
        qtyIconBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        },
        qtyValue: { fontSize: 14, fontWeight: '600', color: colors.text },
        bottomSpacer: { height: 200 + insets.bottom },
        bottomBar: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.surface,
          padding: spacing.md,
          paddingBottom: spacing.md + 8 + insets.bottom,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 6,
        },
        payBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          backgroundColor: colors.primary,
        },
        payBtnDisabled: { backgroundColor: colors.textSecondary, opacity: 0.8 },
        payBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
        bottomActions: {
          gap: spacing.sm,
        },
        cancelBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.error || '#c00',
          backgroundColor: 'transparent',
        },
        cancelBtnDisabled: { opacity: 0.5 },
        cancelBtnText: { fontSize: 15, fontWeight: '700', color: colors.error || '#c00' },
        cancelBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: (colors.error || '#c00') + '18',
          borderLeftWidth: 4,
          borderLeftColor: colors.error || '#c00',
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
        },
        cancelBannerText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.error || '#c00' },
        checkoutResumeBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: (colors.primary || '#4f46e5') + '18',
          borderLeftWidth: 4,
          borderLeftColor: colors.primary,
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
        },
        checkoutResumeBannerTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
        checkoutResumeBannerSub: {
          fontSize: 12,
          fontWeight: '500',
          color: colors.textSecondary,
          marginTop: 2,
        },
        cancelConfirmBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          justifyContent: 'center',
          padding: spacing.lg,
        },
        cancelConfirmCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: (colors.border || '#e5e7eb') + 'cc',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        cancelConfirmIconWrap: {
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: (colors.error || '#dc2626') + '18',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: spacing.sm,
        },
        cancelConfirmTitle: {
          fontSize: 19,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          letterSpacing: -0.3,
        },
        cancelConfirmMessage: {
          marginTop: spacing.sm,
          fontSize: 14,
          lineHeight: 21,
          color: colors.textSecondary,
          textAlign: 'center',
        },
        cancelConfirmOrderLabel: {
          marginTop: spacing.sm,
          fontSize: 13,
          fontWeight: '700',
          color: colors.primary,
          textAlign: 'center',
        },
        cancelConfirmActions: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginTop: spacing.lg,
        },
        cancelConfirmBtn: {
          flex: 1,
          paddingVertical: 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: borderRadius.md,
        },
        cancelConfirmBtnSecondary: {
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        cancelConfirmBtnPrimary: {
          backgroundColor: colors.error || '#dc2626',
        },
        cancelConfirmBtnTextSecondary: {
          fontSize: 15,
          fontWeight: '700',
          color: colors.text,
        },
        cancelConfirmBtnTextPrimary: {
          fontSize: 15,
          fontWeight: '800',
          color: '#fff',
        },
        cancelModalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          justifyContent: 'center',
          padding: spacing.md,
        },
        cancelModalContent: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          maxHeight: '88%',
          borderWidth: 1,
          borderColor: (colors.primary || '#6366f1') + '2a',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 10,
        },
        cancelModalHeaderIcon: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: (colors.primary || '#6366f1') + '14',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: spacing.sm,
        },
        cancelModalTitle: {
          fontSize: 18,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          letterSpacing: -0.2,
        },
        cancelModalHint: {
          marginTop: 8,
          fontSize: 13,
          lineHeight: 19,
          color: colors.textSecondary,
          textAlign: 'center',
        },
        cancelModalBody: {
          marginTop: spacing.sm,
        },
        cancelReasonList: {
          gap: 8,
        },
        cancelReasonItem: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        cancelReasonItemSelected: {
          borderColor: colors.error || '#c00',
          backgroundColor: (colors.error || '#c00') + '12',
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
          borderColor: colors.error || '#c00',
        },
        cancelReasonRadioInner: {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.error || '#c00',
        },
        cancelReasonText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
        cancelModalActions: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginTop: spacing.md,
        },
        cancelModalBtn: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: borderRadius.md,
        },
        cancelModalBtnSecondary: {
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        cancelModalBtnPrimary: {
          backgroundColor: colors.error || '#c00',
        },
        cancelModalBtnTextSecondary: {
          fontSize: 15,
          fontWeight: '700',
          color: colors.textSecondary,
        },
        cancelModalBtnTextPrimary: {
          fontSize: 15,
          fontWeight: '700',
          color: '#fff',
        },

          customerLeft: {
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.sm,
              flex: 1,
              minWidth: 0,
          },
          addressRow: {
              flexDirection: 'row',
              marginTop: 1,
          },
          addressText: {
              color: colors.textSecondary,
              lineHeight: 16,
              flex: 1,
          },
      }),
    [colors, insets.bottom]
  );

  const updateVehicleInventory = useCallback(async (effectiveQtys) => {
    const vehicleId = order?.vehicle_id != null
      ? (Array.isArray(order.vehicle_id) ? order.vehicle_id[0] : order.vehicle_id)
      : null;

    if (vehicleId == null) {
      console.warn('No vehicle ID found for inventory update');
      return;
    }

    // Get location_id for this vehicle
    const locationId = await getVehicleLocationId(vehicleId);
    if (locationId == null) {
      console.warn(`No location_id found for vehicle ${vehicleId}`);
      return;
    }

    console.log('[Inventory Update] Starting update for vehicle:', vehicleId, 'location:', locationId);

    /** Prefer live SQLite lorry qty so a stale screen snapshot cannot double-deduct. */
    const dbRows = await vehicleInventoriesDb.getVehicleInventoryByLocationId(locationId).catch(() => []);
    const dbQtyByProduct = new Map(
      (dbRows || []).map((r) => [
        Number(r.product_id),
        clampNonNegativeStock(Number(r.quantity) || 0),
      ])
    );

    /**
     * Baseline must match what the UI uses for limits ("on hand" = stock.quant quantity).
     * Using only available_quantity was wrong: it is often 0 when stock is reserved, which made
     * (0 - delivered) and wiped lorry stock in the local DB / Odoo sync.
     */
    const baselineOnLorry = (productId) => {
      const pid = Number(productId);
      if (dbQtyByProduct.has(pid)) return dbQtyByProduct.get(pid);
      return clampNonNegativeStock(
        productIdToOnHand[productId] ?? productIdToAvailable[productId] ?? 0
      );
    };

    try {
      /** Per product: remaining after all lines (handles multiple lines for same product). */
      const remainingByProduct = new Map();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qtyUsed = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(line.newQty);
        const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

        if (productId == null || qtyUsed <= 0) continue;

        const pid = Number(productId);
        if (!remainingByProduct.has(pid)) {
          remainingByProduct.set(pid, baselineOnLorry(pid));
        }
        const prev = remainingByProduct.get(pid);
        const newStock = Math.max(0, prev - qtyUsed);
        remainingByProduct.set(pid, newStock);

        console.log(`[Inventory Update] Product ${pid}: ${prev} - ${qtyUsed} → running ${newStock}`);
      }

      const inventoryPayload = {
        saleOrderId: Number(order.id),
        vehicleId,
        locationId,
        holdUntilComplete: true,
        inventoryDeductionKey: `so-${Number(order.id)}`,
        updates: Array.from(remainingByProduct.entries()).map(([productId, newQuantity]) => ({
          productId,
          quantityUsed: baselineOnLorry(productId) - newQuantity,
          newQuantity,
        })),
      };
      const existingInventoryUpdate =
        await syncQueueDb.getPendingInventoryUpdateItemBySaleOrderId(Number(order.id));
      if (existingInventoryUpdate?.id != null) {
        const existingPayload = existingInventoryUpdate.payload || {};
        const existingUpdates = Array.isArray(existingPayload.updates) ? existingPayload.updates : [];
        await syncQueueDb.updateQueueItemPayload(existingInventoryUpdate.id, {
          ...inventoryPayload,
          holdUntilComplete: true,
          updates: mergeInventoryQueueKeepingEmpty(existingUpdates, inventoryPayload.updates),
        });
      } else {
        await syncQueueDb.enqueue(syncQueueDb.ACTION_INVENTORY_UPDATE, inventoryPayload);
      }

      // Intentionally do not mutate local inventory here.
      // Stock should reduce only after user confirms "Complete order" on PaymentProof.
      console.log('[Inventory Update] Prepared held inventory update for completion');
    } catch (error) {
      console.error('[Inventory Update] Failed:', error);
      throw new Error('Failed to update vehicle inventory');
    }
  }, [order, lines, productIdToAvailable, productIdToOnHand]);
  const enrichDetailsInBackground = useCallback(
    async (data, mappedLines, deliveryDone) => {
      const productIds = mappedLines
        .map((l) => (Array.isArray(l.product_id) ? l.product_id[0] : l.product_id))
        .filter((pid) => pid != null);
      const imageMap = await productsDb.getProductImageUriMapForIds(productIds);
      setProductIdToImageUri(imageMap || {});

      let mapAvail = {};
      let mapOnHand = {};
      const vehicleId =
        data.order?.vehicle_id != null
          ? Array.isArray(data.order.vehicle_id)
            ? data.order.vehicle_id[0]
            : data.order.vehicle_id
          : null;

      if (vehicleId != null) {
        try {
          const locationId = await getVehicleLocationId(vehicleId);
          if (locationId) {
            const inventories = await getCachedVehicleInventoryByLocation(locationId);
            (inventories || []).forEach((inv) => {
              const pid = inv.product_id != null ? inv.product_id : inv.id;
              if (pid != null) {
                mapAvail[pid] = clampNonNegativeStock(inv.available_quantity);
                mapOnHand[pid] = clampNonNegativeStock(inv.quantity);
              }
            });
            (data.lines || []).forEach((l) => {
              const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
              if (pid == null) return;
              if (mapAvail[pid] === undefined) mapAvail[pid] = 0;
              if (mapOnHand[pid] === undefined) mapOnHand[pid] = 0;
            });
          }
        } catch (error) {
          console.error('Failed to load vehicle inventory:', error);
        }
      }
      setProductIdToAvailable(mapAvail);
      setProductIdToOnHand(mapOnHand);
      setSaleOrderDetailsUiCache(saleOrderId, {
        order: data.order,
        lines: mappedLines,
        isDelivered: data.order?.invoice_status === 'invoiced',
        isDeliveryDone: deliveryDone,
        productIdToAvailable: mapAvail,
        productIdToOnHand: mapOnHand,
        productIdToImageUri: imageMap || {},
      });
    },
    [saleOrderId]
  );

  const loadDetails = useCallback(
    async ({ silent = false } = {}) => {
      const hadCache = !!getSaleOrderDetailsUiCache(saleOrderId)?.order;
      if (!silent && !hadCache) setLoading(true);
      try {
        const [data, { picking, moves, moveLines }] = await Promise.all([
          getSaleOrderDetailsFromDB(saleOrderId),
          getDeliveryDataFromDB(saleOrderId),
        ]);
        if (!data.order) {
          setOrder(null);
          setLines([]);
          setIsDelivered(false);
          setProductIdToAvailable({});
          setProductIdToOnHand({});
          return;
        }
        const moveIdToProductId = {};
        (moves || []).forEach((m) => {
          const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
          if (pid != null) moveIdToProductId[m.id] = pid;
        });
        const qtyDoneByProductId = {};
        (moveLines || []).forEach((ml) => {
          const mid = Array.isArray(ml.move_id) ? ml.move_id[0] : ml.move_id;
          const pid = moveIdToProductId[mid];
          if (pid == null) return;
          qtyDoneByProductId[pid] = (qtyDoneByProductId[pid] || 0) + (Number(ml.qty_done) || 0);
        });
        const deliveryDone = ((picking?.state || '') + '').toLowerCase() === 'done';
        const mappedLines = (data.lines || []).map((l) => {
          const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
          const savedDone = pid != null ? qtyDoneByProductId[pid] : null;
          const demand = Number(l.product_uom_qty ?? 0) || 0;
          const initial =
            deliveryDone && savedDone != null && savedDone > 0 ? savedDone : demand;
          return { ...l, newQty: String(initial) };
        });
        setOrder(data.order);
        setLines(mappedLines);
        setQtyChanged(false);
        setIsDeliveryDone(deliveryDone);
        setIsDelivered(data.order?.invoice_status === 'invoiced');
        setLoading(false);
        void enrichDetailsInBackground(data, mappedLines, deliveryDone);
      } catch (_) {
        if (!silent && !hadCache) {
          setOrder(null);
          setLines([]);
          setIsDelivered(false);
          setIsDeliveryDone(false);
          setProductIdToImageUri({});
          setProductIdToOnHand({});
        }
      } finally {
        setLoading(false);
      }
    },
    [enrichDetailsInBackground, saleOrderId]
  );

  useFocusEffect(
    useCallback(() => {
      void loadDetails({ silent: !!getSaleOrderDetailsUiCache(saleOrderId)?.order });
    }, [loadDetails, saleOrderId])
  );

  useEffect(() => {
    let active = true;
    const loadReasons = async () => {
      setCancelReasonsLoading(true);
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
  }, []);

  useEffect(() => {
    if (order?.name != null || order?.id != null) {
      const orderLabel = order.name ?? `#${order.id}`;
      navigation.setOptions({ title: `Order Details (${orderLabel})` });
    }
  }, [navigation, order?.name, order?.id]);

  const effectiveCancelReasons = cancelReasons;

  /**
   * Max total units deliverable for this product (sum of line qtys) — capped by **on-hand** lorry stock (`quantity`).
   * Does not use available/free ("extra") quantity for limits.
   */
  const getMaxDeliverableTotalForProduct = useCallback(
    (productId, linesSnapshot = lines) => {
      if (isDeliveryDone) return undefined;
      if (productIdToOnHand[productId] === undefined) return undefined;
      return clampNonNegativeStock(productIdToOnHand[productId]);
    },
    [isDeliveryDone, lines, productIdToOnHand]
  );

  /**
   * Live available = on-hand - currently ordered qty for this product (all lines),
   * so it updates immediately while the user edits quantities.
   */
  const getLiveAvailableForProduct = useCallback(
    (productId, linesSnapshot = lines) => {
      if (productId == null) return undefined;
      const onHand = clampNonNegativeStock(productIdToOnHand[productId] ?? 0);
      const ordered = (linesSnapshot || []).reduce((sum, l) => {
        const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        if (Number(pid) !== Number(productId)) return sum;
        return sum + (Number(l.newQty) || 0);
      }, 0);
      return Math.max(0, onHand - ordered);
    },
    [lines, productIdToOnHand]
  );

    const setLineQty = useCallback((lineId, value) => {
      setUpdateError(null);
      const trimmed = value.replace(/[^0-9.]/g, '');
      const num = trimmed === '' ? 0 : parseFloat(trimmed);

      let safeQty = isNaN(num) || num < 0 ? 0 : num;

      setLines((prev) => {
        const line = prev.find((l) => l.id === lineId);
        if (line) {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

          if (!isDeliveryDone && productId != null && productIdToOnHand[productId] !== undefined) {
            const maxTot = getMaxDeliverableTotalForProduct(productId, prev);
            if (maxTot !== undefined) {
              const sumOther = prev.reduce((s, l) => {
                if (l.id === lineId) return s;
                const p = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
                return p === productId ? s + (Number(l.newQty) || 0) : s;
              }, 0);
              const maxLine = Math.max(0, maxTot - sumOther);
              safeQty = Math.min(safeQty, maxLine);
            }
          }
        }

        return prev.map((l) =>
          l.id === lineId ? { ...l, newQty: trimmed === '' ? '' : String(safeQty) } : l
        );
      });

      setQtyChanged(true);
    }, [getMaxDeliverableTotalForProduct, isDeliveryDone, productIdToOnHand]);
const changeQtyBy = useCallback((lineId, delta) => {
  setUpdateError(null);
  const MAX_QTY = 9999;

  setLines((prev) =>
    prev.map((l) => {
      if (l.id !== lineId) return l;

      const current = parseFloat(l.newQty) || 0;
      let next = current + delta;

      const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;

      if (!isDeliveryDone && productId != null && productIdToOnHand[productId] !== undefined) {
        const maxTot = getMaxDeliverableTotalForProduct(productId, prev);
        if (maxTot !== undefined) {
          const sumOther = prev.reduce((s, x) => {
            if (x.id === lineId) return s;
            const p = Array.isArray(x.product_id) ? x.product_id[0] : x.product_id;
            return p === productId ? s + (Number(x.newQty) || 0) : s;
          }, 0);
          const maxLine = Math.max(0, maxTot - sumOther);
          next = Math.max(0, Math.min(maxLine, next));
        }
      } else {
        next = Math.max(0, Math.min(MAX_QTY, next));
      }

      return { ...l, newQty: String(next) };
    })
  );

  setQtyChanged(true);
}, [getMaxDeliverableTotalForProduct, isDeliveryDone, productIdToOnHand]);
  const hasQtyChanges = useCallback(() => {
    return lines.some(
      (l) => Number(l.newQty) !== Number(l.product_uom_qty)
    );
  }, [lines]);

const validateQuantities = useCallback(() => {
  // 1) Basic qty constraints
  for (const l of lines) {
    const qty = Number(l.newQty);
    const productName = getProductDisplayName(l.product_id?.[1] ?? l.name ?? '');

    if (!Number.isFinite(qty) || qty < 0) {
      return `Invalid quantity for "${productName}".`;
    }

    // Qty can be set to any value (including 0) for removal/cancellation
    if (qty < 0) {
      return `Quantity for "${productName}" cannot be negative.`;
    }
  }

  // 2) Stock constraint (skipped when delivery picking is already done)
  if (!isDeliveryDone) {
    const requestedTotalByProductId = {};
    for (const l of lines) {
      const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      if (productId == null) continue;
      const requestedQty = Number(l.newQty ?? 0) || 0;
      requestedTotalByProductId[productId] = (requestedTotalByProductId[productId] || 0) + requestedQty;
    }

    for (const pid of Object.keys(requestedTotalByProductId)) {
      const productId = Number(pid);
      const maxAllowedTotal = getMaxDeliverableTotalForProduct(productId);
      if (maxAllowedTotal === undefined) continue;

      const requestedTotal = requestedTotalByProductId[productId] || 0;
      if (requestedTotal > maxAllowedTotal) {
        const lineForName = lines.find((l) => {
          const pid2 = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
          return Number(pid2) === productId;
        });
        const productName = lineForName
          ? getProductDisplayName(lineForName.product_id?.[1] ?? lineForName.name ?? '')
          : `Product ${productId}`;
        const stockHint = clampNonNegativeStock(productIdToOnHand[productId]);
        return `Insufficient stock for "${productName}". On hand (lorry): ${stockHint}, max deliverable total: ${maxAllowedTotal}`;
      }
    }
  }

  return null;
}, [lines, productIdToOnHand, isDeliveryDone, getMaxDeliverableTotalForProduct]);
  /**
   * Apply qty updates locally (offline DB) and build sync payload.
   * - `demandEdit: false` (proceed to payment): do NOT change sale.order.line ordered qty (`product_uom_qty`). Stock moves/lines carry delivery; payload includes `saleOrderLineDeliveredUpdates` for Odoo `qty_delivered` only (after sync validates picking).
   * - `demandEdit: true` (Modify → Save): user explicitly changes ordered qty → `orderLineUpdates` + stock.move demand.
   * - Uses all open pickings (backorders), not only the first DB row — fixes “only one product updated” when Odoo split transfers.
   */
  const applyQtyDoneAndValidate = useCallback(
    async (effectiveQtys, markDeliveryDone = false, options = {}) => {
      const demandEdit = options.demandEdit === true;
      if (!order?.id) throw new Error('No order');

      const pickings = await stockPickingsDb.getStockPickingsBySaleId(order.id);
      if (!pickings?.length) {
        throw new Error('No delivery order found for this sale order. Confirm the order first.');
      }
      const openPickings = pickings.filter((p) => String(p.state || '').toLowerCase() !== 'done');
      /**
       * Critical fallback:
       * local state can be "done" before backend finishes syncing (offline completion flow).
       * If we send no picking blocks, backend may miss delivered lines and invoice only partial values.
       * Keep all pickings as targets when no local "open" picking exists; sync layer already skips truly done backend pickings.
       */
      const targets = openPickings.length > 0 ? openPickings : pickings;

      /** Ordered qty (SO demand) — only when driver explicitly uses Modify → Update, never on proceed-to-payment. */
      const orderLineUpdates = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
        const oldDem = Number(l.product_uom_qty) || 0;
        if (demandEdit && newVal !== oldDem) {
          orderLineUpdates.push({ lineId: l.id, product_uom_qty: newVal });
          await saleOrderLinesDb.updateSaleOrderLineQtyLocal(l.id, newVal);
        }
      }
      if (orderLineUpdates.length > 0) {
        await saleOrdersDb.updateSaleOrderAmountsFromLines(order.id);
      }

      /** Aggregate requested qty by product to avoid last-line-wins bugs when same product appears multiple times. */
      const requestedQtyByProductId = {};
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        if (productId == null) continue;
        const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
        const safeQty = Number.isFinite(newVal) ? Math.max(0, newVal) : 0;
        requestedQtyByProductId[productId] = (requestedQtyByProductId[productId] || 0) + safeQty;
      }

      const pickingsOut = [];

      /**
       * Odoo can split one SO into several pickings (backorders). Writing the full requested qty on every
       * picking doubles qty_done in the back office. Split across moves in stable order; drain remainder.
       */
      const remainingByProduct = {};
      for (const [pidRaw, q] of Object.entries(requestedQtyByProductId)) {
        remainingByProduct[pidRaw] = Number(q) || 0;
      }
      const sortedTargets = [...targets].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));

      const allocationSlots = [];
      for (const picking of sortedTargets) {
        const moves = await stockMovesDb.getStockMovesByPickingId(picking.id);
        if (!moves?.length) continue;
        const idsForLines = moves.map((m) => m.id).filter((id) => id != null);
        const moveLines = await stockMoveLinesDb.getStockMoveLinesByMoveIds(idsForLines);
        const moveIdToMoveLineId = {};
        for (const ml of moveLines || []) {
          const mid = Array.isArray(ml.move_id) ? ml.move_id[0] : ml.move_id;
          if (mid == null) continue;
          if (moveIdToMoveLineId[mid] == null) moveIdToMoveLineId[mid] = ml.id;
        }
        const sortedMoves = [...(moves || [])].sort((a, b) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
        for (const moveRow of sortedMoves) {
          const productIdRaw = Array.isArray(moveRow.product_id) ? moveRow.product_id[0] : moveRow.product_id;
          const productId = Number(productIdRaw);
          if (!Number.isFinite(productId)) continue;
          if (!Object.prototype.hasOwnProperty.call(requestedQtyByProductId, String(productId))) continue;
          allocationSlots.push({
            pickingId: picking.id,
            moveId: moveRow.id,
            moveRow,
            moveLineId: moveIdToMoveLineId[moveRow.id],
            productId,
            cap: Number(moveRow.product_uom_qty) || 0,
          });
        }
      }

      for (const slot of allocationSlots) {
        const pidKey = String(slot.productId);
        const totalRequested = Number(requestedQtyByProductId[pidKey]) || 0;
        let remainingAmt = Number(remainingByProduct[pidKey]);
        if (!Number.isFinite(remainingAmt)) remainingAmt = 0;
        const cap = slot.cap;
        let alloc;
        if (totalRequested <= 0) {
          alloc = 0;
        } else if (remainingAmt <= 0) {
          alloc = 0;
        } else if (cap > 0) {
          alloc = Math.min(remainingAmt, cap);
        } else {
          alloc = remainingAmt;
        }
        remainingByProduct[pidKey] = remainingAmt - alloc;
        slot.allocatedQty = alloc;
      }

      for (const pidKey of Object.keys(remainingByProduct)) {
        const leftover = Number(remainingByProduct[pidKey]) || 0;
        if (leftover <= 0.0001) continue;
        for (let i = allocationSlots.length - 1; i >= 0; i--) {
          if (String(allocationSlots[i].productId) !== pidKey) continue;
          allocationSlots[i].allocatedQty = (Number(allocationSlots[i].allocatedQty) || 0) + leftover;
          break;
        }
        remainingByProduct[pidKey] = 0;
      }

      const slotsByPickingId = {};
      for (const slot of allocationSlots) {
        const pk = slot.pickingId;
        if (!slotsByPickingId[pk]) slotsByPickingId[pk] = [];
        slotsByPickingId[pk].push(slot);
      }

      for (const picking of sortedTargets) {
        const slots = slotsByPickingId[picking.id];
        if (!slots?.length) continue;

        const moves = await stockMovesDb.getStockMovesByPickingId(picking.id);
        if (!moves?.length) continue;
        const idsForLines = moves.map((m) => m.id).filter((id) => id != null);
        const moveLines = await stockMoveLinesDb.getStockMoveLinesByMoveIds(idsForLines);
        const moveIdToMoveLineId = {};
        for (const ml of moveLines || []) {
          const mid = Array.isArray(ml.move_id) ? ml.move_id[0] : ml.move_id;
          if (mid == null) continue;
          if (moveIdToMoveLineId[mid] == null) moveIdToMoveLineId[mid] = ml.id;
        }
        const qtyDoneByMoveLineId = {};
        for (const ml of moveLines || []) {
          qtyDoneByMoveLineId[ml.id] = Number(ml.qty_done) || 0;
        }

        const moveUpdates = [];
        const moveLineUpdates = [];
        const deliveryLines = [];

        const sortedSlots = [...slots].sort((a, b) => Number(a.moveId ?? 0) - Number(b.moveId ?? 0));
        for (const slot of sortedSlots) {
          const newVal = Number(slot.allocatedQty) || 0;
          const productId = slot.productId;
          const moveId = slot.moveId;
          const moveRow = slot.moveRow;
          const moveLineId = slot.moveLineId ?? moveIdToMoveLineId[moveId];

          const currentMoveDemand = Number(moveRow?.product_uom_qty) || 0;

          if (demandEdit && newVal !== currentMoveDemand) {
            await stockMovesDb.updateStockMoveQtyLocal(moveId, newVal);
            moveUpdates.push({ moveId, product_uom_qty: newVal });
          }

          if (!demandEdit) {
            deliveryLines.push({ moveId, productId, qty_done: newVal });
          }

          if (moveLineId != null) {
            const prevDone = qtyDoneByMoveLineId[moveLineId] ?? 0;
            let nextDone;
            if (demandEdit) {
              nextDone = Math.min(prevDone, newVal);
            } else {
              nextDone = newVal;
            }
            if (nextDone !== prevDone) {
              await stockMoveLinesDb.updateMoveLineQtyLocal(moveLineId, nextDone);
              moveLineUpdates.push({ moveLineId, moveId, productId, qty_done: nextDone });
              qtyDoneByMoveLineId[moveLineId] = nextDone;
            }
          }
        }

        const hasWork =
          moveUpdates.length > 0 || moveLineUpdates.length > 0 || (!demandEdit && deliveryLines.length > 0);
        if (hasWork) {
          pickingsOut.push({
            pickingId: picking.id,
            moveUpdates,
            moveLineUpdates,
            deliveryLines: demandEdit ? [] : deliveryLines,
          });
        }
      }

      /** Sync writes `qty_delivered` on SO lines after picking — never overwrite ordered qty from delivery flow. */
      const saleOrderLineDeliveredUpdates = [];
      if (!demandEdit) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
          if (l.id == null || !Number.isFinite(Number(newVal))) continue;
          saleOrderLineDeliveredUpdates.push({ lineId: l.id, qty_delivered: Number(newVal) });
        }
      }
      /** Persist delivered qty locally so invoice / delivered-tab UI match before Odoo sync; sync merge preserves vs server 0 during pending queues. */
      if (!demandEdit && saleOrderLineDeliveredUpdates.length > 0) {
        for (const u of saleOrderLineDeliveredUpdates) {
          if (u.lineId == null || u.qty_delivered == null || !Number.isFinite(Number(u.qty_delivered))) continue;
          await saleOrderLinesDb.updateSaleOrderLineQtyDeliveredLocal(u.lineId, Number(u.qty_delivered));
        }
      }

      const payload = {
        saleOrderId: order.id,
        demandEdit,
        orderLineUpdates,
        saleOrderLineDeliveredUpdates,
        requestedQtyByProduct: { ...requestedQtyByProductId },
        pickings: pickingsOut,
      };
      /**
       * Edge case: product demand can be raised from 0 while no local move row exists yet.
       * Keep target picking ids in payload so sync can re-read backend moves and attach qty_done.
       */
      if (!demandEdit && pickingsOut.length === 0) {
        const hasPositiveRequestedQty = Object.values(requestedQtyByProductId).some((q) => Number(q) > 0);
        if (hasPositiveRequestedQty) {
          payload.pickings = (targets || [])
            .filter((p) => p?.id != null)
            .map((p) => ({
              pickingId: Number(p.id),
              moveUpdates: [],
              moveLineUpdates: [],
              deliveryLines: [],
            }));
        }
      }
      if (pickingsOut[0]?.pickingId != null) {
        payload.pickingId = pickingsOut[0].pickingId;
      }

      if (markDeliveryDone && pickingsOut.length > 0) {
        for (const b of pickingsOut) {
          if (b.pickingId != null) {
            await stockPickingsDb.updatePickingStateLocal(b.pickingId, 'done');
          }
        }
        await syncQueueDb.enqueue(syncQueueDb.ACTION_DELIVERY, payload);
      }

      return payload;
    },
    [order?.id, lines]
  );
const getStockWarning = useCallback((lineId) => {
  const line = lines.find(l => l.id === lineId);
  if (!line) return null;

  const qty = Number(line.newQty);
  const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

  if (isDeliveryDone || productId == null || productIdToOnHand[productId] === undefined) return null;

  const maxTot = getMaxDeliverableTotalForProduct(productId);
  if (maxTot === undefined) return null;

  const sumOther = lines.reduce((s, l) => {
    if (l.id === lineId) return s;
    const p = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
    return p === productId ? s + (Number(l.newQty) || 0) : s;
  }, 0);
  const maxLine = Math.max(0, maxTot - sumOther);
  if (qty > maxLine) {
    return `Insufficient stock (max allowed for this line: ${maxLine})`;
  }
  return null;
}, [lines, productIdToOnHand, isDeliveryDone, getMaxDeliverableTotalForProduct]);
  const updateQty = async () => {
    const validationError = validateQuantities();
    if (validationError) {
      setUpdateError(validationError);
      return;
    }
    setUpdateError(null);
    setUpdating(true);
    try {
      const payload = await applyQtyDoneAndValidate(lines.map((l) => l.newQty), false, {
        demandEdit: true,
      });
      const needsDeliveryQueue =
        (payload.orderLineUpdates?.length > 0) ||
        (payload.saleOrderLineDeliveredUpdates?.length > 0) ||
        (payload.pickings || []).some(
          (b) =>
            (b.moveUpdates?.length > 0) ||
            (b.moveLineUpdates?.length > 0) ||
            (b.deliveryLines?.length > 0)
        );
      if (needsDeliveryQueue) {
        const payloadWithHold = { ...payload, holdUntilPayment: true };
        const existing = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(order.id);
        if (existing) {
          await syncQueueDb.updateQueueItemPayload(existing.id, payloadWithHold);
        } else {
          await syncQueueDb.enqueue(syncQueueDb.ACTION_DELIVERY, payloadWithHold);
        }
      }
      const updatedLines = linesAfterDemandEditSave(lines, payload.orderLineUpdates);
      const orderAmounts = orderAmountsFromLines(updatedLines);
      setLines(updatedLines);
      setOrder((prev) => {
        const next = prev ? { ...prev, ...orderAmounts } : prev;
        if (next) {
          setSaleOrderDetailsUiCache(saleOrderId, {
            ...(getSaleOrderDetailsUiCache(saleOrderId) || {}),
            order: next,
            lines: updatedLines,
          });
        }
        return next;
      });
      setQtyChanged(false);
      setModifyEnabled(false);
      setUpdateError(null);
    } catch (err) {
      setUpdateError(err?.message ?? 'Update failed. Try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleOpenCancelFlow = useCallback(() => {
    if (String(order?.state || '') === 'cancel') return;
    setShowCancelConfirmModal(true);
  }, [order?.state]);

  const openCancelReasonModal = useCallback(() => {
    setShowCancelConfirmModal(false);
    setCancelError(null);
    setShowCancelModal(true);
  }, []);

  const handleCancelOrder = useCallback(async () => {
    if (!order?.id || canceling || String(order?.state || '') === 'cancel') return;
    if (!cancelReason) {
      Alert.alert(
        t('saleorderdetails.reasonNeeded', 'Reason needed'),
        t('saleorderdetails.pickACancelReasonFromTheList', 'Pick a cancel reason from the list.')
      );
      return;
    }

    setCancelError(null);
    setCanceling(true);
    try {
      await cancelSaleOrderOfflineFirst(order.id, cancelReason);
      setShowCancelModal(false);
      Alert.alert(
        t('saleorder.cancelSavedTitle', 'Order cancelled'),
        t(
          'saleorder.cancelSavedMessage',
          'Cancelled on this device. It will sync to the back office automatically when you are online.'
        )
      );
      navigation.goBack();
    } catch (err) {
      setCancelError(err?.message ?? t('saleorderdetails.cancelFailedTryAgain', 'Cancel failed. Try again.'));
    } finally {
      setCanceling(false);
    }
  }, [cancelReason, canceling, navigation, order?.id, order?.state, t]);

const handleProceedToPayment = useCallback(async () => {
  const noChanges = !hasQtyChanges();
  if (!noChanges) {
    const validationError = validateQuantities();
    if (validationError) {
      setUpdateError(validationError);
      return;
    }
  }
  setUpdateError(null);
  setUpdating(true);
  try {
    /** Use line `newQty` (includes saved qty_done from delivery), not SO demand (`product_uom_qty`). */
    const effectiveQtys = lines.map((l) => Number(l.newQty) || 0);

    // Update line/move quantities locally only; do NOT enqueue delivery or mark picking done yet.
    // Delivery is enqueued and marked done only after payment is completed on ProceedPaymentScreen.
    const deliveryPayload = await applyQtyDoneAndValidate(effectiveQtys, false, { demandEdit: false });

    // Update vehicle inventory only if delivery isn't already done locally.
    // This avoids double-deducting lorry stock for "delivered but not invoiced yet" flows.
    if (!isDeliveryDone) {
      await updateVehicleInventory(effectiveQtys);
    }

    const subtotal = noChanges
      ? lines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0)
      : lines.reduce((sum, l) => sum + (Number(l.newQty) || 0) * (Number(l.price_unit) || 0), 0);
    const tax = noChanges
      ? lines.reduce(
          (sum, l) => sum + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)),
          0
        )
      : lines.reduce((sum, l) => sum + lineTaxAtQuantity(l, l.newQty), 0);
    const total = subtotal + tax;

    const invoiceLineQtys = lines.map((l, i) => ({
      lineId: l.id,
      qty: Number(effectiveQtys[i] != null ? effectiveQtys[i] : l.newQty) || 0,
    }));

    navigation.navigate('ProceedPayment', {
      saleOrderId: order.id,
      total: total ?? order.amount_total,
      subtotal,
      tax,
      deliveryDone: isDeliveryDone === true,
      deliveryPayload,
      invoiceLineQtys,
    });
  } catch (err) {
    setUpdateError(err?.message ?? 'Delivery update failed. Try again.');
  } finally {
    setUpdating(false);
  }
}, [order, lines, validateQuantities, hasQtyChanges, applyQtyDoneAndValidate, updateVehicleInventory, isDeliveryDone, navigation]);

  /** Subtotal from lines; fallback to order.amount_untaxed when no lines or sum is 0 */
  const computedSubtotal = useMemo(() => {
    if (!lines.length) return Number(order?.amount_untaxed) || 0;
    const sum = lines.reduce((s, l) => {
      const qtyChanged = Number(l.newQty) !== Number(l.product_uom_qty);
      if (qtyChanged) return s + (Number(l.price_unit) || 0) * (Number(l.newQty) || 0);
      return s + (Number(l.price_subtotal) || 0);
    }, 0);
    return sum > 0 ? sum : (Number(order?.amount_untaxed) || 0);
  }, [lines, order?.amount_untaxed]);

  /** Tax from lines; fallback to order.amount_tax when no lines or sum is 0 */
  const computedTax = useMemo(() => {
    if (!lines.length) return Number(order?.amount_tax) || 0;
    const sum = lines.reduce((s, l) => {
      const qtyChanged = Number(l.newQty) !== Number(l.product_uom_qty);
      if (qtyChanged) {
        return s + lineTaxAtQuantity(l, l.newQty);
      }
      return s + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0));
    }, 0);
    return sum > 0 ? sum : (Number(order?.amount_tax) || 0);
  }, [lines, order?.amount_tax]);

  /** Total (subtotal + tax); fallback to order.amount_total */
  const computedTotal = useMemo(() => {
    const t = computedSubtotal + computedTax;
    return t > 0 ? t : (Number(order?.amount_total) || 0);
  }, [computedSubtotal, computedTax, order?.amount_total]);

  const renderItem = ({ item }) => {
    const qtyNum = Number(item.newQty);
    const qtyChangedForLine =
      Number(item.newQty) !== Number(item.product_uom_qty);
    const unitPrice = Number(item.price_unit) || 0;
    const lineSubtotal = Number(item.price_subtotal) || 0;
    const displayLineTotal = qtyChangedForLine
      ? unitPrice * (Number.isNaN(qtyNum) ? 0 : qtyNum)
      : (lineSubtotal > 0 ? lineSubtotal : unitPrice * (Number.isNaN(qtyNum) ? 0 : qtyNum));
    const productName = item.product_id?.[1] ?? item.name ?? '';
    const gasSize = getGasSizeFromProductName(productName);
    const isNewIssueLine = isNewIssueName(productName);
    const issuePrefix = isNewIssueLine ? 'New Issue ' : '';
    const gasAccent =
      gasSize && GAS_SIZE_COLORS[gasSize.size] ? GAS_SIZE_COLORS[gasSize.size] : FALLBACK_ACCENT;
    const productId = item.product_id != null && Array.isArray(item.product_id) ? item.product_id[0] : item.product_id;
    const onHandStockRaw = productId != null ? productIdToOnHand[productId] : undefined;
    const onHandStock =
      onHandStockRaw !== undefined ? clampNonNegativeStock(onHandStockRaw) : undefined;
    const liveAvailable =
      productId != null && onHandStock !== undefined
        ? getLiveAvailableForProduct(productId)
        : undefined;
    const backendImageUri = productId != null ? productIdToImageUri[productId] : null;
    const imageSource = backendImageUri ? { uri: backendImageUri } : getProductImageSource(productName);

    return (
      <View style={[styles.lineCard]}>
        <View style={styles.lineCardInnerRow}>
          {/* Left: circular gas image centered in circle */}
          {imageSource != null && (
            <View style={styles.lineCardImageWrap}>
              <Image source={imageSource} style={styles.lineCardImage} />
            </View>
          )}
          <View style={styles.lineCardLeft}>
            {/* Item name × quantity (same pattern as Order cards) – quantity at a glance */}
            {!isDelivered && modifyEnabled ? (
              <>
                <View style={styles.lineNameQtyRow}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {gasSize ? (
                      <>
                        <View style={[styles.lineGasSwatch, { backgroundColor: gasAccent }]} />
                        <Text style={styles.lineProductName} numberOfLines={1}>
                          {issuePrefix}{gasSize.kg} kg ×
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.lineProductName} numberOfLines={1}>
                        {getProductDisplayName(productName) || 'Unknown'} ×
                      </Text>
                    )}
                  </View>
                  <View style={styles.qtyControls}>
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={() => changeQtyBy(item.id, -1)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="remove" size={22} color={colors.primary} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.qtyInput}
                      value={item.newQty}
                      onChangeText={(text) => setLineQty(item.id, text)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      selectTextOnFocus
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={() => Keyboard.dismiss()}
                      editable
                    />
                    <TouchableOpacity
                      style={styles.qtyIconBtn}
                      onPress={() => changeQtyBy(item.id, 1)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="add" size={22} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {gasSize && onHandStock !== undefined && (
                  <View style={styles.availableStockRow}>
                    <Text
                      style={[
                        styles.availableStockText,
                        (liveAvailable ?? 0) === 0 && { color: colors.error || '#c00' },
                      ]}
                    >
                      Available : {liveAvailable ?? 0}
                    </Text>
                  </View>
                )}
                {getStockWarning(item.id) && (
                  <Text style={styles.stockWarningText}>
                    {getStockWarning(item.id)}
                  </Text>
                )}
              </>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                {gasSize ? (
                  <View style={[styles.lineGasSwatch, { backgroundColor: gasAccent, marginTop: 4 }]} />
                ) : null}
                <Text style={styles.lineProductName} numberOfLines={2}>
                  {gasSize ? (
                    <>
                      {issuePrefix}{gasSize.kg} kg ×{' '}
                      <Text style={styles.lineQtyValue}>{item.newQty} units</Text>
                    </>
                  ) : (
                    <>
                      {getProductDisplayName(productName) || 'Unknown'} ×{' '}
                      <Text style={styles.lineQtyValue}>{item.newQty} units</Text>
                    </>
                  )}
                </Text>
              </View>
            )}

            <View style={styles.lineUnitPriceRow}>
              <View>
                  <Text style={styles.lineUnitPriceLabel}>{t('saleorderdetails.unitPrice', 'Unit price')}</Text>
                  <Text style={styles.lineUnitPriceValue}>{formatCurrency(unitPrice)}</Text>
              </View>
              <View>
                  <Text style={styles.lineTotalLabel}>{t('saleorderdetails.lineTotal', 'Line total')}</Text>
                  <Text style={styles.lineTotalValue}>{formatCurrency(displayLineTotal)}</Text>
              </View>
            </View>
            <View style={styles.lineTotalRow}/>
          </View>
        </View>
      </View>
    );
  };

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('saleorderdetails.orderNotFound', 'Order not found')}</Text>
      </View>
    );
  }

  const orderIsCancelled = String(order?.state || '') === 'cancel';
  const canPay = !updating && !orderIsCancelled;
  const canCancel = !updating && !canceling && !orderIsCancelled && String(order?.invoice_status || '') !== 'invoiced';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {orderIsCancelled && (
          <View style={styles.cancelBanner}>
            <Ionicons name="close-circle-outline" size={18} color={colors.error || '#c00'} />
            <Text style={styles.cancelBannerText}>{t('saleorderdetails.thisOrderHasBeenCancelled', 'This order has been cancelled.')}</Text>
          </View>
        )}

        {checkoutResumeEntry && !orderIsCancelled && (
          <TouchableOpacity
            style={styles.checkoutResumeBanner}
            onPress={() => {
              if (checkoutResumeEntry.phase === 'payment_proof') {
                navigation.navigate('PaymentProof', {
                  saleOrderId,
                  creditProofRequired: checkoutResumeEntry.invoiceParams.creditProofRequired === true,
                  orderName: checkoutResumeEntry.invoiceParams.orderName,
                });
              } else {
                navigation.navigate('InvoiceScreen', checkoutResumeEntry.invoiceParams);
              }
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="hourglass-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.checkoutResumeBannerTitle}>
                {checkoutResumeEntry.phase === 'payment_proof'
                  ? 'Payment proof not finished'
                  : 'Invoice step not finished'}
              </Text>
              <Text style={styles.checkoutResumeBannerSub}>{t('saleorderdetails.tapToContinue', 'Tap to continue.')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* Order ID + Customer */}
          <View style={styles.customerRow}>
              <View style={styles.customerLeft}>
                  <View style={{ flex: 1 }}>
                      {(order.name || order.id) && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                              <Text style={[styles.customerLabel, { marginBottom: 0 }]}>{t('saleorderdetails.order', 'Order')}</Text>
                              <Text style={[styles.customerName, { fontSize: 15 }]} numberOfLines={1}>
                                  {order.name ?? `#${order.id}`}
                              </Text>
                          </View>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text style={styles.customerName} numberOfLines={1}>
                              {getLocalizedCustomerNameFromOrder(order, appLanguage)}
                          </Text>
                      </View>
                      {(order.city) && (
                          <View style={styles.addressRow}>
                              <Text style={styles.addressText}>
                                  {order.city}
                              </Text>
                              <Text style={styles.addressText}>
                                  {order.street}
                              </Text>
                              <Text style={styles.addressText}>
                                  {order.zip_code}
                              </Text>
                          </View>
                      )}
                  </View>
              </View>
          </View>

        {/* {!isDelivered && qtyChanged && (
          <View style={styles.changedBanner}>
            <Ionicons name="pencil" size={18} color={colors.warning} />
            <Text style={styles.changedBannerText}>
              Quantities changed. Tap "Update" (top right) to save.
            </Text>
          </View>
        )} */}

        {updateError != null && (
          <View style={[styles.changedBanner, { borderLeftColor: colors.error || '#c00' }]}>
            <Ionicons name="alert-circle" size={18} color={colors.error || '#c00'} />
            <Text style={[styles.changedBannerText, { color: colors.error || '#c00' }]}>
              {updateError}
            </Text>
          </View>
        )}

      

        {/* Order lines: title (left) + Modify / Update (right) */}
        <View style={styles.orderLinesHeaderRow}>
          <Text style={styles.sectionTitle}>{t('saleorderdetails.orderLines', 'Order lines')}</Text>
          {!isDelivered && (
            modifyEnabled ? (
              <TouchableOpacity
                style={[styles.modifyUpdateBtn]}
                onPress={updateQty}
                disabled={updating}
                activeOpacity={0.8}
              >
                {updating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.modifyUpdateBtnText]}>{t('saleorderdetails.save', 'Save')}</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.modifyUpdateBtn}
                onPress={() => setModifyEnabled(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.modifyUpdateBtnText}>{t('saleorderdetails.modifyOrder', 'Modify Order')}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
        {lines.length === 0 ? (
          <View style={styles.emptyLines}>
            <Text style={styles.emptyText}>{t('saleorderdetails.noLineItems', 'No line items')}</Text>
          </View>
        ) : (
          lines.map((item) => (
            <View key={item.id}>{renderItem({ item })}</View>
          ))
        )}

          {/* Gross Total: Subtotal (sum price_subtotal), Tax (sum of line tax), Total */}
          <View style={styles.grossTotalCard}>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>{t('saleorderdetails.subTotal', 'Sub Total')}</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(computedSubtotal)}
            </Text>
          </View>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>{t('saleorderdetails.vAT18', 'VAT (18%)')}</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(computedTax)}
            </Text>
          </View>
          <View style={[styles.grossRow, styles.grossTotalRow]}>
            <Text style={styles.grossTotalLabel}>
              Total (with VAT)
            </Text>
            <Text style={styles.grossTotalValue}>
              {formatCurrency(computedTotal)}
            </Text>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Bottom bar: proceed + cancel */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={[styles.payBtn, (!canPay || modifyEnabled || updating || orderIsCancelled) && styles.payBtnDisabled]}
            onPress={() => {
              if (!canPay || orderIsCancelled) return;
              if (isDelivered) {
                const invoiceLineQtys = lines.map((l) => ({
                  lineId: l.id,
                  qty: Number(l.newQty) || 0,
                }));
                navigation.navigate('ProceedPayment', {
                  saleOrderId: order.id,
                  total: computedTotal,
                  subtotal: computedSubtotal,
                  tax: computedTax,
                  deliveryDone: isDeliveryDone === true,
                  invoiceLineQtys,
                });
              } else {
                handleProceedToPayment();
              }
            }}
            disabled={modifyEnabled || updating || orderIsCancelled}
            activeOpacity={0.8}
          >
            <Ionicons name="card-outline" size={22} color="#fff" />
            <Text style={styles.payBtnText}>{t('saleorderdetails.proceedToPayment', 'Proceed to payment')}</Text>
          </TouchableOpacity>

          {!orderIsCancelled && (
            <TouchableOpacity
              style={[styles.cancelBtn, !canCancel && styles.cancelBtnDisabled]}
              onPress={handleOpenCancelFlow}
              disabled={!canCancel}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.error || '#c00'} />
              <Text style={styles.cancelBtnText}>{t('saleorderdetails.cancelOrder', 'Cancel order')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal
        visible={showCancelConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCancelConfirmModal(false)}
      >
        <Pressable
          style={styles.cancelConfirmBackdrop}
          onPress={() => setShowCancelConfirmModal(false)}
        >
          <Pressable style={styles.cancelConfirmCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.cancelConfirmIconWrap}>
              <Ionicons name="warning-outline" size={28} color={colors.error || '#dc2626'} />
            </View>
            <Text style={styles.cancelConfirmTitle}>{t('saleorderdetails.cancelThisOrder', 'Cancel this order?')}</Text>
            <Text style={styles.cancelConfirmMessage}>
              {t(
                'saleorderdetails.theOrderWillBeClosedAndTakenOff',
                "The order will be closed and taken off your delivery list. If the customer still needs a delivery, they will need a new order. You can't undo this step."
              )}
            </Text>
            {order?.name ? (
              <Text style={styles.cancelConfirmOrderLabel} numberOfLines={1}>
                {order.name}
              </Text>
            ) : null}
            <View style={styles.cancelConfirmActions}>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, styles.cancelConfirmBtnSecondary]}
                onPress={() => setShowCancelConfirmModal(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelConfirmBtnTextSecondary}>{t('saleorderdetails.keepOrder', 'Keep order')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, styles.cancelConfirmBtnPrimary]}
                onPress={openCancelReasonModal}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelConfirmBtnTextPrimary}>{t('saleorderdetails.continue', 'Continue')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showCancelModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCancelModal(false)}
      >
        <Pressable style={styles.cancelModalOverlay} onPress={() => setShowCancelModal(false)}>
          <Pressable style={styles.cancelModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.cancelModalHeaderIcon}>
              <Ionicons name="clipboard-outline" size={22} color={colors.primary} />
            </View>
            <Text style={styles.cancelModalTitle}>{t('saleorderdetails.reasonForCancellation', 'Reason for cancellation')}</Text>
            <Text style={styles.cancelModalHint}>
              {t(
                'saleorderdetails.tapTheReasonThatFitsBestTheOrder',
                'Tap the reason that fits best. The order will be closed and removed from your list.'
              )}
            </Text>

            <View style={styles.cancelModalBody}>
              {cancelReasonsLoading ? (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ marginTop: 8, color: colors.textSecondary }}>{t('saleorderdetails.loadingReasons', 'Loading reasons…')}</Text>
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

              {cancelError && (
                <Text style={{ marginTop: spacing.sm, color: colors.error || '#c00', fontSize: 13 }}>
                  {cancelError}
                </Text>
              )}
            </View>

            <View style={styles.cancelModalActions}>
              <TouchableOpacity
                style={[styles.cancelModalBtn, styles.cancelModalBtnSecondary]}
                onPress={() => setShowCancelModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelModalBtnTextSecondary}>{t('saleorderdetails.keepOrder', 'Keep order')}</Text>
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
                  <Text style={styles.cancelModalBtnTextPrimary}>{t('saleorderdetails.cancelOrder', 'Cancel order')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

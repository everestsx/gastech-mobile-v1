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
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';
import {
  buildProductIdToMoveLineIdMap,
  buildProductIdToMoveIdMap,
} from '../services/delivery.service';
import {
  cancelSaleOrderWithReason,
  getCancellationReasonOptions,
} from '../services/saleOrder.service';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getProductDisplayName, getGasSizeFromProductName } from '../utils/productDisplay';
import { getLocalizedCustomerNameFromOrder } from '../utils/customerDisplayName';
import { getProductImageSource } from '../utils/gasImage';
import { lineTaxAtQuantity } from '../utils/orderLineTax.js';
import { getCheckoutResumeEntry } from '../services/checkoutResume.service';

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
export default function SaleOrderDetailsScreen({ route, navigation }) {
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

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [isDelivered, setIsDelivered] = useState(false);
  // True when the picking/delivery is already validated ("done") locally.
  // In that case, lorry stock has already been deducted once, so we should
  // allow editing delivered quantity even if remaining stock is 0.
  const [isDeliveryDone, setIsDeliveryDone] = useState(false);
  const [modifyEnabled, setModifyEnabled] = useState(false);
  const [qtyChanged, setQtyChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [productIdToAvailable, setProductIdToAvailable] = useState({});
  const [productIdToImageUri, setProductIdToImageUri] = useState({});
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

    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qtyUsed = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(line.newQty);
        const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;

        if (productId == null || qtyUsed <= 0) continue;

        const currentStock = productIdToAvailable[productId] ?? 0;
        const newStock = Math.max(0, currentStock - qtyUsed);

        console.log(`[Inventory Update] Product ${productId}: ${currentStock} - ${qtyUsed} = ${newStock}`);


        await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(
          locationId,
          productId,
          newStock
        );

        const allInventory = await vehicleInventoriesDb.getVehicleInventoryByLocationId(locationId);
        console.log('[Inventory Update] Full inventory after update:', JSON.stringify(allInventory));

        const verifyItem = allInventory.find(inv =>
          (inv.product_id === productId || inv.id === productId)
        );
        console.log(`[Inventory Update] Verified new stock:`, verifyItem?.available_quantity);
      }

      await syncQueueDb.enqueue(syncQueueDb.ACTION_INVENTORY_UPDATE, {
        vehicleId,
        locationId,
        updates: lines.map((line, i) => {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
          const qtyUsed = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(line.newQty);
          return {
            productId,
            quantityUsed: qtyUsed,
            newQuantity: Math.max(0, (productIdToAvailable[productId] ?? 0) - qtyUsed)
          };
        }).filter(u => u.productId != null)
      });

      console.log('[Inventory Update] Complete - enqueued for sync');
    } catch (error) {
      console.error('[Inventory Update] Failed:', error);
      throw new Error('Failed to update vehicle inventory');
    }
  }, [order, lines, productIdToAvailable]);
  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      if (!data.order) {
        setOrder(null);
        setLines([]);
        setIsDelivered(false);
        return;
      }
      setOrder(data.order);
      const { picking, moves, moveLines } = await getDeliveryDataFromDB(saleOrderId);
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
      setLines(
        (data.lines || []).map((l) => {
          const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
          const savedDone = pid != null ? qtyDoneByProductId[pid] : null;
          const demand = Number(l.product_uom_qty ?? 0) || 0;
          const initial =
            savedDone != null && savedDone > 0 ? savedDone : demand;
          return { ...l, newQty: String(initial) };
        })
      );
      const imageMap = await productsDb.getProductImageUriMap();
      setProductIdToImageUri(imageMap || {});
      setQtyChanged(false);
      const deliveryDone = ((picking?.state || '') + '').toLowerCase() === 'done';
      setIsDeliveryDone(deliveryDone);
      setIsDelivered(data.order?.invoice_status === 'invoiced');


        const vehicleId = data.order?.vehicle_id != null
            ? (Array.isArray(data.order.vehicle_id) ? data.order.vehicle_id[0] : data.order.vehicle_id)
            : null;

        console.log(`[UI Debug] This order is assigned to Vehicle ID: ${vehicleId}`);

        if (vehicleId != null) {
          try {
            // Get location_id for this vehicle and fetch inventory by location
            const locationId = await getVehicleLocationId(vehicleId);
            console.log(`[UI Debug] Vehicle ${vehicleId} has location_id: ${locationId}`);

            if (locationId) {
              const inventories = await getCachedVehicleInventoryByLocation(locationId);
              const map = {};
              (inventories || []).forEach((inv) => {
                const pid = inv.product_id != null ? inv.product_id : inv.id;
                if (pid != null) {
                  map[pid] = Number(inv.quantity) ?? 0;
                }
              });
              setProductIdToAvailable(map);
            } else {
              console.warn(`[UI Debug] No location_id found for vehicle ${vehicleId}`);
              setProductIdToAvailable({});
            }
          } catch (error) {
            console.error('Failed to load vehicle inventory:', error);
            setProductIdToAvailable({});
          }
        } else {
          setProductIdToAvailable({});
        }
    } catch (_) {
      setOrder(null);
      setLines([]);
      setIsDelivered(false);
      setIsDeliveryDone(false);
      setProductIdToImageUri({});
    } finally {
      setLoading(false);
    }
  }, [saleOrderId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    let active = true;
    const loadReasons = async () => {
      setCancelReasonsLoading(true);
      try {
        const reasons = await getCancellationReasonOptions();
        if (!active) return;
        const normalized = Array.isArray(reasons) ? reasons : [];
        setCancelReasons(normalized);
        setCancelReason((prev) => prev || normalized[0]?.value || '');
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

  const effectiveCancelReasons = cancelReasons.length > 0
    ? cancelReasons
    : [
        { value: 'shop_closed', label: 'Shop closed' },
        { value: 'customer_not_available', label: 'Customer not available' },
        { value: 'customer_cancelled', label: 'Customer cancelled' },
        { value: 'wrong_order', label: 'Wrong order' },
        { value: 'duplicate_order', label: 'Duplicate order' },
        { value: 'other', label: 'Other' },
      ];

    const setLineQty = useCallback((lineId, value) => {
      setUpdateError(null);
      const trimmed = value.replace(/[^0-9.]/g, '');
      const num = trimmed === '' ? 0 : parseFloat(trimmed);

      let safeQty = isNaN(num) || num < 0 ? 0 : num;

      setLines((prev) => {
        const line = prev.find((l) => l.id === lineId);
        if (line) {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
          const baseQty = Number(line.product_uom_qty ?? 0) || 0;

          // productIdToAvailable[productId] is the on-hand stock in the lorry.
          // Max that can be delivered for this line = on-hand stock total.
          if (productId != null && productIdToAvailable[productId] !== undefined) {
            const onHandTotal = Number(productIdToAvailable[productId]) || 0;
            const maxAllowed = onHandTotal;
            safeQty = Math.min(safeQty, maxAllowed);
          }
        }

        return prev.map((l) =>
          l.id === lineId ? { ...l, newQty: trimmed === '' ? '' : String(safeQty) } : l
        );
      });

      setQtyChanged(true);
    }, [productIdToAvailable, isDeliveryDone]);
const changeQtyBy = useCallback((lineId, delta) => {
  setUpdateError(null);
  const MAX_QTY = 9999;

  setLines((prev) =>
    prev.map((l) => {
      if (l.id !== lineId) return l;

      const current = parseFloat(l.newQty) || 0;
      let next = current + delta;

      const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      const baseQty = Number(l.product_uom_qty ?? 0) || 0;

      if (productId != null && productIdToAvailable[productId] !== undefined) {
        const onHandTotal = Number(productIdToAvailable[productId]) || 0;
        const maxAllowed = Math.min(MAX_QTY, onHandTotal);
        next = Math.max(0, Math.min(maxAllowed, next));
      } else {
        next = Math.max(0, Math.min(MAX_QTY, next));
      }

      return { ...l, newQty: String(next) };
    })
  );

  setQtyChanged(true);
}, [productIdToAvailable, isDeliveryDone]);
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

  // 2) Stock constraint (only applies when increasing beyond baseQty)
  // productIdToAvailable[pid] represents remaining "extra stock" in the lorry.
  const baseTotalByProductId = {};
  const requestedTotalByProductId = {};

  for (const l of lines) {
    const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
    if (productId == null) continue;

    const baseQty = Number(l.product_uom_qty ?? 0) || 0;
    const requestedQty = Number(l.newQty ?? 0) || 0;

    baseTotalByProductId[productId] = (baseTotalByProductId[productId] || 0) + baseQty;
    requestedTotalByProductId[productId] = (requestedTotalByProductId[productId] || 0) + requestedQty;
  }

  for (const pid of Object.keys(requestedTotalByProductId)) {
    const productId = Number(pid);
    const onHandTotal = productIdToAvailable[productId];
    if (onHandTotal === undefined) continue;

    const baseTotal = baseTotalByProductId[productId] || 0;
    const requestedTotal = requestedTotalByProductId[productId] || 0;

    const maxAllowedTotal = Math.min(Number(onHandTotal) || 0, baseTotal + Math.max(0, Number(onHandTotal) || 0));
    if (requestedTotal > maxAllowedTotal) {
      const lineForName = lines.find((l) => {
        const pid2 = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
        return Number(pid2) === productId;
      });
      const productName = lineForName
        ? getProductDisplayName(lineForName.product_id?.[1] ?? lineForName.name ?? '')
        : `Product ${productId}`;

      const extraRequested = requestedTotal - baseTotal;
      const stockHint = Number(onHandTotal) || 0;
      return `Insufficient stock for "${productName}". Available (lorry): ${stockHint}, requested over order base: ${extraRequested}`;
    }
  }

  return null;
}, [lines, productIdToAvailable, isDeliveryDone]);
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
      const targets = openPickings.length > 0 ? openPickings : [];

      const orderLineUpdates = [];
      if (demandEdit) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
          const oldDem = Number(l.product_uom_qty) || 0;
          if (newVal !== oldDem) {
            orderLineUpdates.push({ lineId: l.id, product_uom_qty: newVal });
            await saleOrderLinesDb.updateSaleOrderLineQtyLocal(l.id, newVal);
          }
        }
        if (orderLineUpdates.length > 0) {
          await saleOrdersDb.updateSaleOrderAmountsFromLines(order.id);
        }
      }

      const pickingsOut = [];

      for (const picking of targets) {
        const moves = await stockMovesDb.getStockMovesByPickingId(picking.id);
        if (!moves?.length) continue;

        /** Use real stock.move ids from this picking only — not picking.move_ids (can be wrong or Many2one tuples in DB). */
        const idsForLines = moves.map((m) => m.id).filter((id) => id != null);
        const moveLines = await stockMoveLinesDb.getStockMoveLinesByMoveIds(idsForLines);
        const productIdToMoveLineId = buildProductIdToMoveLineIdMap(moves, moveLines);
        const productIdToMoveId = buildProductIdToMoveIdMap(moves);
        const moveByProductId = {};
        (moves || []).forEach((m) => {
          const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
          if (pid != null) moveByProductId[pid] = m;
        });
        const qtyDoneByMoveLineId = {};
        (moveLines || []).forEach((ml) => {
          qtyDoneByMoveLineId[ml.id] = Number(ml.qty_done) || 0;
        });

        const moveUpdates = [];
        const moveLineUpdates = [];
        const deliveryLines = [];

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const newVal = effectiveQtys[i] != null ? Number(effectiveQtys[i]) : Number(l.newQty);
          const productId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
          if (productId == null) continue;

          const moveId = productIdToMoveId[productId];
          if (moveId == null) continue;

          const moveRow = moveByProductId[productId];
          const currentMoveDemand = Number(moveRow?.product_uom_qty) || 0;

          if (demandEdit) {
            if (newVal !== currentMoveDemand) {
              await stockMovesDb.updateStockMoveQtyLocal(moveId, newVal);
              moveUpdates.push({ moveId, product_uom_qty: newVal });
            }
          } else if (newVal > currentMoveDemand) {
            await stockMovesDb.updateStockMoveQtyLocal(moveId, newVal);
            moveUpdates.push({ moveId, product_uom_qty: newVal });
          } else if (newVal === 0 && currentMoveDemand > 0) {
            /** Cancelled / not delivered: zero demand on stock.move so Odoo does not keep the line waiting (qty_done 0 + demand > 0). */
            await stockMovesDb.updateStockMoveQtyLocal(moveId, 0);
            moveUpdates.push({ moveId, product_uom_qty: 0 });
          }

          if (!demandEdit) {
            deliveryLines.push({ moveId, productId, qty_done: newVal });
          }

          const moveLineId = productIdToMoveLineId[productId];
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
              moveLineUpdates.push({ moveLineId, qty_done: nextDone });
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

      const payload = {
        saleOrderId: order.id,
        orderLineUpdates,
        saleOrderLineDeliveredUpdates,
        pickings: pickingsOut,
      };
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

  if (productId == null || productIdToAvailable[productId] === undefined) return null;
  const availableExtra = Number(productIdToAvailable[productId]) || 0;
  const baseQty = Number(line.product_uom_qty ?? 0) || 0;
  const maxAllowed = baseQty + Math.max(0, availableExtra);
  if (qty > maxAllowed) {
    return `Insufficient stock (max allowed for this order: ${maxAllowed})`;
  }
  return null;
}, [lines, productIdToAvailable]);
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
      await loadDetails();
      setModifyEnabled(false);
      setQtyChanged(false);
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
      Alert.alert('Reason needed', 'Pick a cancel reason from the list.');
      return;
    }

    setCancelError(null);
    setCanceling(true);
    try {
      await cancelSaleOrderWithReason(order.id, cancelReason);
      await saleOrdersDb.updateSaleOrderStateLocal(order.id, 'cancel');

      const pickings = await stockPickingsDb.getStockPickingsBySaleId(order.id);
      await Promise.all((pickings || []).map((p) => stockPickingsDb.updatePickingStateLocal(p.id, 'cancel')));

      await syncQueueDb.deletePendingItemsBySaleOrderId(order.id);

      setShowCancelModal(false);
      navigation.goBack();
    } catch (err) {
      setCancelError(err?.message ?? 'Cancel failed. Try again.');
    } finally {
      setCanceling(false);
    }
  }, [cancelReason, canceling, navigation, order?.id, order?.state]);

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
      deliveryDone: true,
      deliveryPayload,
      invoiceLineQtys,
    });
  } catch (err) {
    setUpdateError(err?.message ?? 'Delivery update failed. Try again.');
  } finally {
    setUpdating(false);
  }
}, [order, lines, validateQuantities, hasQtyChanges, applyQtyDoneAndValidate, updateVehicleInventory, isDeliveryDone, navigation]);
  /** Per-product total qty in this order (current newQty values). Used for dynamic "remaining after order" stock. */
  const totalQtyByProductId = useMemo(() => {
    const map = {};
    lines.forEach((l) => {
      const pid = l.product_id != null && Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      if (pid != null) {
        map[pid] = (map[pid] || 0) + (Number(l.newQty) || 0);
      }
    });
    return map;
  }, [lines]);

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
    const gasAccent =
      gasSize && GAS_SIZE_COLORS[gasSize.size] ? GAS_SIZE_COLORS[gasSize.size] : FALLBACK_ACCENT;
    const productId = item.product_id != null && Array.isArray(item.product_id) ? item.product_id[0] : item.product_id;
    const availableStock = productId != null ? productIdToAvailable[productId] : undefined;
    const totalOrderedForProduct = productId != null ? (totalQtyByProductId[productId] ?? 0) : 0;
    const remainingAfterOrder = availableStock !== undefined ? availableStock - totalOrderedForProduct : undefined;
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
                          {gasSize.kg} kg ×
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
                {availableStock !== undefined && (
                  <View style={styles.availableStockRow}>
                    <Text style={styles.availableStockText}>
                      Available: {availableStock}
                      {/* {remainingAfterOrder !== undefined && (
                        <>
                          {'  ·  '}
                          <Text style={[styles.availableStockText, remainingAfterOrder < 0 && { color: colors.error || '#c00', fontWeight: '700' }]}>
                            After this order: {remainingAfterOrder}
                          </Text>
                        </>
                      )} */}
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
                      {gasSize.kg} kg ×{' '}
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
                  <Text style={styles.lineUnitPriceLabel}>Unit price</Text>
                  <Text style={styles.lineUnitPriceValue}>{formatCurrency(unitPrice)}</Text>
              </View>
              <View>
                  <Text style={styles.lineTotalLabel}>Line total</Text>
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
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }

  const orderIsCancelled = String(order?.state || '') === 'cancel';
  const canPay = !updating && !orderIsCancelled;
  const canCancel = !updating && !canceling && !orderIsCancelled && String(order?.invoice_status || '') !== 'invoiced';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
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
            <Text style={styles.cancelBannerText}>This order has been cancelled.</Text>
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
              <Text style={styles.checkoutResumeBannerSub}>Tap to continue.</Text>
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
                              <Text style={[styles.customerLabel, { marginBottom: 0 }]}>Order</Text>
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
          <Text style={styles.sectionTitle}>Order lines</Text>
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
                  <Text style={[styles.modifyUpdateBtnText]}>Save</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.modifyUpdateBtn}
                onPress={() => setModifyEnabled(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.modifyUpdateBtnText}>Modify Order</Text>
              </TouchableOpacity>
            )
          )}
        </View>
        {lines.length === 0 ? (
          <View style={styles.emptyLines}>
            <Text style={styles.emptyText}>No line items</Text>
          </View>
        ) : (
          lines.map((item) => (
            <View key={item.id}>{renderItem({ item })}</View>
          ))
        )}

          {/* Gross Total: Subtotal (sum price_subtotal), Tax (sum of line tax), Total */}
          <View style={styles.grossTotalCard}>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>Sub Total</Text>
            <Text style={styles.grossValue}>
              {formatCurrency(computedSubtotal)}
            </Text>
          </View>
          <View style={styles.grossRow}>
            <Text style={styles.grossLabel}>VAT (18%)</Text>
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
                  deliveryDone: true,
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
            <Text style={styles.payBtnText}>Proceed to payment</Text>
          </TouchableOpacity>

          {!orderIsCancelled && (
            <TouchableOpacity
              style={[styles.cancelBtn, !canCancel && styles.cancelBtnDisabled]}
              onPress={handleOpenCancelFlow}
              disabled={!canCancel}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.error || '#c00'} />
              <Text style={styles.cancelBtnText}>Cancel order</Text>
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
            <Text style={styles.cancelConfirmTitle}>Cancel this order?</Text>
            <Text style={styles.cancelConfirmMessage}>
              The order will be closed and taken off your delivery list. If the customer still needs a delivery, they will need a new order. You can&apos;t undo this step.
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
                <Text style={styles.cancelConfirmBtnTextSecondary}>Keep order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelConfirmBtn, styles.cancelConfirmBtnPrimary]}
                onPress={openCancelReasonModal}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelConfirmBtnTextPrimary}>Continue</Text>
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
            <Text style={styles.cancelModalTitle}>Reason for cancellation</Text>
            <Text style={styles.cancelModalHint}>
              Tap the reason that fits best. The order will be closed and removed from your list.
            </Text>

            <View style={styles.cancelModalBody}>
              {cancelReasonsLoading ? (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ marginTop: 8, color: colors.textSecondary }}>Loading reasons…</Text>
                </View>
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
                <Text style={styles.cancelModalBtnTextSecondary}>Keep order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelModalBtn, styles.cancelModalBtnPrimary]}
                onPress={handleCancelOrder}
                disabled={canceling}
                activeOpacity={0.8}
              >
                {canceling ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.cancelModalBtnTextPrimary}>Cancel order</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

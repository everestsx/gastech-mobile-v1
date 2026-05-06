import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getSaleOrderDetailsFromDB,
  getVehicleLocationId,
  getCachedVehicleInventoryByLocation,
  getCachedVehicleInventory,
  getUserSession,
} from '../services/sync.service';
import * as syncQueueDb from '../database/syncQueue.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';
import { setCheckoutResumeFromPayment } from '../services/checkoutResume.service';
import { buildEmptyCylinderChatterBody } from '../services/proofAttachment.service';
import {
  canonicalKgFromName,
  findEmptyCylinderProductIdForKg,
  isEmptyCylinderName,
  isGasCylinderName,
  isNewIssueName,
  labelFromKg,
} from '../utils/cylinderCatalog';

function qtyByLineIdMap(rows) {
  const m = {};
  for (const row of rows || []) {
    if (row?.lineId == null) continue;
    m[String(row.lineId)] = Number(row.qty) || 0;
  }
  return m;
}

function qtyClose(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

const DISPLAY_KG_SIZES = [2.4, 5, 12.5, 37.5];
const REASON_PRESET_KEYS = [
  'loanReturnPending',
  'newIssueReplacement',
  'cylinderShortageAtCustomer',
  'pendingEmptyCollection',
];
const REASON_LABEL_FALLBACKS = {
  en: {
    loanReturnPending: 'Loan return pending',
    newIssueReplacement: 'New issue replacement',
    cylinderShortageAtCustomer: 'Cylinder shortage at customer',
    pendingEmptyCollection: 'Pending empty collection',
  },
  si: {
    loanReturnPending: 'ණයට දුන් සිලින්ඩර ආපසු ලබාදීම ඉතිරිව ඇත',
    newIssueReplacement: 'නව නිකුත් කිරීමක් සඳහා ප්‍රතිස්ථාපනය',
    cylinderShortageAtCustomer: 'පාරිභෝගිකයා අසල හිස් සිලින්ඩර හිඟය',
    pendingEmptyCollection: 'හිස් සිලින්ඩර එකතු කිරීම ඉතිරිව ඇත',
  },
  ta: {
    loanReturnPending: 'கடனாக கொடுத்த சிலிண்டர் திருப்பி அளிப்பு நிலுவையில் உள்ளது',
    newIssueReplacement: 'புதிய வழங்கலுக்கான மாற்று',
    cylinderShortageAtCustomer: 'வாடிக்கையாளரிடம் காலி சிலிண்டர் குறைவு',
    pendingEmptyCollection: 'காலி சிலிண்டர் சேகரிப்பு நிலுவையில் உள்ளது',
  },
};
const DEFAULT_MATCHED_EMPTY_NOTE = 'All empty cylinders were collected as per the delivered gas quantity.';

function parseVehicleIdFromOrder(order) {
  if (!order || order.vehicle_id == null) return null;
  const raw = Array.isArray(order.vehicle_id) ? order.vehicle_id[0] : order.vehicle_id;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function EmptyCylinderCollectionScreen({ route, navigation }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    saleOrderId,
    invoiceNavParams,
    invoiceLineQtys,
  } = route.params || {};

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [selectedReasonKey, setSelectedReasonKey] = useState('');
  const resolvedLanguage = useMemo(
    () => String(i18n?.resolvedLanguage || i18n?.language || 'en').split('-')[0].toLowerCase(),
    [i18n?.language, i18n?.resolvedLanguage]
  );
  const reasonOptions = useMemo(
    () =>
      REASON_PRESET_KEYS.map((key) => ({
        key,
        label:
          t(`emptycylindercollection.reasons.${key}`, { defaultValue: '' }) ||
          REASON_LABEL_FALLBACKS[resolvedLanguage]?.[key] ||
          REASON_LABEL_FALLBACKS.en[key] ||
          key,
      })),
    [resolvedLanguage, t]
  );

  const loadDefaults = useCallback(async () => {
    setLoading(true);
    try {
      const details = await getSaleOrderDetailsFromDB(saleOrderId);
      const lines = Array.isArray(details?.lines) ? details.lines : [];
      const qtyMap = qtyByLineIdMap(invoiceLineQtys);
      const byKg = new Map();
      for (const kg of DISPLAY_KG_SIZES) {
        byKg.set(kg, {
          kg,
          deliveredGasQty: 0,
          newIssueQty: 0,
          emptyQty: 0,
          emptyProductId: null,
        });
      }

      for (const line of lines) {
        const rawName = line?.product_id?.[1] ?? line?.name ?? '';
        const kg = canonicalKgFromName(rawName);
        if (kg == null) continue;
        const qty = qtyMap[String(line.id)] ?? (Number(line?.product_uom_qty) || 0);
        if (qty <= 0) continue;

        if (!byKg.has(kg)) {
          byKg.set(kg, {
            kg,
            deliveredGasQty: 0,
            newIssueQty: 0,
            emptyQty: 0,
            emptyProductId: null,
          });
        }
        const entry = byKg.get(kg);
        if (isGasCylinderName(rawName)) entry.deliveredGasQty += qty;
        if (isNewIssueName(rawName)) entry.newIssueQty += qty;
      }

      const [locationId, productMap] = await Promise.all([
        details?.order?.vehicle_id
          ? getVehicleLocationId(Array.isArray(details.order.vehicle_id) ? details.order.vehicle_id[0] : details.order.vehicle_id)
          : Promise.resolve(null),
        productsDb.getProductsMap(),
      ]);

      if (locationId != null) {
        const inv = await getCachedVehicleInventoryByLocation(locationId);
        for (const row of inv || []) {
          const pid = row?.product_id != null ? Number(row.product_id) : null;
          if (!Number.isFinite(pid)) continue;
          const name = productMap?.[pid] || row?.product_name || '';
          if (!isEmptyCylinderName(name)) continue;
          const kg = canonicalKgFromName(name);
          if (kg == null) continue;
          if (!byKg.has(kg)) {
            byKg.set(kg, {
              kg,
              deliveredGasQty: 0,
              newIssueQty: 0,
              emptyQty: 0,
              emptyProductId: null,
            });
          }
          const entry = byKg.get(kg);
          if (entry.emptyProductId == null) entry.emptyProductId = pid;
        }
      }

      for (const [, entry] of byKg) {
        if (entry.emptyProductId == null) {
          const fromCatalog = findEmptyCylinderProductIdForKg(productMap, entry.kg);
          if (fromCatalog != null) entry.emptyProductId = fromCatalog;
        }
      }

      const prepared = Array.from(byKg.values())
        .map((entry) => {
          const autoEmpty = Math.max(0, Math.round((entry.deliveredGasQty - entry.newIssueQty) * 1000) / 1000);
          return {
            ...entry,
            emptyQty: autoEmpty,
            defaultEmptyQty: autoEmpty,
          };
        })
        .sort((a, b) => Number(a.kg) - Number(b.kg));

      setRows(prepared);
    } finally {
      setLoading(false);
    }
  }, [invoiceLineQtys, saleOrderId]);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  const hasAdjustment = useMemo(
    () => rows.some((r) => !qtyClose(r.emptyQty, r.defaultEmptyQty)),
    [rows]
  );

  const totalCollected = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.emptyQty) || 0), 0),
    [rows]
  );

  const setQty = useCallback((kg, text) => {
    const cleaned = String(text || '').replace(/[^0-9.]/g, '');
    const nextNum = cleaned === '' ? 0 : Math.max(0, Number(cleaned) || 0);
    setRows((prev) =>
      prev.map((r) => (r.kg === kg ? { ...r, emptyQty: nextNum } : r))
    );
  }, []);

  const changeQtyBy = useCallback((kg, delta) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.kg !== kg) return r;
        const next = Math.max(0, (Number(r.emptyQty) || 0) + delta);
        return { ...r, emptyQty: next };
      })
    );
  }, []);

  const buildEntriesPayload = useCallback(() => {
    return rows.map((r) => ({
      kg: Number(r.kg),
      deliveredGasQty: Number(r.deliveredGasQty) || 0,
      newIssueQty: Number(r.newIssueQty) || 0,
      emptyCollectedQty: Number(r.emptyQty) || 0,
      defaultEmptyQty: Number(r.defaultEmptyQty) || 0,
      emptyProductId: r.emptyProductId != null ? Number(r.emptyProductId) : null,
    }));
  }, [rows]);

  const persistAndNavigate = useCallback(
    async (emptyCylinderChatterBody) => {
      setSaving(true);
      try {
        const details = await getSaleOrderDetailsFromDB(saleOrderId);
        const order = details?.order || {};
        const session = await getUserSession();
        const orderVehicleId = parseVehicleIdFromOrder(order);
        const sessionVehicleId = Number(session?.vehicleId);
        const vehicleId =
          orderVehicleId != null
            ? orderVehicleId
            : (Number.isFinite(sessionVehicleId) && sessionVehicleId > 0 ? sessionVehicleId : null);
        let locationId = vehicleId != null ? await getVehicleLocationId(Number(vehicleId)) : null;

        const emptyCylinderEntries = buildEntriesPayload();
        const positiveEmptyRows = emptyCylinderEntries.filter((r) => Number(r.emptyCollectedQty) > 0);

        if (locationId == null && vehicleId != null) {
          // Fallback for vehicles missing warehouse mapping but already having local inventory rows.
          const inventoryByVehicle = await getCachedVehicleInventory(Number(vehicleId));
          const derivedLocationId = (inventoryByVehicle || [])
            .map((r) => Number(r?.location_id))
            .find((id) => Number.isFinite(id) && id > 0);
          if (derivedLocationId != null) locationId = derivedLocationId;
        }

        if (positiveEmptyRows.length > 0 && locationId == null) {
          throw new Error(
            t(
              'emptycylindercollection.vehicleStockLocationMissing',
              'Vehicle stock location is missing for this order. Empty cylinder stock was not saved to avoid incorrect inventory.'
            )
          );
        }

        if (locationId != null) {
          const inventory = await getCachedVehicleInventoryByLocation(locationId);
          const byProductId = {};
          const inventoryQueueUpdates = [];
          const unresolvedKg = [];
          for (const item of inventory || []) {
            const pid = item?.product_id != null ? Number(item.product_id) : null;
            if (!Number.isFinite(pid)) continue;
            byProductId[pid] = Number(item.quantity) || 0;
          }
          for (const row of emptyCylinderEntries) {
            if (row.emptyCollectedQty <= 0) continue;
            if (row.emptyProductId == null) {
              unresolvedKg.push(row.kg);
              continue;
            }
            const current = Number(byProductId[row.emptyProductId]) || 0;
            const nextQty = Math.max(0, current + Number(row.emptyCollectedQty));
            const emptyName = (await productsDb.getProductById(Number(row.emptyProductId)))?.name || '';
            await vehicleInventoriesDb.upsertVehicleInventoryQuantityByLocation(
              Number(locationId),
              Number(vehicleId),
              Number(row.emptyProductId),
              emptyName,
              nextQty
            );
            inventoryQueueUpdates.push({
              productId: Number(row.emptyProductId),
              quantityUsed: -Math.abs(Number(row.emptyCollectedQty) || 0),
              newQuantity: nextQty,
              incrementQuantity: Math.abs(Number(row.emptyCollectedQty) || 0),
            });
          }
          if (unresolvedKg.length > 0) {
            throw new Error(
              t(
                'emptycylindercollection.emptyProductMissingForSizes',
                `Empty-cylinder product mapping is missing for size(s): ${unresolvedKg.join(', ')} kg. Please sync master data and try again.`
              )
            );
          }
          if (inventoryQueueUpdates.length > 0) {
            const inventoryPayload = {
              saleOrderId: Number(saleOrderId),
              vehicleId: Number(vehicleId),
              locationId: Number(locationId),
              updates: inventoryQueueUpdates,
              holdUntilComplete: true,
            };
            const existingInventoryUpdate =
              await syncQueueDb.getPendingInventoryUpdateItemBySaleOrderId(Number(saleOrderId));
            if (existingInventoryUpdate?.id != null) {
              const existingPayload = existingInventoryUpdate.payload || {};
              const existingUpdates = Array.isArray(existingPayload?.updates) ? existingPayload.updates : [];
              const mergedByProduct = new Map();
              for (const u of existingUpdates) {
                const pid = Number(u?.productId);
                if (!Number.isFinite(pid)) continue;
                mergedByProduct.set(pid, {
                  productId: pid,
                  quantityUsed: Number(u?.quantityUsed) || 0,
                  newQuantity: Number(u?.newQuantity) || 0,
                  incrementQuantity: Number(u?.incrementQuantity) || 0,
                });
              }
              for (const u of inventoryQueueUpdates) {
                const pid = Number(u?.productId);
                if (!Number.isFinite(pid)) continue;
                const prev = mergedByProduct.get(pid) || {
                  productId: pid,
                  quantityUsed: 0,
                  newQuantity: 0,
                  incrementQuantity: 0,
                };
                const nextIncrement = (Number(prev.incrementQuantity) || 0) + (Number(u?.incrementQuantity) || 0);
                mergedByProduct.set(pid, {
                  productId: pid,
                  quantityUsed: Number(prev.quantityUsed) + (Number(u?.quantityUsed) || 0),
                  newQuantity: Number(u?.newQuantity),
                  incrementQuantity: nextIncrement,
                });
              }
              await syncQueueDb.updateQueueItemPayload(existingInventoryUpdate.id, {
                ...existingPayload,
                saleOrderId: Number(saleOrderId),
                vehicleId: Number(vehicleId),
                locationId: Number(locationId),
                holdUntilComplete: true,
                updates: Array.from(mergedByProduct.values()),
              });
            } else {
              await syncQueueDb.enqueue(syncQueueDb.ACTION_INVENTORY_UPDATE, inventoryPayload);
            }
          }
        }

        const pendingPayment = await syncQueueDb.getPendingPaymentItemBySaleOrderId(Number(saleOrderId));
        if (pendingPayment?.id != null) {
          const base = { ...(pendingPayment.payload || {}), emptyCylinderEntries };
          if (emptyCylinderChatterBody && String(emptyCylinderChatterBody).trim()) {
            base.emptyCylinderChatterBody = String(emptyCylinderChatterBody).trim();
          } else {
            delete base.emptyCylinderChatterBody;
          }
          await syncQueueDb.updateQueueItemPayload(pendingPayment.id, base);
        }

        await setCheckoutResumeFromPayment(Number(saleOrderId), {
          ...(invoiceNavParams || {}),
          emptyCylinderEntries,
          ...(emptyCylinderChatterBody && String(emptyCylinderChatterBody).trim()
            ? { emptyCylinderChatterBody: String(emptyCylinderChatterBody).trim() }
            : {}),
        });

        navigation.replace('InvoiceScreen', {
          ...(invoiceNavParams || {}),
          emptyCylinderEntries,
          ...(emptyCylinderChatterBody && String(emptyCylinderChatterBody).trim()
            ? { emptyCylinderChatterBody: String(emptyCylinderChatterBody).trim() }
            : {}),
        });
      } catch (e) {
        Alert.alert(
          t('emptycylindercollection.error', 'Error'),
          e?.message || t('emptycylindercollection.couldNotSaveEmptyCylinderDetails', 'Could not save empty cylinder details.')
        );
      } finally {
        setSaving(false);
      }
    },
    [buildEntriesPayload, invoiceNavParams, navigation, saleOrderId]
  );

  const onPressConfirm = useCallback(() => {
    if (hasAdjustment) {
      setSelectedReasonKey('');
      setReasonModalVisible(true);
      return;
    }
    void persistAndNavigate(DEFAULT_MATCHED_EMPTY_NOTE);
  }, [hasAdjustment, persistAndNavigate]);

  const onConfirmReason = useCallback(() => {
    const selectedReason = reasonOptions.find((reason) => reason.key === selectedReasonKey);
    const selected = String(selectedReason?.label || '').trim();
    if (!selected) {
      Alert.alert(
        t('emptycylindercollection.reasonRequired', 'Reason required'),
        t('emptycylindercollection.pleaseSelectAReason', 'Please select a reason.')
      );
      return;
    }
    const body = buildEmptyCylinderChatterBody(buildEntriesPayload(), selected);
    setReasonModalVisible(false);
    void persistAndNavigate(body);
  }, [buildEntriesPayload, persistAndNavigate, reasonOptions, selectedReasonKey, t]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.md },
        hero: {
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          backgroundColor: colors.primary + '18',
          borderWidth: 1,
          borderColor: colors.primary + '44',
        },
        heroIcon: { marginBottom: 6 },
        title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 2 },
        heroText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
        cardsWrap: { gap: spacing.sm },
        card: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.lg,
          padding: spacing.sm + 2,
        },
        cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
        sizeLabel: { fontSize: 16, fontWeight: '800', color: colors.text },
        gasRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: borderRadius.md,
          backgroundColor: colors.background,
        },
        gasLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
        gasVal: { fontSize: 16, fontWeight: '800', color: colors.text },
        sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
        qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
        qtyBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        qtyInput: {
          flex: 1,
          minWidth: 80,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          paddingVertical: 8,
          paddingHorizontal: 12,
          color: colors.text,
          fontSize: 18,
          fontWeight: '800',
          textAlign: 'center',
        },
        summary: {
          marginTop: spacing.xs,
          marginBottom: spacing.sm,
          padding: spacing.sm + 2,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        summaryLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
        summaryVal: { fontSize: 18, fontWeight: '900', color: colors.primary },
        footerBar: {
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
        },
        cta: {
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
        },
        ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
        hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 16 },
        modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
        modalCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          width: '90%',
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          maxHeight: '80%',
        },
        modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
        modalSub: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
        reasonOption: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.xs,
          backgroundColor: colors.background,
        },
        reasonOptionOn: {
          borderColor: colors.primary,
          backgroundColor: colors.primary + '12',
        },
        reasonOptionText: { fontSize: 14, color: colors.text, fontWeight: '700' },
        customLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: spacing.xs, marginBottom: 6 },
        customInput: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 10,
          paddingHorizontal: spacing.md,
          minHeight: 56,
          color: colors.text,
          fontSize: 14,
          textAlignVertical: 'top',
          backgroundColor: colors.background,
        },
        modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.md },
        modalBtnSecondary: {
          flex: 1,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        modalBtnPrimary: {
          flex: 1,
          paddingVertical: 14,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          backgroundColor: colors.primary,
        },
        modalBtnSecondaryText: { fontSize: 16, fontWeight: '700', color: colors.text },
        modalBtnPrimaryText: { fontSize: 16, fontWeight: '800', color: '#fff' },
      }),
    [colors]
  );

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + 72 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{t('emptycylindercollection.emptyCollectedCylinder', 'Empty Collected Cylinder')}</Text>
          <Text style={styles.heroText}>
            {t(
              'emptycylindercollection.reviewCollectedEmptiesBySizeIfASize',
              'Review collected empties by size. If a size has no collection, it still appears as 0.'
            )}
          </Text>
        </View>

        <View style={styles.cardsWrap}>
          {rows.map((row) => {
            const adjusted = !qtyClose(row.emptyQty, row.defaultEmptyQty);
            return (
              <View style={styles.card} key={String(row.kg)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.sizeLabel}>{labelFromKg(row.kg)}</Text>
                  {adjusted ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="alert-circle" size={16} color="#b45309" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#b45309' }}>
                        {t('emptycylindercollection.changed', 'Changed')}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.gasRow}>
                  <Text style={styles.gasLabel}>{t('emptycylindercollection.gasDelivered', 'Gas delivered')}</Text>
                  <Text style={styles.gasVal}>{Number(row.deliveredGasQty) || 0}</Text>
                </View>

                <Text style={styles.sectionLabel}>{t('emptycylindercollection.emptiesCollected', 'Empties collected')}</Text>
                <View style={styles.qtyRow}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQtyBy(row.kg, -1)} activeOpacity={0.85}>
                    <Ionicons name="remove" size={22} color={colors.primary} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    value={String(row.emptyQty)}
                    onChangeText={(text) => setQty(row.kg, text)}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQtyBy(row.kg, 1)} activeOpacity={0.85}>
                    <Ionicons name="add" size={22} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>{t('emptycylindercollection.totalEmptiesCollected', 'Total empties collected')}</Text>
          <Text style={styles.summaryVal}>{totalCollected.toLocaleString('en-IN')}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footerBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity style={styles.cta} onPress={() => void onPressConfirm()} disabled={saving} activeOpacity={0.88}>
          {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={24} color="#fff" />}
          <Text style={styles.ctaText}>{t('emptycylindercollection.continue', 'Continue')}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {hasAdjustment
            ? t('emptycylindercollection.reasonRequiredBecauseQtyChanged', 'You changed quantity, so reason is required.')
            : t('emptycylindercollection.continueToInvoice', 'Continue to invoice.')}
        </Text>
      </View>

      <Modal visible={reasonModalVisible} animationType="slide" transparent onRequestClose={() => setReasonModalVisible(false)}>
        <Pressable style={styles.modalWrap} onPress={() => setReasonModalVisible(false)}>
          <Pressable style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('emptycylindercollection.reasonForChange', 'Reason for change')}</Text>
            <Text style={styles.modalSub}>
              {t('emptycylindercollection.selectOneReasonToContinue', 'Select one reason to continue.')}
            </Text>

            {reasonOptions.map((reason) => {
              const on = selectedReasonKey === reason.key;
              return (
                <TouchableOpacity
                  key={reason.key}
                  style={[styles.reasonOption, on && styles.reasonOptionOn]}
                  onPress={() => setSelectedReasonKey(reason.key)}
                  activeOpacity={0.88}
                >
                  <Text style={styles.reasonOptionText}>{reason.label}</Text>
                </TouchableOpacity>
              );
            })}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => {
                  setReasonModalVisible(false);
                }}
              >
                <Text style={styles.modalBtnSecondaryText}>{t('emptycylindercollection.back', 'Back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnPrimary} onPress={onConfirmReason}>
                <Text style={styles.modalBtnPrimaryText}>{t('emptycylindercollection.saveAndContinue', 'Save and continue')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB, getVehicleLocationId, getCachedVehicleInventoryByLocation } from '../services/sync.service';
import * as syncQueueDb from '../database/syncQueue.js';
import * as vehicleInventoriesDb from '../database/vehicleInventories.js';
import * as productsDb from '../database/products.js';
import { setCheckoutResumeFromPayment } from '../services/checkoutResume.service';
import {
  canonicalKgFromName,
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

export default function EmptyCylinderCollectionScreen({ route, navigation }) {
  const { colors } = useTheme();
  const {
    saleOrderId,
    invoiceNavParams,
    invoiceLineQtys,
  } = route.params || {};

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadDefaults = useCallback(async () => {
    setLoading(true);
    try {
      const details = await getSaleOrderDetailsFromDB(saleOrderId);
      const lines = Array.isArray(details?.lines) ? details.lines : [];
      const qtyMap = qtyByLineIdMap(invoiceLineQtys);
      const byKg = new Map();

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
          if (kg == null || !byKg.has(kg)) continue;
          const entry = byKg.get(kg);
          if (entry.emptyProductId == null) entry.emptyProductId = pid;
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
  const resetToDefault = useCallback((kg) => {
    setRows((prev) =>
      prev.map((r) => (r.kg === kg ? { ...r, emptyQty: Number(r.defaultEmptyQty) || 0 } : r))
    );
  }, []);

  const handleContinue = useCallback(async () => {
    setSaving(true);
    try {
      const details = await getSaleOrderDetailsFromDB(saleOrderId);
      const order = details?.order || {};
      const vehicleId = order?.vehicle_id != null
        ? (Array.isArray(order.vehicle_id) ? order.vehicle_id[0] : order.vehicle_id)
        : null;
      const locationId = vehicleId != null ? await getVehicleLocationId(vehicleId) : null;

      const emptyCylinderEntries = rows.map((r) => ({
        kg: Number(r.kg),
        deliveredGasQty: Number(r.deliveredGasQty) || 0,
        newIssueQty: Number(r.newIssueQty) || 0,
        emptyCollectedQty: Number(r.emptyQty) || 0,
        emptyProductId: r.emptyProductId != null ? Number(r.emptyProductId) : null,
      }));

      if (locationId != null) {
        const inventory = await getCachedVehicleInventoryByLocation(locationId);
        const byProductId = {};
        const inventoryQueueUpdates = [];
        for (const item of inventory || []) {
          const pid = item?.product_id != null ? Number(item.product_id) : null;
          if (!Number.isFinite(pid)) continue;
          byProductId[pid] = Number(item.quantity ?? item.available_quantity) || 0;
        }
        for (const row of emptyCylinderEntries) {
          if (row.emptyProductId == null || row.emptyCollectedQty <= 0) continue;
          const current = Number(byProductId[row.emptyProductId]) || 0;
          const nextQty = Math.max(0, current + Number(row.emptyCollectedQty));
          await vehicleInventoriesDb.updateVehicleInventoryQuantityByLocation(
            Number(locationId),
            Number(row.emptyProductId),
            nextQty
          );
          inventoryQueueUpdates.push({
            productId: Number(row.emptyProductId),
            quantityUsed: -Math.abs(Number(row.emptyCollectedQty) || 0),
            newQuantity: nextQty,
          });
        }
        if (inventoryQueueUpdates.length > 0) {
          await syncQueueDb.enqueue(syncQueueDb.ACTION_INVENTORY_UPDATE, {
            saleOrderId: Number(saleOrderId),
            vehicleId: Number(vehicleId),
            locationId: Number(locationId),
            updates: inventoryQueueUpdates,
          });
        }
      }

      const pendingPayment = await syncQueueDb.getPendingPaymentItemBySaleOrderId(Number(saleOrderId));
      if (pendingPayment?.id != null) {
        const nextPayload = {
          ...(pendingPayment.payload || {}),
          emptyCylinderEntries,
        };
        await syncQueueDb.updateQueueItemPayload(pendingPayment.id, nextPayload);
      }

      await setCheckoutResumeFromPayment(Number(saleOrderId), {
        ...(invoiceNavParams || {}),
        emptyCylinderEntries,
      });

      navigation.replace('InvoiceScreen', {
        ...(invoiceNavParams || {}),
        emptyCylinderEntries,
      });
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not save empty cylinder details.');
    } finally {
      setSaving(false);
    }
  }, [invoiceNavParams, navigation, rows, saleOrderId]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
    title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6 },
    subtitle: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginBottom: spacing.md },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
    qtyInputWrap: {
      marginTop: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    qtyButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyInput: {
      minWidth: 110,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      borderRadius: borderRadius.md,
      paddingVertical: 8,
      paddingHorizontal: 10,
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'right',
    },
    resetBtn: {
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    resetBtnText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    summary: {
      marginTop: spacing.sm,
      marginBottom: spacing.md,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      backgroundColor: colors.primary + '14',
      borderWidth: 1,
      borderColor: colors.primary + '33',
    },
    summaryText: { fontSize: 14, fontWeight: '700', color: colors.text },
    cta: {
      marginTop: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  }), [colors]);

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Empty Cylinder Collection</Text>
      <Text style={styles.subtitle}>
        Default values are auto-calculated from delivered gas quantity. Adjust only if the collected empty count is different.
      </Text>

      {rows.map((row) => (
        <View style={styles.card} key={String(row.kg)}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{labelFromKg(row.kg)}</Text>
            <Ionicons name="cube-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.meta}>Delivered gas: {row.deliveredGasQty}</Text>
          <Text style={styles.meta}>New issue: {row.newIssueQty}</Text>
          <Text style={styles.meta}>Default empty: {row.defaultEmptyQty}</Text>
          <View style={styles.qtyInputWrap}>
            <Text style={[styles.meta, { marginTop: 0, fontWeight: '700' }]}>Empty collected</Text>
            <TouchableOpacity style={styles.qtyButton} onPress={() => changeQtyBy(row.kg, -1)} activeOpacity={0.8}>
              <Ionicons name="remove" size={18} color={colors.primary} />
            </TouchableOpacity>
            <TextInput
              style={styles.qtyInput}
              value={String(row.emptyQty)}
              onChangeText={(text) => setQty(row.kg, text)}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={styles.qtyButton} onPress={() => changeQtyBy(row.kg, 1)} activeOpacity={0.8}>
              <Ionicons name="add" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.resetBtn} onPress={() => resetToDefault(row.kg)} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.resetBtnText}>Reset to default</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.summary}>
        <Text style={styles.summaryText}>Total empty cylinders collected: {totalCollected}</Text>
      </View>

      <TouchableOpacity style={styles.cta} onPress={() => void handleContinue()} disabled={saving} activeOpacity={0.85}>
        {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-forward-circle-outline" size={22} color="#fff" />}
        <Text style={styles.ctaText}>Continue to invoice</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

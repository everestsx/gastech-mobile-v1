import { useTranslation } from 'react-i18next';
import { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as localPaymentsDb from '../database/localPayments.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { getSaleOrderDetailsFromDB, notifyLocalInventoryChanged, signalDashboardPendingUploadStarted, startCheckoutUploadInBackground } from '../services/sync.service';
import {
  applyInventoryUpdatesToLocalDb,
  applyLocalGasInventoryForSaleOrder,
} from '../utils/localInventoryApply.js';
import { empty } from '../database/dbHelpers.js';
import { isSqliteFullError, sqliteFullUserMessage } from '../database/sqliteMaintenance.js';
import { markSaleOrderDeliveredInUi } from '../utils/completedOrderUi.js';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';
import { clearCheckoutResume } from '../services/checkoutResume.service';
import { finalizeLocalInvoiceSnapshotFromPayment } from '../utils/localInvoiceSnapshot.js';

const MAX_PHOTOS = 3;

export default function PaymentProofScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { saleOrderId, creditProofRequired = false, orderName, customerLabel } = route.params || {};
  const soId = Number(saleOrderId);
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const completeGuardRef = useRef(false);

  const canComplete = !creditProofRequired || photos.length > 0;

  const persistPhotos = useCallback(async () => {
    if (!photos.length) return;
    const timestamp = Date.now();
    for (let i = 0; i < photos.length; i++) {
      const uri = photos[i];
      if (!uri || typeof uri !== 'string') continue;
      try {
        const ext = (uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `proof_${soId}_${timestamp}_${i}.${ext}`;
        const source = new FileSystem.File(uri);
        if (!source.exists) continue;
        const dest = new FileSystem.File(FileSystem.Paths.document, fileName);
        source.copy(dest);
        const info = dest.info();
        const destPath = dest.uri;
        if (!info?.exists || (info.size ?? 0) < 100) continue;
        await offlineAttachmentsDb.insert({
          sale_order_id: soId,
          local_file_path: destPath,
          file_name: fileName,
          mime_type: ext === 'png' ? 'image/png' : 'image/jpeg',
        });
      } catch (e) {
        console.warn('[PaymentProof] save failed', { index: i, message: e?.message });
      }
    }
  }, [photos, soId]);

  /** Release queue holds + local picking state so background sync can start immediately. */
  const releaseQueueHoldsForSo = useCallback(async () => {
    const latestPayment = await syncQueueDb.getPendingPaymentItemBySaleOrderId(soId);
    const paymentPayload = latestPayment?.payload || {};

    if (latestPayment) {
      const payload = { ...paymentPayload };
      delete payload.holdUntilComplete;
      await syncQueueDb.updateQueueItemPayload(latestPayment.id, payload, { suppressWake: true });
    }

    const pendingRows = await syncQueueDb.getPending().catch(() => []);
    for (const row of pendingRows || []) {
      const payload = row?.payload || {};
      const rowSo = Number(payload.saleOrderId ?? payload.sale_id ?? payload.sale_order_id);
      if (rowSo !== soId) continue;
      if (payload.holdUntilComplete !== true && payload.holdUntilPayment !== true) continue;
      if (latestPayment && Number(row.id) === Number(latestPayment.id)) continue;
      const next = { ...payload };
      delete next.holdUntilComplete;
      delete next.holdUntilPayment;
      await syncQueueDb.updateQueueItemPayload(row.id, next, { suppressWake: true });
    }

    const deliveryRow = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(soId);
    if (deliveryRow) {
      const payload = { ...(deliveryRow.payload || {}) };
      delete payload.holdUntilPayment;
      const invQtys = paymentPayload?.invoiceLineQtys;
      if (Array.isArray(invQtys) && invQtys.length > 0) {
        payload.invoiceLineQtys = invQtys;
        payload.saleOrderLineDeliveredUpdates = invQtys
          .map((row) => ({
            lineId: Number(row?.lineId),
            qty_delivered: Math.round(Number(row?.qty) * 1000) / 1000,
          }))
          .filter(
            (u) =>
              Number.isFinite(u.lineId) &&
              u.lineId > 0 &&
              Number.isFinite(u.qty_delivered) &&
              u.qty_delivered >= 0
          );
      }
      await syncQueueDb.updateQueueItemPayload(deliveryRow.id, payload, { suppressWake: true });
      const pickings = Array.isArray(payload.pickings) ? payload.pickings : [];
      if (pickings.length > 0) {
        for (const p of pickings) {
          if (p?.pickingId != null) {
            await stockPickingsDb.updatePickingStateLocal(Number(p.pickingId), 'done');
          }
        }
      } else if (payload.pickingId != null) {
        await stockPickingsDb.updatePickingStateLocal(Number(payload.pickingId), 'done');
      }
    }

    const inventoryRow = await syncQueueDb.getPendingInventoryUpdateItemBySaleOrderId(soId);
    if (inventoryRow) {
      const payload = { ...(inventoryRow.payload || {}) };
      delete payload.holdUntilComplete;
      await syncQueueDb.updateQueueItemPayload(inventoryRow.id, payload, { suppressWake: true });
    }
  }, [soId]);

  /** Persist local invoice + line snapshot before dashboard (amounts + VAT for My Invoices). */
  const persistLocalInvoiceAtCheckout = useCallback(async () => {
    const latestPayment = await syncQueueDb.getPendingPaymentItemBySaleOrderId(soId);
    const paymentPayload = latestPayment?.payload || {};
    const data = await getSaleOrderDetailsFromDB(soId);
    const orderInfo = data?.order || {};
    const existingLocalInv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(soId);

    const fromBackend =
      orderInfo?.invoice_number != null && String(orderInfo.invoice_number).trim() !== ''
        ? String(orderInfo.invoice_number).trim()
        : '';
    const fromLocalRow =
      existingLocalInv?.invoice_number != null && String(existingLocalInv.invoice_number).trim() !== ''
        ? String(existingLocalInv.invoice_number).trim()
        : '';
    let invoiceNumber = fromBackend || fromLocalRow;
    if (!invoiceNumber) {
      try {
        invoiceNumber = await getOrAssignInvoiceNumber(soId, {
          saleOrderName: orderInfo?.name,
          backendInvoiceNumber: orderInfo?.invoice_number,
        });
      } catch (e) {
        console.warn('[PaymentProof] resolve invoice number', e?.message || e);
        invoiceNumber = orderInfo?.name ? `TEMP-${soId}` : '—';
      }
    }

    const total = Number(paymentPayload.total ?? orderInfo.amount_total ?? 0) || 0;
    const untaxed = Number(orderInfo.amount_untaxed ?? total) || 0;
    const tax = Number(orderInfo.amount_tax ?? Math.max(0, total - untaxed)) || 0;
    const checkoutDriverName =
      paymentPayload?.driverName != null && String(paymentPayload.driverName).trim()
        ? String(paymentPayload.driverName).trim()
        : '';

    await localInvoicesDb.upsertLocalInvoice({
      sale_order_id: soId,
      invoice_number: invoiceNumber,
      amount_total: total,
      amount_untaxed: untaxed,
      amount_tax: tax,
      state: 'posted',
      customer_signature_data: existingLocalInv?.customer_signature_data ?? '',
      driver_signature_data: existingLocalInv?.driver_signature_data ?? '',
      driver_name: checkoutDriverName,
    });

    const invQtys =
      (Array.isArray(paymentPayload?.invoiceLineQtys) && paymentPayload.invoiceLineQtys.length > 0
        ? paymentPayload.invoiceLineQtys
        : null) || [];
    if (invQtys.length > 0) {
      await finalizeLocalInvoiceSnapshotFromPayment(soId, invQtys);
    }
  }, [soId]);

  /** Local invoice/payments/inventory — safe to finish after dashboard navigation. */
  const finalizeLocalCheckoutState = useCallback(async () => {
    const latestPayment = await syncQueueDb.getPendingPaymentItemBySaleOrderId(soId);
    const paymentPayload = latestPayment?.payload || {};

    const inventoryRow = await syncQueueDb.getPendingInventoryUpdateItemBySaleOrderId(soId);
    if (inventoryRow) {
      const payload = inventoryRow.payload || {};
      const locationId = Number(payload.locationId);
      const vehicleId = Number(payload.vehicleId);
      const updates = Array.isArray(payload.updates) ? payload.updates : [];
      if (Number.isFinite(locationId) && locationId > 0 && updates.length > 0) {
        const emptyStillPending = updates.filter(
          (u) => Number(u?.incrementQuantity) > 0 && u?.appliedLocally !== true
        );
        if (emptyStillPending.length > 0) {
          payload.updates = await applyInventoryUpdatesToLocalDb(
            locationId,
            vehicleId,
            updates,
            { incrementsOnly: true }
          );
        }
        notifyLocalInventoryChanged();
        await syncQueueDb.updateQueueItemPayload(inventoryRow.id, payload);
      }
    }

    const data = await getSaleOrderDetailsFromDB(soId);
    const orderInfo = data?.order || {};
    const existingLocalInv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(soId);
    const fromBackend = orderInfo?.invoice_number != null && String(orderInfo.invoice_number).trim() !== '' ? String(orderInfo.invoice_number).trim() : '';
    const fromLocalRow =
      existingLocalInv?.invoice_number != null && String(existingLocalInv.invoice_number).trim() !== ''
        ? String(existingLocalInv.invoice_number).trim()
        : '';
    let invoiceNumber = fromBackend || fromLocalRow;
    if (!invoiceNumber) {
      try {
        invoiceNumber = await getOrAssignInvoiceNumber(soId, {
          saleOrderName: orderInfo?.name,
          backendInvoiceNumber: orderInfo?.invoice_number,
        });
      } catch (e) {
        console.warn('[PaymentProof] resolve invoice number', e?.message || e);
        invoiceNumber = orderInfo?.name ? `TEMP-${soId}` : '—';
      }
    }
    const total = Number(paymentPayload.total ?? orderInfo.amount_total ?? 0) || 0;
    const untaxed = Number(orderInfo.amount_untaxed ?? total) || 0;
    const tax = Number(orderInfo.amount_tax ?? 0) || 0;

    const checkoutDriverName =
      paymentPayload?.driverName != null && String(paymentPayload.driverName).trim()
        ? String(paymentPayload.driverName).trim()
        : '';

    const invoiceId = await localInvoicesDb.upsertLocalInvoice({
      sale_order_id: soId,
      invoice_number: invoiceNumber,
      amount_total: total,
      amount_untaxed: untaxed,
      amount_tax: tax,
      state: 'posted',
      customer_signature_data: existingLocalInv?.customer_signature_data ?? '',
      driver_signature_data: existingLocalInv?.driver_signature_data ?? '',
      driver_name: checkoutDriverName,
    });

    const payments = Array.isArray(paymentPayload.payments) ? paymentPayload.payments : [];
    const paymentRows = payments.map((p) => ({
      sale_order_id: soId,
      payment_type: String(p?.type || '').toLowerCase() === 'check' ? 'cheque' : String(p?.type || '').toLowerCase(),
      amount: Number(p?.amount || 0),
      journal_id: p?.journalId ?? null,
      check_number: String(p?.type || '').toLowerCase() === 'check' ? empty(p?.checkNumber || paymentPayload?.checkNumber) : '',
      bank_name: String(p?.type || '').toLowerCase() === 'check' ? empty(paymentPayload?.chequeBankName) : '',
    }));
    await localPaymentsDb.replacePaymentsForInvoice(invoiceId, paymentRows);

    const cash = paymentRows.reduce((s, r) => s + (r.payment_type === 'cash' ? Number(r.amount || 0) : 0), 0);
    const cheque = paymentRows.reduce((s, r) => s + (r.payment_type === 'cheque' ? Number(r.amount || 0) : 0), 0);
    const credit = paymentRows.reduce((s, r) => s + (r.payment_type === 'credit' ? Number(r.amount || 0) : 0), 0);
    const primary = credit > 0 ? 'credit' : cheque > 0 ? 'cheque' : 'cash';
    await saleOrdersDb.updateSaleOrderPaymentTypeLocal(soId, primary, credit);
    await saleOrdersDb.updateSaleOrderAmountsFromLines(soId);
    await saleOrdersDb.updateSaleOrderInvoiceStatusLocal(soId, 'invoiced');

    const deliveryRow = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(soId);
    const invQtys =
      (Array.isArray(paymentPayload?.invoiceLineQtys) && paymentPayload.invoiceLineQtys.length > 0
        ? paymentPayload.invoiceLineQtys
        : null) ||
      (Array.isArray(deliveryRow?.payload?.invoiceLineQtys) && deliveryRow.payload.invoiceLineQtys.length > 0
        ? deliveryRow.payload.invoiceLineQtys
        : null) ||
      [];
    if (invQtys.length > 0) {
      await finalizeLocalInvoiceSnapshotFromPayment(soId, invQtys);
    }
  }, [soId]);

  const handleComplete = useCallback(async () => {
    if (!Number.isFinite(soId) || soId <= 0) {
      Alert.alert('Error', 'Missing order.');
      return;
    }
    if (creditProofRequired && photos.length === 0) {
      Alert.alert('Photo required', 'Add at least one photo for credit payment.');
      return;
    }
    if (completeGuardRef.current) return;
    completeGuardRef.current = true;
    setSaving(true);
    try {
      if (photos.length > 0) {
        await persistPhotos();
      }
      await applyLocalGasInventoryForSaleOrder(soId);
      await releaseQueueHoldsForSo();
      await clearCheckoutResume(soId);
      await persistLocalInvoiceAtCheckout();
      await saleOrdersDb.updateSaleOrderInvoiceStatusLocal(soId, 'invoiced');
      markSaleOrderDeliveredInUi(soId);
      signalDashboardPendingUploadStarted();
      notifyLocalInventoryChanged();

      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen: 'Dashboard' } }],
      });
      setSaving(false);

      startCheckoutUploadInBackground(soId, {
        includeAttachments: creditProofRequired || photos.length > 0,
      });

      void (async () => {
        try {
          await finalizeLocalCheckoutState();
          await clearCheckoutResume(soId);
        } catch (e) {
          console.warn('[PaymentProof] background finalize', e?.message || e);
        }
      })();
    } catch (e) {
      const msg = isSqliteFullError(e) ? sqliteFullUserMessage() : (e?.message || 'Something went wrong. Try again.');
      Alert.alert('Error', msg);
      setSaving(false);
    } finally {
      completeGuardRef.current = false;
    }
  }, [
    soId,
    creditProofRequired,
    photos.length,
    persistPhotos,
    releaseQueueHoldsForSo,
    persistLocalInvoiceAtCheckout,
    finalizeLocalCheckoutState,
    navigation,
  ]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        scroll: { padding: spacing.lg, paddingBottom: 120 + insets.bottom },
        hero: {
          alignItems: 'center',
          paddingVertical: spacing.xl,
          marginBottom: spacing.md,
        },
        heroIconWrap: {
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: (colors.primary || '#6366f1') + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        title: {
          fontSize: 22,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        subtitle: {
          fontSize: 15,
          color: colors.textSecondary,
          textAlign: 'center',
          lineHeight: 22,
          paddingHorizontal: spacing.md,
        },
        badge: {
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 8,
          borderRadius: borderRadius.lg,
          backgroundColor: creditProofRequired ? (colors.warning || '#d97706') + '22' : colors.surface,
          borderWidth: 1,
          borderColor: creditProofRequired ? (colors.warning || '#d97706') + '55' : colors.border,
        },
        badgeText: {
          fontSize: 13,
          fontWeight: '700',
          color: creditProofRequired ? colors.warning ?? '#b45309' : colors.textSecondary,
          textAlign: 'center',
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          padding: spacing.lg,
          marginBottom: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
        rowBtns: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
        pickBtn: {
          flex: 1,
          minHeight: 108,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: (colors.primary || '#6366f1') + '44',
          borderStyle: 'dashed',
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        pickBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
        thumbWrap: { width: 88, height: 88, borderRadius: borderRadius.md, overflow: 'hidden', position: 'relative' },
        thumb: { width: '100%', height: '100%', backgroundColor: colors.background },
        remove: {
          position: 'absolute',
          top: 4,
          right: 4,
          backgroundColor: 'rgba(255,255,255,0.95)',
          borderRadius: 14,
        },
        footer: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.md) + 8,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        primaryBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          backgroundColor: colors.primary,
          paddingVertical: 16,
          borderRadius: borderRadius.lg,
        },
        primaryBtnDisabled: { opacity: 0.45 },
        primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
        meta: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
        confirmBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'center',
          padding: spacing.lg,
        },
        confirmCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        confirmTitle: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
        confirmText: { marginTop: spacing.sm, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
        confirmActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
        confirmBtn: { flex: 1, paddingVertical: 13, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
        confirmBtnKeep: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
        confirmBtnYes: { backgroundColor: colors.primary },
        confirmBtnKeepText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
        confirmBtnYesText: { fontSize: 15, fontWeight: '800', color: '#fff' },
      }),
    [colors, insets.bottom, creditProofRequired]
  );

  if (!Number.isFinite(soId) || soId <= 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{t('paymentproof.missingOrder', 'Missing order.')}</Text>
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.lg }]} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>{t('paymentproof.goBack', 'Go back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="camera" size={40} color={colors.primary} />
          </View>
          <Text style={styles.title}>{t('paymentproof.paymentProof', 'Payment proof')}</Text>
          <Text style={styles.subtitle}>
            {creditProofRequired
              ? 'Credit: add at least one clear photo (receipt, agreement, or handover).'
              : 'Optional photos for your records. You can finish without any.'}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {creditProofRequired ? 'Credit — photo required' : 'Cash/cheque — photos optional'}
            </Text>
          </View>
          {orderName ? (
            <Text style={styles.meta}>{empty(orderName)}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add photos ({photos.length} / {MAX_PHOTOS})</Text>
          <View style={styles.rowBtns}>
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={async () => {
                if (photos.length >= MAX_PHOTOS) return;
                const { status } = await ImagePicker.requestCameraPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission', 'Allow camera to take a photo.');
                  return;
                }
                const result = await ImagePicker.launchCameraAsync({
                  mediaTypes: ['images'],
                  allowsEditing: false,
                  quality: 0.85,
                });
                if (!result.canceled && result.assets?.[0]?.uri) {
                  setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, result.assets[0].uri] : p));
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={32} color={colors.primary} />
              <Text style={styles.pickBtnText}>{t('paymentproof.takePhoto', 'Take photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={async () => {
                if (photos.length >= MAX_PHOTOS) return;
                const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission', 'Allow photos to pick from gallery.');
                  return;
                }
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  allowsEditing: false,
                  quality: 0.85,
                });
                if (!result.canceled && result.assets?.[0]?.uri) {
                  setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, result.assets[0].uri] : p));
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="images-outline" size={32} color={colors.primary} />
              <Text style={styles.pickBtnText}>{t('paymentproof.gallery', 'Gallery')}</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 ? (
            <View style={styles.thumbs}>
              {photos.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.remove}
                    onPress={() => setPhotos((p) => p.filter((_, i) => i !== index))}
                    hitSlop={10}
                  >
                    <Ionicons name="close-circle" size={24} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canComplete && styles.primaryBtnDisabled]}
          onPress={() => {
            if (!canComplete || saving) return;
            setConfirmVisible(true);
          }}
          disabled={saving || !canComplete}
          activeOpacity={0.88}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-done-circle" size={24} color="#fff" />
              <Text style={styles.primaryBtnText}>{t('paymentproof.completePayment', 'Complete payment')}</Text>
            </>
          )}
        </TouchableOpacity>
        {!creditProofRequired ? (
          <Text style={[styles.meta, { marginTop: spacing.sm }]}>
            No credit in this payment — you can complete without photos.
          </Text>
        ) : null}
      </View>
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <Pressable style={styles.confirmBackdrop} onPress={() => setConfirmVisible(false)}>
          <Pressable style={styles.confirmCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.confirmTitle}>{t('paymentproof.completeThisOrder', 'Complete this order?')}</Text>
            <Text style={styles.confirmText}>
              Once completed, delivery and invoice are finalized. You can no longer edit this order flow.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnKeep]}
                onPress={() => setConfirmVisible(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmBtnKeepText}>{t('paymentproof.keepOrder', 'Keep order')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnYes]}
                onPress={() => {
                  setConfirmVisible(false);
                  void handleComplete();
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmBtnYesText}>{t('paymentproof.yesComplete', 'Yes, complete')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

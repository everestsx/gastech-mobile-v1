import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Image,
  Modal,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import SignatureCanvas from 'react-native-signature-canvas';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedJournals, getSaleOrderDetailsFromDB, getDeliveryDataFromDB, getUserSession, getLastSyncTime } from '../services/sync.service';
import { getVehicleJournalsByLicensePlate } from '../services/vehicle.service';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as stockPickingsDb from '../database/stockPickings.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as localPaymentsDb from '../database/localPayments.js';

import { JOURNAL_CODE_CASH, JOURNAL_CODE_CHEQUE } from '../constants/journals';
import { SRI_LANKA_BANKS } from '../constants/sriLankaBanks';
import { formatAmount } from '../utils/format';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';

const PAYMENT_CASH = 'cash';
const PAYMENT_CHECK = 'cheque';
const PAYMENT_CREDIT = 'credit';

export default function ProceedPaymentScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { setHideSyncIndicator } = useSync();
  const { saleOrderId, total, subtotal, tax, deliveryDone, deliveryPayload } = route.params || {};
  const orderTotal = Number(total) || 0;
  // Keep payments consistent with 2-decimal currency precision to avoid tiny float remainders
  // turning a fully-paid order into a "partial" one.
  const orderTotalRounded = Math.round(orderTotal * 100) / 100;
  const orderSubtotal = subtotal != null ? Number(subtotal) : null;
  const orderTax = tax != null ? Number(tax) : null;
  const [loading, setLoading] = useState(false);
  const [journalsLoading, setJournalsLoading] = useState(true);
  const [journals, setJournals] = useState([]);
  const [vehicleJournalIds, setVehicleJournalIds] = useState({ cashJournalId: null, chequeJournalId: null });
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState([PAYMENT_CASH]);
  const [cashAmount, setCashAmount] = useState(() => (orderTotalRounded > 0 ? formatAmount(orderTotalRounded) : ''));
  const [checkAmount, setCheckAmount] = useState('');
  const [lastEditedAmount, setLastEditedAmount] = useState(PAYMENT_CASH);
  const [selectedJournalId, setSelectedJournalId] = useState(null);
  const [checkNumber, setCheckNumber] = useState('');
  const [selectedLocalBankId, setSelectedLocalBankId] = useState(null);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const cashInputRef = useRef(null);
  const checkInputRef = useRef(null);
  const customerSignatureRef = useRef(null);
  const driverSignatureRef = useRef(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureStep, setSignatureStep] = useState('customer'); // 'customer' | 'driver'
  const [customerSignatureData, setCustomerSignatureData] = useState(null);
  const [driverSignatureData, setDriverSignatureData] = useState(null);
  const [editingField, setEditingField] = useState(null);

  // Use only vehicle-specific journals for Cash and Cheque (cash_journal_id / check_journal_id from fleet.vehicle).
  const cashJournals = useMemo(() => {
    if (vehicleJournalIds.cashJournalId == null) return [];
    const match = (journals || []).filter((j) => j.id === vehicleJournalIds.cashJournalId);
    return match;
  }, [journals, vehicleJournalIds.cashJournalId]);
  const cashJournalPreferred = useMemo(() => {
    if (vehicleJournalIds.cashJournalId != null && cashJournals.length > 0) {
      return cashJournals.find((j) => j.id === vehicleJournalIds.cashJournalId) || cashJournals[0];
    }
    return null;
  }, [cashJournals, vehicleJournalIds.cashJournalId]);

  const chequeJournals = useMemo(() => {
    if (vehicleJournalIds.chequeJournalId == null) return [];
    return (journals || []).filter((j) => j.id === vehicleJournalIds.chequeJournalId);
  }, [journals, vehicleJournalIds.chequeJournalId]);
  const chequeJournalInternal = useMemo(() => {
    if (vehicleJournalIds.chequeJournalId != null && chequeJournals.length > 0) {
      return chequeJournals.find((j) => j.id === vehicleJournalIds.chequeJournalId) || chequeJournals[0];
    }
    return null;
  }, [chequeJournals, vehicleJournalIds.chequeJournalId]);
  const bankJournals = useMemo(
    () => (journals || []).filter((j) => j.type === 'bank'),
    [journals]
  );
  const journalsForType = selectedPaymentMethods.includes(PAYMENT_CHECK) ? chequeJournals : [];
  const hasCashSelected = selectedPaymentMethods.includes(PAYMENT_CASH);
  const hasChequeSelected = selectedPaymentMethods.includes(PAYMENT_CHECK);
  const hasCreditSelected = selectedPaymentMethods.includes(PAYMENT_CREDIT);

  const cashAmountNum = useMemo(() => {
    if (!hasCashSelected) return 0;
    const n = parseFloat(String(cashAmount).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }, [cashAmount, hasCashSelected]);

  const checkAmountNum = useMemo(() => {
    if (!hasChequeSelected) return 0;
    const n = parseFloat(String(checkAmount).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }, [checkAmount, hasChequeSelected]);

  const paymentAmounts = useMemo(() => {
    let cash = hasCashSelected ? cashAmountNum : 0;
    let cheque = hasChequeSelected ? checkAmountNum : 0;

    if (!hasCreditSelected) {
      if (hasCashSelected && !hasChequeSelected) {
        cash = orderTotalRounded;
      } else if (!hasCashSelected && hasChequeSelected) {
        cheque = orderTotalRounded;
      } else if (hasCashSelected && hasChequeSelected) {
        if (lastEditedAmount === PAYMENT_CHECK) {
          const rem = Math.max(0, Math.round((orderTotalRounded - cheque) * 100) / 100);
          cash = rem;
        } else {
          const rem = Math.max(0, Math.round((orderTotalRounded - cash) * 100) / 100);
          cheque = rem;
        }
      }
    }

    const rawRemaining = Math.round((orderTotalRounded - cash - cheque) * 100) / 100;
    const credit = hasCreditSelected ? Math.max(0, rawRemaining <= 0.01 ? 0 : rawRemaining) : 0;
    const total = Math.round((cash + cheque + credit) * 100) / 100;
    const overpaid = total > orderTotalRounded + 0.01;

    return {
      cash,
      cheque,
      credit,
      total,
      overpaid,
    };
  }, [
    hasCashSelected,
    hasChequeSelected,
    hasCreditSelected,
    cashAmountNum,
    checkAmountNum,
    orderTotalRounded,
    lastEditedAmount,
  ]);

  const cashPayAmount = paymentAmounts.cash;
  const chequePayAmount = paymentAmounts.cheque;
  const creditAmountNum = paymentAmounts.credit;
  const hasAnyPayment = paymentAmounts.total > 0;
  const remainingCreditLabel = useMemo(() => {
    if (creditAmountNum <= 0) return 'Credit Amount';
    const hasCash = cashAmountNum > 0;
    const hasCheque = checkAmountNum > 0;
    if (hasCash && hasCheque) return 'Remaining after Cash & Cheque';
    if (hasCash) return 'Remaining after Cash';
    if (hasCheque) return 'Remaining after Cheque';
    return 'Credit Amount';
  }, [creditAmountNum, cashAmountNum, checkAmountNum]);

  const checkNumberTrimmed = useMemo(() => (checkNumber != null ? String(checkNumber).trim() : ''), [checkNumber]);
  const selectedLocalBank = useMemo(
    () => (selectedLocalBankId ? SRI_LANKA_BANKS.find((b) => b.id === selectedLocalBankId) : null),
    [selectedLocalBankId]
  );
  const filteredBanks = useMemo(() => {
    if (selectedLocalBankId && selectedLocalBank) return [selectedLocalBank];
    const q = (bankSearchQuery || '').trim().toLowerCase();
    if (!q) return SRI_LANKA_BANKS;
    return SRI_LANKA_BANKS.filter((b) => (b.name || '').toLowerCase().includes(q));
  }, [selectedLocalBankId, selectedLocalBank, bankSearchQuery]);
  // Cash/Cheque require vehicle-specific journal IDs (cash_journal_id / check_journal_id)
  const paymentComplete =
    selectedPaymentMethods.length > 0 &&
    hasAnyPayment &&
    !paymentAmounts.overpaid &&
    Math.abs(paymentAmounts.total - orderTotalRounded) <= 0.01 &&
    (cashPayAmount <= 0 || vehicleJournalIds.cashJournalId != null) &&
    (chequePayAmount <= 0 || (vehicleJournalIds.chequeJournalId != null && checkNumberTrimmed !== '' && selectedLocalBankId != null)) &&
    (creditAmountNum <= 0 || true);

  const canProceed = paymentComplete;

  const loadJournals = useCallback(async () => {
    setJournalsLoading(true);
    try {
      const [list, user, lastSync] = await Promise.all([
        getCachedJournals(),
        getUserSession(),
        getLastSyncTime(),
      ]);
      setJournals(Array.isArray(list) ? list : []);
      setHasSyncedOnce(lastSync != null && String(lastSync).trim() !== '');
      const licensePlate = user?.licensePlate || user?.license_plate || '';
      const vehicleId = user?.vehicleId ?? null;
      if (licensePlate) {
        const vehicleJournals = await getVehicleJournalsByLicensePlate(licensePlate, vehicleId);
        setVehicleJournalIds({
          cashJournalId: vehicleJournals.cashJournalId ?? null,
          chequeJournalId: vehicleJournals.chequeJournalId ?? null,
        });
      } else {
        setVehicleJournalIds({ cashJournalId: null, chequeJournalId: null });
      }
    } catch (_) {
      setJournals([]);
      setVehicleJournalIds({ cashJournalId: null, chequeJournalId: null });
    } finally {
      setJournalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJournals();
  }, [loadJournals]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', loadJournals);
    return () => unsub?.();
  }, [loadJournals, navigation]);

  useEffect(() => {
    if (selectedPaymentMethods.includes(PAYMENT_CHECK) && (chequeJournalInternal ?? chequeJournals[0])) {
      setSelectedJournalId(chequeJournalInternal?.id ?? chequeJournals[0]?.id ?? null);
    }
  }, [selectedPaymentMethods, chequeJournals, chequeJournalInternal]);

  useEffect(() => {
    setHideSyncIndicator(true);
    return () => setHideSyncIndicator(false);
  }, [setHideSyncIndicator]);

  // Auto-fill amount values based on selected methods only.
  // Method selection remains fully manual.
  useEffect(() => {
    const nextCash = hasCashSelected ? formatAmount(cashPayAmount) : '';
    const nextCheque = hasChequeSelected ? formatAmount(chequePayAmount) : '';

    if (hasCashSelected) {
      if (editingField !== PAYMENT_CASH && cashAmount !== nextCash) {
        setCashAmount(nextCash);
      }
    } else if (cashAmount !== '') {
      setCashAmount('');
    }

    if (hasChequeSelected) {
      if (editingField !== PAYMENT_CHECK && checkAmount !== nextCheque) {
        setCheckAmount(nextCheque);
      }
    } else if (checkAmount !== '') {
      setCheckAmount('');
    }
  }, [hasCashSelected, hasChequeSelected, cashPayAmount, chequePayAmount, cashAmount, checkAmount, editingField]);


  const togglePaymentMethod = useCallback((method) => {
    setSelectedPaymentMethods((prev) => {
      const has = prev.includes(method);
      if (has) {
        const next = prev.filter((m) => m !== method);
        if (method === PAYMENT_CASH) setCashAmount('');
        if (method === PAYMENT_CHECK) {
          setCheckAmount('');
          setSelectedLocalBankId(null);
          setCheckNumber('');
        }
        return next;
      }

      if (method === PAYMENT_CREDIT) {
        return [...prev, PAYMENT_CREDIT];
      }
      if (method === PAYMENT_CASH && prev.includes(PAYMENT_CHECK)) {
        setLastEditedAmount(PAYMENT_CHECK);
      }
      if (method === PAYMENT_CHECK && prev.includes(PAYMENT_CASH)) {
        setLastEditedAmount(PAYMENT_CASH);
      }
      return [...prev, method];
    });
  }, []);

  const handleProceed = async (custSigData = null, drvSigData = null) => {
    if (!canProceed) return;
    const custSig = custSigData ?? customerSignatureData;
    const drvSig = drvSigData ?? driverSignatureData;
    if (!custSig || !drvSig) {
      Alert.alert('Error', 'Both customer and driver signatures are required.');
      return;
    }
    // Use only logged-in vehicle's cash_journal_id and check_journal_id (no default/fallback journals).
    const cashJournalId = vehicleJournalIds.cashJournalId ?? null;
    const checkJournalId = vehicleJournalIds.chequeJournalId ?? null;
    const needsCash = cashPayAmount > 0 && cashJournalId != null;
    const needsCheck = chequePayAmount > 0 && checkJournalId != null;
    const needsCredit = creditAmountNum > 0 && selectedPaymentMethods.includes(PAYMENT_CREDIT);
    if (!needsCash && !needsCheck && !needsCredit) return;
    try {
      setLoading(true);

      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      const orderInfo = data?.order;
      if (!orderInfo) throw new Error('Sale order not found');
      const partnerId = Array.isArray(orderInfo.partner_id)
        ? orderInfo.partner_id[0]
        : orderInfo.partner_id;
      const orderName = orderInfo.name ?? `Order ${saleOrderId}`;
      const invoiceNumber = await getOrAssignInvoiceNumber(saleOrderId);

      const soId = Number(saleOrderId);

      // Enqueue delivery and mark picking done only after payment is completed (not when user only tapped "Proceed to Payment").
      if (deliveryPayload && deliveryPayload.saleOrderId != null) {
        const existingDelivery = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(soId);
        if (existingDelivery) {
          await syncQueueDb.updateQueueItemPayload(existingDelivery.id, deliveryPayload);
        } else {
          await syncQueueDb.enqueue(syncQueueDb.ACTION_DELIVERY, deliveryPayload);
        }
        if (deliveryPayload.pickingId != null) {
          await stockPickingsDb.updatePickingStateLocal(Number(deliveryPayload.pickingId), 'done');
        }
      } else if (deliveryDone) {
        // Fallback: no deliveryPayload (e.g. older flow); ensure delivery is queued and picking marked done.
        const existingDelivery = await syncQueueDb.getPendingDeliveryItemBySaleOrderId(soId);
        const { picking } = existingDelivery ? { picking: null } : await getDeliveryDataFromDB(saleOrderId);
        if (picking?.id != null) {
          await stockPickingsDb.updatePickingStateLocal(Number(picking.id), 'done');
          await syncQueueDb.enqueue(syncQueueDb.ACTION_DELIVERY, {
            saleOrderId: soId,
            pickingId: picking.id,
            orderLineUpdates: [],
            moveUpdates: [],
            moveLineUpdates: [],
            deliveryLines: [],
          });
        }
      }

      await saleOrdersDb.updateSaleOrderInvoiceStatusLocal(saleOrderId, 'invoiced');

      const payments = [];
      const paymentSplit = { cash: 0, check: 0, credit: 0 };
      if (needsCash) {
        payments.push({ type: 'cash', amount: cashPayAmount, journalId: cashJournalId });
        paymentSplit.cash = cashPayAmount;
      }
      if (needsCheck) {
        payments.push({
          type: 'check',
          amount: chequePayAmount,
          journalId: checkJournalId,
          checkNumber: checkNumberTrimmed || undefined,
        });
        paymentSplit.check = chequePayAmount;
      }
      if (needsCredit) {
        payments.push({ type: 'credit', amount: creditAmountNum });
        paymentSplit.credit = creditAmountNum;
      }
      if (payments.length === 0) return;

      const paymentDateStr = new Date().toISOString().slice(0, 10);
      const queuePayload = {
        saleOrderId: soId,
        partnerId,
        orderName,
        invoiceNumber,
        total: orderTotalRounded,
        payments,
        paymentDate: paymentDateStr,
        chequeBankName: needsCheck ? selectedLocalBank?.name : undefined,
        checkNumber: needsCheck ? (checkNumberTrimmed || undefined) : undefined,
      };
      const existingPending = await syncQueueDb.getPendingPaymentItemBySaleOrderId(soId);
      if (existingPending) {
        await syncQueueDb.updateQueueItemPayload(existingPending.id, queuePayload);
        console.log(`[Payment] Updated existing pending payment for SO ${saleOrderId} (one queue item per order to avoid duplicates).`);
      } else {
        await syncQueueDb.enqueue(syncQueueDb.ACTION_PAYMENT, queuePayload);
        console.log(`[Payment] Enqueued payment for SO ${saleOrderId}. Sync will: read proof URIs → base64 → ir.attachment.create → message_post(attachment_ids).`);
      }

      const primaryPaymentType = needsCredit ? 'credit' : needsCheck ? 'cheque' : 'cash';
      const creditAmountForDb = primaryPaymentType === 'credit' ? (paymentSplit.credit ?? orderTotal) : null;
      await saleOrdersDb.updateSaleOrderPaymentTypeLocal(saleOrderId, primaryPaymentType, creditAmountForDb);

      const amountUntaxed = orderInfo.amount_untaxed != null ? Number(orderInfo.amount_untaxed) : orderTotal;
      const amountTax = orderInfo.amount_tax != null ? Number(orderInfo.amount_tax) : 0;
      const invoiceId = await localInvoicesDb.upsertLocalInvoice({
        sale_order_id: soId,
        invoice_number: invoiceNumber,
        amount_total: orderTotalRounded,
        amount_untaxed: amountUntaxed,
        amount_tax: amountTax,
        state: 'posted',
      });
      const paymentRows = payments.map((p) => ({
        sale_order_id: soId,
        payment_type: p.type === 'check' ? 'cheque' : p.type,
        amount: p.amount,
        journal_id: p.journalId ?? null,
        check_number: p.type === 'check' ? (p.checkNumber || checkNumberTrimmed || '') : '',
        bank_name: p.type === 'check' ? (selectedLocalBank?.name ?? '') : '',
      }));
      console.log('========= REPLACE PAYMENTS FOR INVOICE =========');
      console.log('invoiceId', invoiceId);
      console.log('paymentRows', paymentRows);
      console.log('===============================================');
      // TODO: Credit Journal ID is not being set
      await localPaymentsDb.replacePaymentsForInvoice(invoiceId, paymentRows);

      const invoiceParams = {
        saleOrderId,
        total,
        invoiceNumber,
        paymentType: 'split',
        paymentSplit,
        selectedBankId: needsCheck ? checkJournalId : null,
        selectedBankName: needsCheck ? selectedLocalBank?.name : undefined,
        chequeBankName: needsCheck ? (selectedLocalBank?.name ?? undefined) : undefined,
        checkNumber: needsCheck ? (checkNumber || undefined) : undefined,
        customerSignatureDataUrl: custSig ?? undefined,
        driverSignatureDataUrl: drvSig ?? undefined,
      };

      // Reset stack so InvoiceScreen is always on top (visible even if user had navigated away).
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            { name: 'MainTabs' },
            { name: 'InvoiceScreen', params: invoiceParams },
          ],
        })
      );
    } catch (err) {
      console.error(err);
      Alert.alert(
        'Error',
        err?.message || 'Failed to save payment (will sync when online)'
      );
    } finally {
      setLoading(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.xl + 80 + insets.bottom },
        title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.lg },
        totalCard: {
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        totalLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
        total: { fontSize: 24, fontWeight: '800', color: colors.text },
        sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
        requiredStar: { color: colors.error, fontWeight: '700' },
        photoCount: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
        photoList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
        photoButtonsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
        photoBtn: {
          flex: 1,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: spacing.md,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          borderStyle: 'dashed',
        },
        photoBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        photoPreviewWrap: {
          width: 75,
          height: 75,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        photoPreview: { width: '100%', height: '100%', backgroundColor: colors.background },
        photoRemoveBtn: {
          position: 'absolute',
          top: 4,
          right: 4,
          padding: 2,
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderRadius: 14,
        },
        photoHint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md, marginTop: -4 },
        cashRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: spacing.sm,
        },
        amountRowHalf: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginBottom: spacing.sm,
        },
        cashInputWrap: {
          minWidth: '50%',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
        },
        cashInputIcon: { marginRight: spacing.sm },
        cashInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 12 },
        cashInputSuffix: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginLeft: spacing.sm },
        cashHint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md },
        amountHalfCol: { flex: 1 },
        checkAmountRow: {
          flexDirection: 'row',
          gap: spacing.md,
          marginTop: spacing.sm,
        },
        checkAmountCol: { flex: 1 },
        checkInputRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginTop: 4,
        },
        checkFieldBtn: {
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          borderWidth: 2,
          borderColor: colors.border,
        },
        checkAmountLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
        checkAmountInput: {
          width: '100%',
          backgroundColor: colors.background,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: 10,
          paddingHorizontal: spacing.sm,
          fontSize: 15,
          color: colors.text,
        },
        creditAmountWrap: {
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.lg,
          opacity: 0.9,
          gap:spacing.sm
        },
        creditAmountText: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
        creditAmountHint: { fontSize: 11, color: colors.textSecondary,textAlign:'right' },
        radioRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
        radioOption: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 12,
          paddingHorizontal: spacing.lg,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
          borderWidth: 2,
          borderColor: colors.border,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 3,
        },
        checkboxOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
        checkboxBox: {
          width: 20,
          height: 20,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: colors.textSecondary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        checkboxBoxSelected: { borderColor: '#fff', backgroundColor: 'transparent' },
        radioLabel: { fontSize: 12, fontWeight: '600', color: colors.text },
        radioLabelSelected: { color: '#fff' },
        searchWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          paddingVertical: 10,
          paddingHorizontal: spacing.sm,
          marginBottom: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8,
        },
        searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 6 },
        searchClear: { padding: 2 },
        bankSearchWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing.sm,
          marginBottom: spacing.sm,
          gap: 8,
        },
        selectedBankWrap: { marginBottom: spacing.sm },
        bankCardSelectedOnly: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.primary,
          paddingVertical: 0,
          paddingHorizontal: 0,
          borderRadius: borderRadius.md,
          borderWidth: 2,
          borderColor: colors.primary,
        },
        bankIconWrapSmall: {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: 'rgba(255,255,255,0.25)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
        },
        bankNameSelectedOnly: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff' },
        changeBankBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
        changeBankText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        bankList: { marginBottom: spacing.sm },
        bankListScrollWrap: {
          maxHeight: 240,
          borderRadius: borderRadius.md,
        },
        bankListScroll: {
          paddingBottom: 4,
        },
        bankCard: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          paddingVertical: 4,
          paddingHorizontal: spacing.sm,
          borderRadius: borderRadius.md,
          marginBottom: 6,
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 2,
        },
        bankIconWrap: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
          overflow: 'hidden',
        },
        bankLogo: { width: 36, height: 36 },
        bankName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
        noBanksText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
        bottomSpacer: { height: spacing.md },
        payBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 16,
          borderRadius: borderRadius.lg,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 4,
          marginTop: spacing.sm,
        },
        payBtnDisabled: { backgroundColor: colors.textSecondary, opacity: 0.7 },
        btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
        evidenceAssistText: {
          fontSize: 13,
          color: colors.primary,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        signatureModalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: spacing.lg,
        },
        signatureModalContent: {
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          maxHeight: '80%',
        },
        signatureModalTitle: {
          fontSize: 18,
          fontWeight: '700',
          textAlign: 'center',
          marginBottom: 4,
        },
        signatureModalHint: {
          fontSize: 13,
          textAlign: 'center',
          marginBottom: spacing.md,
        },
        signatureCanvasWrap: {
          height: 220,
          marginBottom: spacing.md,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        },
        signatureCanvas: {
          flex: 1,
          height: 220,
        },
        signatureBtnRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginBottom: spacing.md,
        },
        signatureActionBtn: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          borderRadius: borderRadius.md,
        },
        signatureClearBtn: {
          borderWidth: 1,
        },
        signatureConfirmBtn: {},
        signatureActionBtnText: { fontSize: 15, fontWeight: '600' },
        signatureCancelBtn: {
          paddingVertical: 12,
          alignItems: 'center',
          borderWidth: 1,
          borderRadius: borderRadius.md,
        },
        signatureCancelBtnText: { fontSize: 15, fontWeight: '600' },
      }),
    [colors, insets.bottom]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.totalCard}>
        {(orderSubtotal != null || orderTax != null) ? (
          <>
            {orderSubtotal != null && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.totalLabel}>Sub total</Text>
                <Text style={[styles.totalLabel, { fontWeight: '600', color: colors.text }]}>Rs. {formatAmount(orderSubtotal)}</Text>
              </View>
            )}
            {orderTax != null && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.totalLabel}>VAT (18%)</Text>
                <Text style={[styles.totalLabel, { fontWeight: '600', color: colors.text }]}>Rs. {formatAmount(orderTax)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={[styles.totalLabel, { fontWeight: '700', fontSize: 15 }]}>Payment total</Text>
              <Text style={styles.total}>Rs. {formatAmount(total)}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.total}>Rs. {formatAmount(total)}</Text>
          </>
        )}
      </View>

      {/* Payment method: checkboxes (multi-select) */}
      <Text style={styles.sectionLabel}>Payment method</Text>
      <View style={styles.radioRow}>
        <TouchableOpacity
          style={[styles.radioOption, selectedPaymentMethods.includes(PAYMENT_CASH) && styles.checkboxOptionSelected]}
          onPress={() => togglePaymentMethod(PAYMENT_CASH)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, selectedPaymentMethods.includes(PAYMENT_CASH) && styles.checkboxBoxSelected]}>
            {selectedPaymentMethods.includes(PAYMENT_CASH) && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="cash-outline" size={22} color={selectedPaymentMethods.includes(PAYMENT_CASH) ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, selectedPaymentMethods.includes(PAYMENT_CASH) && styles.radioLabelSelected]}>Cash</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, selectedPaymentMethods.includes(PAYMENT_CHECK) && styles.checkboxOptionSelected]}
          onPress={() => togglePaymentMethod(PAYMENT_CHECK)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, selectedPaymentMethods.includes(PAYMENT_CHECK) && styles.checkboxBoxSelected]}>
            {selectedPaymentMethods.includes(PAYMENT_CHECK) && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="card-outline" size={22} color={selectedPaymentMethods.includes(PAYMENT_CHECK) ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, selectedPaymentMethods.includes(PAYMENT_CHECK) && styles.radioLabelSelected]}>Cheque</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, selectedPaymentMethods.includes(PAYMENT_CREDIT) && styles.checkboxOptionSelected]}
          onPress={() => togglePaymentMethod(PAYMENT_CREDIT)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, selectedPaymentMethods.includes(PAYMENT_CREDIT) && styles.checkboxBoxSelected]}>
            {selectedPaymentMethods.includes(PAYMENT_CREDIT) && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="wallet-outline" size={22} color={selectedPaymentMethods.includes(PAYMENT_CREDIT) ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, selectedPaymentMethods.includes(PAYMENT_CREDIT) && styles.radioLabelSelected]}>Credit</Text>
        </TouchableOpacity>
      </View>

      {/* Amount Paid: one row, left half Cash, right half Check; remainder goes to Credit */}
      <Text style={styles.sectionLabel}>Amount Paid <Text style={styles.requiredStar}>*</Text></Text>
      {(selectedPaymentMethods.includes(PAYMENT_CASH) || selectedPaymentMethods.includes(PAYMENT_CHECK)) && (
        <View style={styles.amountRowHalf}>
          <View >
            {selectedPaymentMethods.includes(PAYMENT_CASH) ? (
              <View style={styles.cashInputWrap}>
                <Ionicons name="cash-outline" size={20} color={colors.primary} style={styles.cashInputIcon} />
                <Text style={styles.cashInputSuffix}>Rs.</Text>
                <TextInput
                  ref={cashInputRef}
                  style={styles.cashInput}
                  value={cashAmount}
                  onFocus={() => setEditingField(PAYMENT_CASH)}
                  onBlur={() => setEditingField(null)}
                  onChangeText={(v) => {
                    setLastEditedAmount(PAYMENT_CASH);
                    setCashAmount(v);
                  }}
                  placeholder="Cash"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            ) : null}
          </View>
          <View style={styles.amountHalfCol}>
            {selectedPaymentMethods.includes(PAYMENT_CHECK) ? (
              <View style={styles.cashInputWrap}>
                <Ionicons name="card-outline" size={20} color={colors.primary} style={styles.cashInputIcon} />
                <Text style={styles.cashInputSuffix}>Rs.</Text>
                <TextInput
                  ref={checkInputRef}
                  style={styles.cashInput}
                  value={checkAmount}
                  onFocus={() => setEditingField(PAYMENT_CHECK)}
                  onBlur={() => setEditingField(null)}
                  onChangeText={(v) => {
                    setLastEditedAmount(PAYMENT_CHECK);
                    setCheckAmount(v);
                  }}
                  placeholder="Cheque"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            ) : null}
          </View>
        </View>
      )}

      {!journalsLoading && selectedPaymentMethods.includes(PAYMENT_CASH) && cashPayAmount > 0 && vehicleJournalIds.cashJournalId == null && (
        <Text style={[styles.cashHint, { color: hasSyncedOnce ? colors.error : colors.textSecondary, marginBottom: spacing.sm }]}>
          {hasSyncedOnce
            ? 'Vehicle Cash journal is not configured. Please contact admin.'
            : 'Sync when online to load Cash payment option.'}
        </Text>
      )}
      {!journalsLoading && selectedPaymentMethods.includes(PAYMENT_CHECK) && chequePayAmount > 0 && vehicleJournalIds.chequeJournalId == null && (
        <Text style={[styles.cashHint, { color: hasSyncedOnce ? colors.error : colors.textSecondary, marginBottom: spacing.sm }]}>
          {hasSyncedOnce
            ? 'Vehicle Cheque journal is not configured. Please contact admin.'
            : 'Sync when online to load Cheque payment option.'}
        </Text>
      )}

      {selectedPaymentMethods.includes(PAYMENT_CHECK) && (
        <>
          <Text style={styles.sectionLabel}>Choose Bank <Text style={styles.requiredStar}>*</Text></Text>
          {journalsLoading ? (
            <View style={styles.bankList}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.noBanksText}>Loading…</Text>
            </View>
          ) : (
            <>
              {selectedLocalBankId == null ? (
                <View style={styles.bankSearchWrap}>
                  <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    value={bankSearchQuery}
                    onChangeText={setBankSearchQuery}
                    placeholder="Search bank..."
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {bankSearchQuery.length > 0 ? (
                    <TouchableOpacity onPress={() => setBankSearchQuery('')} style={styles.searchClear} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              <View style={[styles.bankList, { marginBottom: spacing.sm }]}>
                {selectedLocalBankId != null ? (
                  <>
                    <TouchableOpacity
                      style={[styles.bankCard, { borderColor: colors.primary}]}
                      onPress={() => {}}
                      activeOpacity={1}
                    >
                      <View style={styles.bankIconWrap}>
                        {selectedLocalBank?.logo != null ? (
                          <Image source={selectedLocalBank.logo} style={styles.bankLogo} resizeMode="contain" />
                        ) : (
                          <Ionicons name={selectedLocalBank?.icon || 'business-outline'} size={24} color={colors.primary} />
                        )}
                      </View>
                      <Text style={styles.bankName} numberOfLines={1}>{selectedLocalBank?.name}</Text>
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.changeBankBtn}
                      onPress={() => { setSelectedLocalBankId(null); setBankSearchQuery(''); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                      <Text style={styles.changeBankText}>Change bank</Text>
                    </TouchableOpacity>
                  </>
                ) : filteredBanks.length === 0 ? (
                  <Text style={styles.noBanksText}>No banks match "{bankSearchQuery}"</Text>
                ) : (
                  <View style={styles.bankListScrollWrap}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.bankListScroll}>
                      {filteredBanks.map((bank) => (
                        <TouchableOpacity
                          key={bank.id}
                          style={[
                            styles.bankCard,
                            selectedLocalBankId === bank.id && { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
                          ]}
                          onPress={() => setSelectedLocalBankId(bank.id)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.bankIconWrap}>
                            {bank.logo != null ? (
                              <Image source={bank.logo} style={styles.bankLogo} resizeMode="contain" />
                            ) : (
                              <Ionicons name={bank.icon || 'business-outline'} size={24} color={colors.primary} />
                            )}
                          </View>
                          <Text style={styles.bankName} numberOfLines={1}>{bank.name}</Text>
                          {selectedLocalBankId === bank.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
              <Text style={[styles.sectionLabel]}>Cheque number <Text style={styles.requiredStar}>*</Text></Text>
              <View style={[styles.checkInputRow , { marginBottom: spacing.sm }]}>
                <TextInput
                  style={[styles.checkAmountInput, { flex: 1 }]}
                  value={checkNumber}
                  onChangeText={setCheckNumber}
                  placeholder="Check #"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </>
          )}
        </>
      )}

      {selectedPaymentMethods.includes(PAYMENT_CREDIT) && (
        <>
          <Text style={styles.sectionLabel}>Credit</Text>
          <View style={styles.creditAmountWrap}>
            <Ionicons name="wallet-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.creditAmountHint}>{remainingCreditLabel}</Text>
            <Text style={styles.creditAmountText}> Rs. {formatAmount(creditAmountNum)}</Text>
          </View>
        </>
      )}

      <TouchableOpacity
        style={[styles.payBtn, !canProceed && styles.payBtnDisabled]}
        onPress={() => {
          if (!canProceed) return;
          setSignatureStep('customer');
          setShowSignatureModal(true);
        }}
        disabled={loading || !canProceed}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
            <Text style={styles.btnText}>Confirm Payment</Text>
          </>
        )}
      </TouchableOpacity>

      <Modal
        visible={showSignatureModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSignatureModal(false)}
      >
        <View style={styles.signatureModalOverlay}>
          <View style={[styles.signatureModalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.signatureModalTitle, { color: colors.text }]}> 
              {signatureStep === 'customer' ? 'Customer signature' : 'Driver signature'}
            </Text>
            <Text style={[styles.signatureModalHint, { color: colors.textSecondary }]}> 
              {signatureStep === 'customer'
                ? 'Customer: sign in the box below, then tap Next'
                : 'Driver: sign in the box below, then tap Confirm'}
            </Text>
            <View style={styles.signatureCanvasWrap}>
              <SignatureCanvas
                ref={signatureStep === 'customer' ? customerSignatureRef : driverSignatureRef}
                onOK={(dataUrl) => {
                  if (signatureStep === 'customer') {
                    setCustomerSignatureData(dataUrl);
                    setSignatureStep('driver');
                    setTimeout(() => {
                      driverSignatureRef.current?.clearSignature();
                    }, 100);
                  } else {
                    setDriverSignatureData(dataUrl);
                    setShowSignatureModal(false);
                    handleProceed(customerSignatureData, dataUrl);
                  }
                }}
                onEmpty={() => {
                  Alert.alert('Signature required', `Please sign above before confirming (${signatureStep}).`);
                }}
                descriptionText=""
                clearText=""
                confirmText=""
                penColor="#000000"
                backgroundColor="rgba(255,255,255,1)"
                style={styles.signatureCanvas}
                autoClear={false}
                webStyle={`.m-signature-pad--footer { display: none !important; }`}
              />
            </View>
            <View style={styles.signatureBtnRow}>
              <TouchableOpacity
                style={[styles.signatureActionBtn, styles.signatureClearBtn, { borderColor: colors.border }]}
                onPress={() => {
                  if (signatureStep === 'customer') {
                    customerSignatureRef.current?.clearSignature();
                  } else {
                    driverSignatureRef.current?.clearSignature();
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.signatureActionBtnText, { color: colors.textSecondary }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signatureActionBtn, styles.signatureConfirmBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (signatureStep === 'customer') {
                    customerSignatureRef.current?.readSignature();
                  } else {
                    driverSignatureRef.current?.readSignature();
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.signatureActionBtnText, { color: '#fff' }]}>
                  {signatureStep === 'customer' ? 'Next' : 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.signatureCancelBtn, { borderColor: colors.border }]}
              onPress={() => {
                setShowSignatureModal(false);
                setSignatureStep('customer');
                setCustomerSignatureData(null);
                setDriverSignatureData(null);
                customerSignatureRef.current?.clearSignature();
                driverSignatureRef.current?.clearSignature();
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.signatureCancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { SRI_LANKA_BANKS } from '../constants/sriLankaBanks';
import { getCachedJournals, getSaleOrderDetailsFromDB } from '../services/sync.service';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';

const PAYMENT_CASH = 'cash';
const PAYMENT_CHECK = 'check';
const PAYMENT_CREDIT = 'credit';

export default function ProceedPaymentScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { saleOrderId, total, deliveryDone } = route.params || {};
  const orderTotal = Number(total) || 0;
  const [loading, setLoading] = useState(false);
  const [journalsLoading, setJournalsLoading] = useState(true);
  const [journals, setJournals] = useState([]);
  const [paymentType, setPaymentType] = useState(PAYMENT_CASH);
  /** For Check: selected Sri Lankan bank (display only; backend uses Cheque journal). */
  const [selectedBankId, setSelectedBankId] = useState(null);
  /** For Credit: selected Odoo bank journal. */
  const [selectedJournalId, setSelectedJournalId] = useState(null);
  const [journalSearch, setJournalSearch] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [checkAmount, setCheckAmount] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [deliveryPhotos, setDeliveryPhotos] = useState([]);
  const [cashEditMode, setCashEditMode] = useState(false);
  const [cashAmountDraft, setCashAmountDraft] = useState('');
  const [checkAmountEditMode, setCheckAmountEditMode] = useState(false);
  const [checkNumberEditMode, setCheckNumberEditMode] = useState(false);
  const cashInputRef = useRef(null);

  const MAX_PHOTOS = 3;

  /** Cash method: bind to Odoo journal named "Cash" (internal only; user sees "Cash" method, not journals). */
  const cashJournal = useMemo(
    () => (journals || []).find((j) => (j.name || '').trim().toLowerCase() === 'cash'),
    [journals]
  );
  /** Check method: bind to Odoo journal named "Cheque" (user selects Sri Lankan bank for display; backend gets Cheque journal). */
  const chequeJournal = useMemo(
    () => (journals || []).find((j) => (j.name || '').trim().toLowerCase() === 'cheque'),
    [journals]
  );
  const bankJournals = useMemo(
    () => (journals || []).filter((j) => j.type === 'bank'),
    [journals]
  );
  /** For Credit only: filter bank journals by search. */
  const filteredBankJournals = useMemo(() => {
    const q = (journalSearch || '').trim().toLowerCase();
    if (!q) return bankJournals;
    return bankJournals.filter(
      (j) =>
        (j.name || '').toLowerCase().includes(q) ||
        (j.code || '').toLowerCase().includes(q)
    );
  }, [journalSearch, bankJournals]);

  const selectedSriLankanBank = selectedBankId ? SRI_LANKA_BANKS.find((b) => b.id === selectedBankId) : null;
  const selectedJournal =
    selectedJournalId != null ? journals.find((j) => j.id === selectedJournalId) : null;
  const isSelectedJournalValid =
    selectedJournal && paymentType === PAYMENT_CREDIT && selectedJournal.type === 'bank';

  const cashAmountNum = useMemo(() => {
    const n = parseFloat(String(cashAmount).replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [cashAmount]);

  const checkAmountNum = useMemo(() => {
    const n = parseFloat(String(checkAmount).replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [checkAmount]);

  const remainingAfterCash = orderTotal - cashAmountNum;
  const creditAmountNum = useMemo(() => Math.max(0, orderTotal - cashAmountNum - checkAmountNum), [orderTotal, cashAmountNum, checkAmountNum]);
  const totalEntered = cashAmountNum + checkAmountNum + creditAmountNum;
  const hasAnyPayment = cashAmountNum > 0 || checkAmountNum > 0 || creditAmountNum > 0;

  const checkNumberTrimmed = useMemo(() => (checkNumber != null ? String(checkNumber).trim() : ''), [checkNumber]);
  const paymentComplete =
    hasAnyPayment &&
    totalEntered >= orderTotal &&
    (cashAmountNum <= 0 || !!cashJournal) &&
    (checkAmountNum <= 0 || (!!chequeJournal && !!selectedBankId && checkNumberTrimmed !== '')) &&
    (creditAmountNum <= 0 || (bankJournals.length > 0 && selectedJournalId != null && bankJournals.some((j) => j.id === selectedJournalId)));

  const evidenceRequired = checkAmountNum > 0 || creditAmountNum > 0;
  const hasUnconfirmedEdits = cashEditMode || checkAmountEditMode || checkNumberEditMode;
  const canProceed =
    paymentComplete &&
    (evidenceRequired ? deliveryPhotos.length >= 1 : true) &&
    !hasUnconfirmedEdits;

  const loadJournals = useCallback(async () => {
    setJournalsLoading(true);
    try {
      const list = await getCachedJournals();
      setJournals(Array.isArray(list) ? list : []);
    } catch (_) {
      setJournals([]);
    } finally {
      setJournalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJournals();
  }, [loadJournals]);

  useEffect(() => {
    if (paymentType === PAYMENT_CASH && cashAmount === '' && orderTotal > 0) {
      setCashAmount(orderTotal.toFixed(2));
    }
  }, [paymentType]);

  // When leaving Cash tab without confirming, discard draft and exit edit mode
  useEffect(() => {
    if (paymentType !== PAYMENT_CASH) {
      setCashEditMode(false);
      setCashAmountDraft(cashAmount);
    }
  }, [paymentType, cashAmount]);

  // Auto-fill Check amount only when user opens Check tab and has not yet entered check number (persist once they have)
  useEffect(() => {
    if (paymentType === PAYMENT_CHECK) {
      if (checkNumberTrimmed === '') {
        const remaining = Math.max(0, orderTotal - cashAmountNum);
        setCheckAmount(remaining > 0 ? remaining.toFixed(2) : '0');
        setCheckAmountEditMode(true);
        setCheckNumberEditMode(true);
      }
    }
  }, [paymentType, orderTotal, cashAmountNum, checkNumberTrimmed]);

  // When user leaves Check without amount or check number, zero check amount so balance goes to Credit
  useEffect(() => {
    if (paymentType !== PAYMENT_CHECK && (checkNumber == null || String(checkNumber).trim() === '')) {
      setCheckAmount('0');
    }
  }, [paymentType, checkNumber]);

  // Reset check edit modes when leaving Check tab
  useEffect(() => {
    if (paymentType !== PAYMENT_CHECK) {
      setCheckAmountEditMode(false);
      setCheckNumberEditMode(false);
    }
  }, [paymentType]);

  useEffect(() => {
    if (paymentType === PAYMENT_CREDIT && !isSelectedJournalValid && selectedJournalId != null) {
      setSelectedJournalId(null);
      setJournalSearch('');
    }
  }, [paymentType, isSelectedJournalValid, selectedJournalId]);

  const handleProceed = async () => {
    if (!canProceed) return;
    const cashJournalId = cashJournal?.id ?? null;
    const checkJournalId = chequeJournal?.id ?? null;
    const creditJournalId = selectedJournalId != null && isSelectedJournalValid ? selectedJournalId : bankJournals[0]?.id ?? null;
    const needsCash = cashAmountNum > 0 && cashJournalId != null;
    const needsCheck = checkAmountNum > 0 && checkJournalId != null && selectedBankId != null;
    const needsCredit = creditAmountNum > 0 && creditJournalId != null;
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

      await saleOrdersDb.updateSaleOrderInvoiceStatusLocal(saleOrderId, 'invoiced');

      const payments = [];
      if (needsCash) {
        payments.push({ type: 'cash', amount: cashAmountNum, journalId: cashJournalId });
      }
      if (needsCheck) {
        payments.push({
          type: 'check',
          amount: checkAmountNum,
          journalId: checkJournalId,
          checkNumber: checkNumberTrimmed || undefined,
        });
      }
      if (needsCredit) {
        payments.push({ type: 'credit', amount: creditAmountNum, journalId: creditJournalId });
      }

      await syncQueueDb.enqueue(syncQueueDb.ACTION_PAYMENT, {
        saleOrderId,
        partnerId,
        orderName,
        total: orderTotal,
        payments,
        deliveryPhotoUris: deliveryPhotos,
      });

      const displayBankName = needsCheck
        ? (selectedSriLankanBank?.name ?? null)
        : needsCredit
          ? (selectedJournal?.name ?? bankJournals[0]?.name ?? null)
          : null;

      navigation.replace('InvoiceScreen', {
        saleOrderId,
        total,
        paymentType: 'split',
        paymentSplit: { cash: cashAmountNum, check: checkAmountNum, credit: creditAmountNum },
        selectedBankId: (needsCheck || needsCredit) ? (needsCheck ? selectedBankId : selectedJournalId) : null,
        selectedBankName: displayBankName,
        deliveryPhotoUris: deliveryPhotos,
        cashAmount: cashAmountNum,
        checkNumber: checkNumber || undefined,
      });
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
          marginBottom: spacing.lg,
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
          paddingVertical: spacing.lg,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          borderStyle: 'dashed',
        },
        photoBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        photoPreviewWrap: {
          width: 100,
          height: 100,
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
        cashInputWrap: {
          flex: 1,
          maxWidth: '50%',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
        },
        cashInputIcon: { marginRight: spacing.sm },
        cashInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14 },
        cashInputSuffix: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginLeft: spacing.sm },
        cashModifyBtn: {
          width: 44,
          height: 44,
          marginLeft: spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.md,
          borderWidth: 2,
          borderColor: colors.border,
        },
        cashHint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.lg },
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
          flex: 1,
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
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          marginBottom: spacing.lg,
          opacity: 0.9,
        },
        creditAmountText: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
        creditAmountHint: { fontSize: 11, color: colors.textSecondary },
        radioRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
        radioOption: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
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
        radioOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
        radioCircle: {
          width: 18,
          height: 18,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: colors.textSecondary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        radioCircleSelected: { borderColor: '#fff' },
        radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
        radioLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
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
        searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
        searchClear: { padding: 2 },
        selectedBankWrap: { marginBottom: spacing.lg },
        bankCardSelectedOnly: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.primary,
          paddingVertical: 10,
          paddingHorizontal: spacing.sm,
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
        changeBankBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm, paddingVertical: 8 },
        changeBankText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        bankList: { marginBottom: spacing.lg },
        bankCard: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          paddingVertical: 10,
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
        },
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
        },
        payBtnDisabled: { backgroundColor: colors.textSecondary, opacity: 0.7 },
        btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
        evidenceAssistText: {
          fontSize: 13,
          color: colors.primary,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
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
        <Text style={styles.totalLabel}>Total Amount</Text>
        <Text style={styles.total}>LKR {Number(total).toFixed(2)}</Text>
      </View>

      {/* Payment type: Cash | Check | Credit */}
      <Text style={styles.sectionLabel}>Payment method</Text>
      <View style={styles.radioRow}>
        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CASH && styles.radioOptionSelected]}
          onPress={() => {
            if (hasUnconfirmedEdits) {
              Alert.alert('Confirm edit first', 'Please confirm or cancel your current edit (tap the checkmark or stay on this option) before switching payment method.');
              return;
            }
            setPaymentType(PAYMENT_CASH);
            setSelectedBankId(null);
            setSelectedJournalId(null);
            setJournalSearch('');
            setCashEditMode(false);
            setCashAmountDraft(cashAmount);
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.radioCircle, paymentType === PAYMENT_CASH && styles.radioCircleSelected]}>
            {paymentType === PAYMENT_CASH && <View style={styles.radioDot} />}
          </View>
          <Ionicons name="cash-outline" size={22} color={paymentType === PAYMENT_CASH ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CASH && styles.radioLabelSelected]}>Cash</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CHECK && styles.radioOptionSelected]}
          onPress={() => {
            if (hasUnconfirmedEdits) {
              Alert.alert('Confirm edit first', 'Please confirm or cancel your current edit (tap the checkmark or stay on this option) before switching payment method.');
              return;
            }
            setPaymentType(PAYMENT_CHECK);
            setSelectedJournalId(null);
            setJournalSearch('');
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.radioCircle, paymentType === PAYMENT_CHECK && styles.radioCircleSelected]}>
            {paymentType === PAYMENT_CHECK && <View style={styles.radioDot} />}
          </View>
          <Ionicons name="card-outline" size={22} color={paymentType === PAYMENT_CHECK ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CHECK && styles.radioLabelSelected]}>Check</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CREDIT && styles.radioOptionSelected]}
          onPress={() => {
            if (hasUnconfirmedEdits) {
              Alert.alert('Confirm edit first', 'Please confirm or cancel your current edit (tap the checkmark or stay on this option) before switching payment method.');
              return;
            }
            setPaymentType(PAYMENT_CREDIT);
            setSelectedBankId(null);
            setJournalSearch('');
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.radioCircle, paymentType === PAYMENT_CREDIT && styles.radioCircleSelected]}>
            {paymentType === PAYMENT_CREDIT && <View style={styles.radioDot} />}
          </View>
          <Ionicons name="wallet-outline" size={22} color={paymentType === PAYMENT_CREDIT ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CREDIT && styles.radioLabelSelected]}>Credit</Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic content: Cash = amount (half width) + modify icon, Check = bank + amount/check#, Credit = remaining only */}
      {paymentType === PAYMENT_CASH && (
        <>
          <Text style={styles.sectionLabel}>Amount Paid <Text style={styles.requiredStar}>*</Text></Text>
          <View style={styles.cashRow}>
            <View style={styles.cashInputWrap}>
              <Ionicons name="cash-outline" size={22} color={colors.primary} style={styles.cashInputIcon} />
              <TextInput
                ref={cashInputRef}
                style={styles.cashInput}
                value={cashEditMode ? cashAmountDraft : cashAmount}
                onChangeText={(t) => cashEditMode && setCashAmountDraft(t)}
                placeholder="Total amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
                editable={cashEditMode}
              />
              <Text style={styles.cashInputSuffix}>LKR</Text>
            </View>
            <TouchableOpacity
              style={styles.cashModifyBtn}
              onPress={() => {
                if (cashEditMode) {
                  setCashAmount(cashAmountDraft);
                  setCashEditMode(false);
                  cashInputRef.current?.blur();
                } else {
                  setCashAmountDraft(cashAmount);
                  setCashEditMode(true);
                  cashInputRef.current?.focus();
                }
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={cashEditMode ? 'checkmark-circle' : 'pencil'}
                size={22}
                color={colors.primary}
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.cashHint}>Default: full total. You can pay less or more.</Text>
          {!cashJournal && !journalsLoading && (
            <Text style={[styles.cashHint, { color: colors.warning }]}>Cash journal not found. Sync when online to record payment.</Text>
          )}
        </>
      )}

      {paymentType === PAYMENT_CHECK && (
        <>
          <Text style={styles.sectionLabel}>Select Bank (Sri Lanka) <Text style={styles.requiredStar}>*</Text></Text>
          {!chequeJournal && !journalsLoading ? (
            <View style={styles.bankList}>
              <Text style={styles.noBanksText}>Cheque journal not found in Odoo. Sync when online to load it.</Text>
            </View>
          ) : selectedSriLankanBank ? (
            <View style={styles.selectedBankWrap}>
              <TouchableOpacity style={styles.bankCardSelectedOnly} onPress={() => {}} activeOpacity={1}>
                <View style={styles.bankIconWrapSmall}>
                  <Ionicons name={selectedSriLankanBank.icon || 'business-outline'} size={22} color="#fff" />
                </View>
                <Text style={styles.bankNameSelectedOnly} numberOfLines={1}>
                  {selectedSriLankanBank.name}
                </Text>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.changeBankBtn}
                onPress={() => {
                  setSelectedBankId(null);
                  setCheckAmount('0');
                  setCheckNumber('');
                  setCheckAmountEditMode(true);
                  setCheckNumberEditMode(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                <Text style={styles.changeBankText}>Change Bank</Text>
              </TouchableOpacity>
              <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Amount & Check number</Text>
              <View style={styles.checkAmountRow}>
                <View style={styles.checkAmountCol}>
                  <Text style={styles.checkAmountLabel}>Amount (LKR)</Text>
                  <View style={styles.checkInputRow}>
                    <TextInput
                      style={styles.checkAmountInput}
                      value={checkAmount}
                      onChangeText={setCheckAmount}
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                      editable={checkAmountEditMode}
                    />
                    <TouchableOpacity
                      style={styles.checkFieldBtn}
                      onPress={() => setCheckAmountEditMode((prev) => !prev)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={checkAmountEditMode ? 'checkmark-circle' : 'pencil'}
                        size={22}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.checkAmountCol}>
                  <Text style={styles.checkAmountLabel}>Check number <Text style={styles.requiredStar}>*</Text></Text>
                  <View style={styles.checkInputRow}>
                    <TextInput
                      style={styles.checkAmountInput}
                      value={checkNumber}
                      onChangeText={setCheckNumber}
                      placeholder="Check #"
                      placeholderTextColor={colors.textSecondary}
                      editable={checkNumberEditMode}
                    />
                    <TouchableOpacity
                      style={styles.checkFieldBtn}
                      onPress={() => setCheckNumberEditMode((prev) => !prev)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={checkNumberEditMode ? 'checkmark-circle' : 'pencil'}
                        size={22}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.bankList}>
              {SRI_LANKA_BANKS.map((bank) => (
                <TouchableOpacity
                  key={bank.id}
                  style={styles.bankCard}
                  onPress={() => setSelectedBankId(bank.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.bankIconWrap}>
                    <Ionicons name={bank.icon || 'business-outline'} size={24} color={colors.primary} />
                  </View>
                  <Text style={styles.bankName} numberOfLines={1}>{bank.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {paymentType === PAYMENT_CREDIT && (
        <>
          <Text style={styles.sectionLabel}>Credit amount (remaining after Cash & Check)</Text>
          <View style={styles.creditAmountWrap}>
            <Ionicons name="wallet-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.creditAmountText}>LKR {creditAmountNum.toFixed(2)}</Text>
            <Text style={styles.creditAmountHint}>Auto-filled • Not editable</Text>
          </View>
          {creditAmountNum > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>Select journal (Bank) <Text style={styles.requiredStar}>*</Text></Text>
              {journalsLoading ? (
                <View style={styles.bankList}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.noBanksText}>Loading journals…</Text>
                </View>
              ) : selectedJournal && isSelectedJournalValid ? (
                <View style={styles.selectedBankWrap}>
                  <TouchableOpacity style={styles.bankCardSelectedOnly} onPress={() => {}} activeOpacity={1}>
                    <View style={styles.bankIconWrapSmall}>
                      <Ionicons name="business-outline" size={22} color="#fff" />
                    </View>
                    <Text style={styles.bankNameSelectedOnly} numberOfLines={1}>
                      {selectedJournal.name} {selectedJournal.code ? `(${selectedJournal.code})` : ''}
                    </Text>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.changeBankBtn}
                    onPress={() => { setSelectedJournalId(null); setJournalSearch(''); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                    <Text style={styles.changeBankText}>Change journal</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                    <TextInput
                      style={styles.searchInput}
                      value={journalSearch}
                      onChangeText={setJournalSearch}
                      placeholder="Search bank journals…"
                      placeholderTextColor={colors.textSecondary}
                      returnKeyType="search"
                    />
                    {journalSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setJournalSearch('')} style={styles.searchClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.bankList}>
                    {filteredBankJournals.map((journal) => (
                      <TouchableOpacity key={journal.id} style={styles.bankCard} onPress={() => setSelectedJournalId(journal.id)} activeOpacity={0.8}>
                        <View style={styles.bankIconWrap}>
                          <Ionicons name="business-outline" size={24} color={colors.primary} />
                        </View>
                        <Text style={styles.bankName} numberOfLines={1}>{journal.name} {journal.code ? `(${journal.code})` : ''}</Text>
                        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    ))}
                    {filteredBankJournals.length === 0 && (
                      <Text style={styles.noBanksText}>
                        {bankJournals.length === 0 ? 'No bank journals in Odoo' : 'No journals match your search'}
                      </Text>
                    )}
                  </View>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Evidence of delivery: one common section below payment methods; required only if Check or Credit used */}
      <Text style={styles.sectionLabel}>
        Evidence of delivery
        {evidenceRequired && <Text style={styles.requiredStar}> *</Text>}
        {deliveryPhotos.length > 0 && (
          <Text style={styles.photoCount}> ({deliveryPhotos.length}/{MAX_PHOTOS})</Text>
        )}
      </Text>
      {deliveryPhotos.length > 0 && (
        <View style={styles.photoList}>
          {deliveryPhotos.map((uri, index) => (
            <View key={`${uri}-${index}`} style={styles.photoPreviewWrap}>
              <Image source={{ uri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity
                style={styles.photoRemoveBtn}
                onPress={() => setDeliveryPhotos((prev) => prev.filter((_, i) => i !== index))}
                activeOpacity={0.8}
              >
                <Ionicons name="close-circle" size={28} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {deliveryPhotos.length < MAX_PHOTOS && (
        <View style={styles.photoButtonsRow}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={async () => {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Permission', 'Camera access is required to take a photo.');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.8,
              });
              if (!result.canceled && result.assets?.[0]?.uri) {
                setDeliveryPhotos((prev) =>
                  prev.length < MAX_PHOTOS ? [...prev, result.assets[0].uri] : prev
                );
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="camera" size={28} color={colors.primary} />
            <Text style={styles.photoBtnText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={async () => {
              const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Permission', 'Gallery access is required to choose a photo.');
                return;
              }
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.8,
              });
              if (!result.canceled && result.assets?.[0]?.uri) {
                setDeliveryPhotos((prev) =>
                  prev.length < MAX_PHOTOS ? [...prev, result.assets[0].uri] : prev
                );
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="images-outline" size={28} color={colors.primary} />
            <Text style={styles.photoBtnText}>Choose photo</Text>
          </TouchableOpacity>
        </View>
      )}
      {deliveryPhotos.length === 0 && (
        <Text style={styles.photoHint}>
          {evidenceRequired ? `Attach at least 1 photo (max ${MAX_PHOTOS}) as evidence of delivery` : `Optional: attach up to ${MAX_PHOTOS} photos as evidence`}
        </Text>
      )}
      {deliveryPhotos.length >= 1 && deliveryPhotos.length < MAX_PHOTOS && (
        <Text style={styles.photoHint}>You can add up to {MAX_PHOTOS - deliveryPhotos.length} more</Text>
      )}

      <View style={styles.bottomSpacer} />

      {evidenceRequired && deliveryPhotos.length === 0 && (
        <Text style={styles.evidenceAssistText}>Please update evidence of delivery to proceed</Text>
      )}

      <TouchableOpacity
        style={[styles.payBtn, !canProceed && styles.payBtnDisabled]}
        onPress={handleProceed}
        disabled={loading || !canProceed}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
            <Text style={styles.btnText}>Confirm & Deliver</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

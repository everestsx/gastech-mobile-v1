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
import SignatureCanvas from 'react-native-signature-canvas';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedJournals, getSaleOrderDetailsFromDB } from '../services/sync.service';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import * as FileSystem from 'expo-file-system';

/** Base64 encoding for readAsStringAsync/writeAsStringAsync (EncodingType may be undefined in some envs). */
const BASE64 = (FileSystem.EncodingType && FileSystem.EncodingType.Base64) || 'base64';
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
  const { saleOrderId, total, deliveryDone } = route.params || {};
  const orderTotal = Number(total) || 0;
  const [loading, setLoading] = useState(false);
  const [journalsLoading, setJournalsLoading] = useState(true);
  const [journals, setJournals] = useState([]);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState([]);
  const [cashAmount, setCashAmount] = useState('');
  const [checkAmount, setCheckAmount] = useState('');
  const [selectedJournalId, setSelectedJournalId] = useState(null);
  const [checkNumber, setCheckNumber] = useState('');
  const [selectedLocalBankId, setSelectedLocalBankId] = useState(null);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [deliveryPhotos, setDeliveryPhotos] = useState([]);
  const cashInputRef = useRef(null);
  const checkInputRef = useRef(null);
  const signatureRef = useRef(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const MAX_PHOTOS = 3;

  const cashJournals = useMemo(
    () => (journals || []).filter((j) => j.type === 'cash'),
    [journals]
  );
  const cashJournalPreferred = useMemo(
    () => cashJournals.find((j) => (j.code || '').toUpperCase() === JOURNAL_CODE_CASH) || cashJournals[0],
    [cashJournals]
  );
  const chequeJournals = useMemo(
    () =>
      (journals || []).filter(
        (j) =>
          (j.code || '').toUpperCase() === JOURNAL_CODE_CHEQUE ||
          (j.name || '').toLowerCase().includes('cheque')
      ),
    [journals]
  );
  const bankJournals = useMemo(
    () => (journals || []).filter((j) => j.type === 'bank'),
    [journals]
  );
  const journalsForType = selectedPaymentMethods.includes(PAYMENT_CHECK) ? chequeJournals : [];
  const cashAmountNum = useMemo(() => {
    if (!selectedPaymentMethods.includes(PAYMENT_CASH)) return 0;
    const n = parseFloat(String(cashAmount).replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [cashAmount, selectedPaymentMethods]);

  const checkAmountNum = useMemo(() => {
    if (!selectedPaymentMethods.includes(PAYMENT_CHECK)) return 0;
    const n = parseFloat(String(checkAmount).replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [checkAmount, selectedPaymentMethods]);

  const creditAmountNum = useMemo(
    () => Math.max(0, orderTotal - cashAmountNum - checkAmountNum),
    [orderTotal, cashAmountNum, checkAmountNum]
  );
  const totalEntered = cashAmountNum + checkAmountNum + creditAmountNum;
  const hasAnyPayment = totalEntered > 0;

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
  const chequeJournalInternal = chequeJournals[0];
  const paymentComplete =
    hasAnyPayment &&
    totalEntered >= orderTotal &&
    (cashAmountNum <= 0 || (cashJournalPreferred != null)) &&
    (checkAmountNum <= 0 || (chequeJournalInternal != null && checkNumberTrimmed !== '' && selectedLocalBankId != null)) &&
    (creditAmountNum <= 0 || true);

  const evidenceRequired = checkAmountNum > 0 || creditAmountNum > 0;
  const canProceed =
    paymentComplete &&
    (evidenceRequired ? deliveryPhotos.length >= 1 : true);

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
    if (selectedPaymentMethods.includes(PAYMENT_CHECK) && chequeJournals.length > 0) {
      setSelectedJournalId(chequeJournals[0].id);
    }
  }, [selectedPaymentMethods, chequeJournals]);

  // Auto-select Credit when cash + check is less than total (remaining goes to credit)
  useEffect(() => {
    const cashPlusCheck = cashAmountNum + checkAmountNum;
    if (cashPlusCheck < orderTotal && creditAmountNum > 0 && !selectedPaymentMethods.includes(PAYMENT_CREDIT)) {
      setSelectedPaymentMethods((prev) => [...prev, PAYMENT_CREDIT]);
    }
  }, [cashAmountNum, checkAmountNum, orderTotal, creditAmountNum, selectedPaymentMethods]);

  // Auto-deselect Credit when cash + check covers full total (credit amount becomes 0)
  useEffect(() => {
    if (creditAmountNum === 0 && selectedPaymentMethods.includes(PAYMENT_CREDIT)) {
      setSelectedPaymentMethods((prev) => prev.filter((m) => m !== PAYMENT_CREDIT));
    }
  }, [creditAmountNum, selectedPaymentMethods]);

  const togglePaymentMethod = useCallback((method) => {
    setSelectedPaymentMethods((prev) => {
      const has = prev.includes(method);
      if (has) {
        const next = prev.filter((m) => m !== method);
        if (next.length === 0) return prev;
        if (method === PAYMENT_CASH) setCashAmount('');
        if (method === PAYMENT_CHECK) {
          setCheckAmount('');
          setSelectedLocalBankId(null);
          setCheckNumber('');
        }
        return next;
      }
      const cashNum = parseFloat(String(cashAmount).replace(/,/g, '')) || 0;
      const checkNum = parseFloat(String(checkAmount).replace(/,/g, '')) || 0;
      const remaining = Math.max(0, orderTotal - (method === PAYMENT_CASH ? checkNum : cashNum));
      if (method === PAYMENT_CASH) setCashAmount(remaining > 0 ? formatAmount(remaining) : '');
      if (method === PAYMENT_CHECK) setCheckAmount(remaining > 0 ? formatAmount(remaining) : '');
      return [...prev, method];
    });
  }, [orderTotal, cashAmount, checkAmount]);

  const handleProceed = async (customerSignatureDataUrl = null) => {
    if (!canProceed) return;
    const cashJournalId = cashJournalPreferred?.id ?? null;
    const checkJournalId = (chequeJournalInternal?.id ?? selectedJournalId) ?? null;
    const needsCash = cashAmountNum > 0 && cashJournalId != null;
    const needsCheck = checkAmountNum > 0 && checkJournalId != null;
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

      await saleOrdersDb.updateSaleOrderInvoiceStatusLocal(saleOrderId, 'invoiced');

      const payments = [];
      const paymentSplit = { cash: 0, check: 0, credit: 0 };
      if (needsCash) {
        payments.push({ type: 'cash', amount: cashAmountNum, journalId: cashJournalId });
        paymentSplit.cash = cashAmountNum;
      }
      if (needsCheck) {
        payments.push({
          type: 'check',
          amount: checkAmountNum,
          journalId: checkJournalId,
          checkNumber: checkNumberTrimmed || undefined,
        });
        paymentSplit.check = checkAmountNum;
      }
      if (needsCredit) {
        payments.push({ type: 'credit', amount: creditAmountNum });
        paymentSplit.credit = creditAmountNum;
      }
      if (payments.length === 0) return;

      const soId = Number(saleOrderId);
      const timestamp = Date.now();
      const photoCount = deliveryPhotos.length;
      // Doc: store URI only in SQLite (no base64 in payload). Copy image to persistent path; sync will read path→base64→ir.attachment.create→message_post.
      console.log(`[Payment] Proof photos: ${photoCount}. Storing in offline_attachments (sync will attach).`);
      for (let i = 0; i < deliveryPhotos.length; i++) {
        const uri = deliveryPhotos[i];
        if (!uri || typeof uri !== 'string') continue;
        try {
          const rawBase64 = await FileSystem.readAsStringAsync(uri, { encoding: BASE64 });
          if (!rawBase64 || rawBase64.length < 100) continue;
          const ext = (uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          const fileName = `proof_${soId}_${timestamp}_${i}.${ext}`;
          const destPath = `${FileSystem.documentDirectory}${fileName}`;
          await FileSystem.writeAsStringAsync(destPath, rawBase64, { encoding: BASE64 });
          await offlineAttachmentsDb.insert({
            sale_order_id: soId,
            local_file_path: destPath,
            file_name: fileName,
            mime_type: ext === 'png' ? 'image/png' : 'image/jpeg',
          });
          console.log(`[Payment] Proof ${i + 1}: saved to ${destPath}, row in offline_attachments.`);
        } catch (e) {
          console.warn('[Payment] save proof photo', i, e?.message ?? e);
        }
      }

      const queuePayload = {
        saleOrderId: soId,
        partnerId,
        orderName,
        invoiceNumber,
        total: orderTotal,
        payments,
        chequeBankName: needsCheck ? selectedLocalBank?.name : undefined,
        checkNumber: needsCheck ? (checkNumberTrimmed || undefined) : undefined,
      };
      await syncQueueDb.enqueue(syncQueueDb.ACTION_PAYMENT, queuePayload);
      console.log(`[Payment] Enqueued payment for SO ${saleOrderId}. Sync will: read proof URIs → base64 → ir.attachment.create → message_post(attachment_ids).`);

      const primaryPaymentType = needsCredit ? 'credit' : needsCheck ? 'cheque' : 'cash';
      await saleOrdersDb.updateSaleOrderPaymentTypeLocal(saleOrderId, primaryPaymentType);

      navigation.replace('InvoiceScreen', {
        saleOrderId,
        total,
        invoiceNumber,
        paymentType: 'split',
        paymentSplit,
        selectedBankId: needsCheck ? checkJournalId : null,
        selectedBankName: needsCheck ? selectedLocalBank?.name : undefined,
        chequeBankName: needsCheck ? (selectedLocalBank?.name ?? undefined) : undefined,
        deliveryPhotoUris: deliveryPhotos,
        cashAmount: paymentSplit.cash,
        checkNumber: needsCheck ? (checkNumber || undefined) : undefined,
        customerSignatureDataUrl: customerSignatureDataUrl ?? undefined,
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
          width: '75',
          height: '75',
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
        <Text style={styles.totalLabel}>Total Amount</Text>
        <Text style={styles.total}>Rs. {formatAmount(total)}</Text>
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
          <Text style={[styles.radioLabel, selectedPaymentMethods.includes(PAYMENT_CHECK) && styles.radioLabelSelected]}>Check</Text>
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
                  onChangeText={setCashAmount}
                  onFocus={() => setCashAmount('')}
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
                  onChangeText={setCheckAmount}
                  onFocus={() => setCheckAmount('')}
                  placeholder="Cheque"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            ) : null}
          </View>
        </View>
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
                      <Text style={styles.changeBankText}>Switch bank</Text>
                    </TouchableOpacity>
                  </>
                ) : filteredBanks.length === 0 ? (
                  <Text style={styles.noBanksText}>No banks match "{bankSearchQuery}"</Text>
                ) : (
                  filteredBanks.map((bank) => (
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
                  ))
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
            <Text style={styles.creditAmountHint}>Remaining after Cash & Check</Text>
            <Text style={styles.creditAmountText}> Rs. {formatAmount(creditAmountNum)}</Text>
          </View>
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
      {deliveryPhotos.length === 0 && (
        <Text style={styles.photoHint}>
          {evidenceRequired ? `Attach at least 1 photo (max ${MAX_PHOTOS}) as evidence of delivery` : `Optional: attach up to ${MAX_PHOTOS} photos as evidence`}
        </Text>
      )}
      {deliveryPhotos.length >= 1 && deliveryPhotos.length < MAX_PHOTOS && (
        <Text style={styles.photoHint}>You can add up to {MAX_PHOTOS - deliveryPhotos.length} more</Text>
      )}

      {evidenceRequired && deliveryPhotos.length === 0 && (
        <Text style={styles.evidenceAssistText}>Please update evidence of delivery to proceed</Text>
      )}

      <TouchableOpacity
        style={[styles.payBtn, !canProceed && styles.payBtnDisabled]}
        onPress={() => {
          if (!canProceed) return;
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
            <Text style={styles.btnText}>Confirm & Deliver</Text>
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
            <Text style={[styles.signatureModalTitle, { color: colors.text }]}>Customer signature</Text>
            <Text style={[styles.signatureModalHint, { color: colors.textSecondary }]}>Sign in the box below, then tap Confirm</Text>
            <View style={styles.signatureCanvasWrap}>
              <SignatureCanvas
                ref={signatureRef}
                onOK={(dataUrl) => {
                  setShowSignatureModal(false);
                  handleProceed(dataUrl);
                }}
                onEmpty={() => {
                  Alert.alert('Signature required', 'Please sign above before confirming.');
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
                onPress={() => signatureRef.current?.clearSignature()}
                activeOpacity={0.8}
              >
                <Text style={[styles.signatureActionBtnText, { color: colors.textSecondary }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signatureActionBtn, styles.signatureConfirmBtn, { backgroundColor: colors.primary }]}
                onPress={() => signatureRef.current?.readSignature()}
                activeOpacity={0.8}
              >
                <Text style={[styles.signatureActionBtnText, { color: '#fff' }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.signatureCancelBtn, { borderColor: colors.border }]}
              onPress={() => setShowSignatureModal(false)}
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

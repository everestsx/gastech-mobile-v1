import { useState, useMemo, useEffect, useCallback } from 'react';
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
import { getCachedJournals, getSaleOrderDetailsFromDB } from '../services/sync.service';
import * as saleOrdersDb from '../database/saleOrders.js';
import * as syncQueueDb from '../database/syncQueue.js';
import { JOURNAL_CODE_CASH, JOURNAL_CODE_CHEQUE } from '../constants/journals';

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
  const [selectedJournalId, setSelectedJournalId] = useState(null);
  const [journalSearch, setJournalSearch] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [deliveryPhotos, setDeliveryPhotos] = useState([]);

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
  const journalsForType = paymentType === PAYMENT_CHECK ? chequeJournals : [];
  const filteredJournals = useMemo(() => {
    const q = (journalSearch || '').trim().toLowerCase();
    if (!q) return journalsForType;
    return journalsForType.filter(
      (j) =>
        (j.name || '').toLowerCase().includes(q) ||
        (j.code || '').toLowerCase().includes(q)
    );
  }, [journalSearch, journalsForType]);

  const selectedJournal =
    selectedJournalId != null ? journals.find((j) => j.id === selectedJournalId) : null;
  const isSelectedJournalValid =
    selectedJournal &&
    (selectedJournal.code?.toUpperCase() === JOURNAL_CODE_CHEQUE || (selectedJournal.name || '').toLowerCase().includes('cheque'));

  const checkNumberTrimmed = useMemo(() => (checkNumber != null ? String(checkNumber).trim() : ''), [checkNumber]);

  // One payment method only: full order total. No partial/split.
  const paymentComplete = useMemo(() => {
    if (paymentType === PAYMENT_CASH) return cashJournalPreferred != null;
    if (paymentType === PAYMENT_CHECK) return !!isSelectedJournalValid && selectedJournalId != null && checkNumberTrimmed !== '';
    if (paymentType === PAYMENT_CREDIT) return true;
    return false;
  }, [paymentType, cashJournalPreferred, isSelectedJournalValid, selectedJournalId, checkNumberTrimmed]);

  const evidenceRequired = paymentType === PAYMENT_CHECK || paymentType === PAYMENT_CREDIT;
  const canProceed = paymentComplete && (evidenceRequired ? deliveryPhotos.length >= 1 : true);

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
    if (paymentType === PAYMENT_CHECK) {
      if (!isSelectedJournalValid && selectedJournalId != null) {
        setSelectedJournalId(null);
        setJournalSearch('');
      }
      if (chequeJournals.length === 1 && selectedJournalId !== chequeJournals[0]?.id) {
        setSelectedJournalId(chequeJournals[0].id);
      }
    }
  }, [paymentType, isSelectedJournalValid, selectedJournalId, chequeJournals]);

  const handleProceed = async () => {
    if (!canProceed) return;
    const cashJournalId = cashJournalPreferred?.id ?? null;
    const checkJournalId = selectedJournalId != null && isSelectedJournalValid ? selectedJournalId : null;
    const isCash = paymentType === PAYMENT_CASH && cashJournalId != null;
    const isCheck = paymentType === PAYMENT_CHECK && checkJournalId != null && checkNumberTrimmed !== '';
    const isCredit = paymentType === PAYMENT_CREDIT;
    if (!isCash && !isCheck && !isCredit) return;
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
      let paymentSplit = { cash: 0, check: 0, credit: 0 };
      if (isCash) {
        payments.push({ type: 'cash', amount: orderTotal, journalId: cashJournalId });
        paymentSplit = { cash: orderTotal, check: 0, credit: 0 };
      } else if (isCheck) {
        payments.push({
          type: 'check',
          amount: orderTotal,
          journalId: checkJournalId,
          checkNumber: checkNumberTrimmed || undefined,
        });
        paymentSplit = { cash: 0, check: orderTotal, credit: 0 };
      } else if (isCredit) {
        payments.push({ type: 'credit', amount: orderTotal });
        paymentSplit = { cash: 0, check: 0, credit: orderTotal };
      }
      if (payments.length === 0) return;

      await syncQueueDb.enqueue(syncQueueDb.ACTION_PAYMENT, {
        saleOrderId,
        partnerId,
        orderName,
        total: orderTotal,
        payments,
        deliveryPhotoUris: deliveryPhotos,
      });

      const primaryPaymentType = isCredit ? 'credit' : isCheck ? 'cheque' : 'cash';
      await saleOrdersDb.updateSaleOrderPaymentTypeLocal(saleOrderId, primaryPaymentType);

      navigation.replace('InvoiceScreen', {
        saleOrderId,
        total,
        paymentType: 'split',
        paymentSplit,
        selectedBankId: isCheck ? checkJournalId : null,
        selectedBankName: selectedJournal?.name ?? (isCheck ? null : undefined),
        deliveryPhotoUris: deliveryPhotos,
        cashAmount: paymentSplit.cash,
        checkNumber: needsCheck ? (checkNumber || undefined) : undefined,
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
        amountRowHalf: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginBottom: spacing.sm,
        },
        amountHalfCol: { flex: 1 },
        cashInputWrap: {
          flex: 1,
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
        searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
        searchClear: { padding: 2 },
        selectedBankWrap: { marginBottom: spacing.sm },
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

      {/* Payment method: checkboxes (multi-select) */}
      <Text style={styles.sectionLabel}>Payment method</Text>
      <View style={styles.radioRow}>
        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CASH && styles.radioOptionSelected]}
          onPress={() => setPaymentType(PAYMENT_CASH)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, paymentType === PAYMENT_CASH && styles.checkboxBoxSelected]}>
            {paymentType === PAYMENT_CASH && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="cash-outline" size={22} color={paymentType === PAYMENT_CASH ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CASH && styles.radioLabelSelected]}>Cash</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CHECK && styles.radioOptionSelected]}
          onPress={() => setPaymentType(PAYMENT_CHECK)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, paymentType === PAYMENT_CHECK && styles.checkboxBoxSelected]}>
            {paymentType === PAYMENT_CHECK && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="card-outline" size={22} color={paymentType === PAYMENT_CHECK ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CHECK && styles.radioLabelSelected]}>Check</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CREDIT && styles.radioOptionSelected]}
          onPress={() => setPaymentType(PAYMENT_CREDIT)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkboxBox, paymentType === PAYMENT_CREDIT && styles.checkboxBoxSelected]}>
            {paymentType === PAYMENT_CREDIT && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Ionicons name="wallet-outline" size={22} color={paymentType === PAYMENT_CREDIT ? '#fff' : colors.text} />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CREDIT && styles.radioLabelSelected]}>Credit</Text>
        </TouchableOpacity>
      </View>

      {/* One method = full order total. No partial payment. */}
      {paymentType === PAYMENT_CASH && (
        <View style={styles.creditAmountWrap}>
          <Ionicons name="cash-outline" size={24} color={colors.primary} />
          <Text style={styles.creditAmountText}>LKR {orderTotal.toFixed(2)}</Text>
          <Text style={styles.creditAmountHint}>Full amount (auto-loaded)</Text>
        </View>
      )}

      {paymentType === PAYMENT_CHECK && (
        <>
          <Text style={styles.sectionLabel}>Select Bank <Text style={styles.requiredStar}>*</Text></Text>
          {journalsLoading ? (
            <View style={styles.bankList}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.noBanksText}>Loading journals…</Text>
            </View>
          ) : selectedJournal && isSelectedJournalValid ? (
            <View style={styles.selectedBankWrap}>
              <TouchableOpacity style={styles.bankCardSelectedOnly} onPress={() => {}} activeOpacity={1}>
                <View style={styles.bankIconWrapSmall}>
                  <Ionicons name="card-outline" size={22} color="#fff" />
                </View>
                <Text style={styles.bankNameSelectedOnly} numberOfLines={1}>
                  {selectedJournal.name} {selectedJournal.code ? `(${selectedJournal.code})` : ''}
                </Text>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.changeBankBtn}
                onPress={() => {
                  setSelectedJournalId(null);
                  setJournalSearch('');
                  setCheckNumber('');
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                <Text style={styles.changeBankText}>Change Bank</Text>
              </TouchableOpacity>
              <View style={[styles.creditAmountWrap, { marginTop: spacing.md }]}>
                <Ionicons name="card-outline" size={24} color={colors.primary} />
                <Text style={styles.creditAmountText}>LKR {orderTotal.toFixed(2)}</Text>
                <Text style={styles.creditAmountHint}>Full amount (auto-loaded)</Text>
              </View>
              <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>Check number <Text style={styles.requiredStar}>*</Text></Text>
              <TextInput
                style={[styles.checkAmountInput, { marginBottom: spacing.lg }]}
                value={checkNumber}
                onChangeText={setCheckNumber}
                placeholder="Enter check number"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          ) : (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={journalSearch}
                  onChangeText={setJournalSearch}
                  placeholder="Search check journals…"
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
                {filteredJournals.map((journal) => (
                  <TouchableOpacity key={journal.id} style={styles.bankCard} onPress={() => setSelectedJournalId(journal.id)} activeOpacity={0.8}>
                    <View style={styles.bankIconWrap}>
                      <Ionicons name="card-outline" size={24} color={colors.primary} />
                    </View>
                    <Text style={styles.bankName} numberOfLines={1}>{journal.name} {journal.code ? `(${journal.code})` : ''}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
                {filteredJournals.length === 0 && (
                  <Text style={styles.noBanksText}>
                    {journalsForType.length === 0 ? 'No Cheque journal (CSH5) in Odoo' : 'No journals match your search'}
                  </Text>
                )}
              </View>
            </>
          )}
        </>
      )}

      {paymentType === PAYMENT_CREDIT && (
        <View style={styles.creditAmountWrap}>
          <Ionicons name="wallet-outline" size={24} color={colors.primary} />
          <Text style={styles.creditAmountText}>LKR {orderTotal.toFixed(2)}</Text>
          <Text style={styles.creditAmountHint}>Full amount (auto-loaded)</Text>
        </View>
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

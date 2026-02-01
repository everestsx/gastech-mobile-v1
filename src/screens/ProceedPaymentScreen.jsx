import { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../constants/theme';
import { SRI_LANKA_BANKS } from '../constants/sriLankaBanks';
import { confirmSaleOrder } from '../services/saleOrderLine.service';
import {
  getPickingBySaleOrder,
  getMoveLines,
  updateMoveLineQty,
  validatePicking,
} from '../services/delivery.service';

const PAYMENT_CASH = 'cash';
const PAYMENT_BANK = 'bank';

export default function ProceedPaymentScreen({ route, navigation }) {
  const { saleOrderId, total } = route.params;
  const [loading, setLoading] = useState(false);
  const [paymentType, setPaymentType] = useState(PAYMENT_CASH);
  const [selectedBankId, setSelectedBankId] = useState(null);
  const [bankSearch, setBankSearch] = useState('');

  const filteredBanks = useMemo(() => {
    const q = (bankSearch || '').trim().toLowerCase();
    if (!q) return SRI_LANKA_BANKS;
    return SRI_LANKA_BANKS.filter((b) => b.name.toLowerCase().includes(q));
  }, [bankSearch]);

  const selectedBank = selectedBankId
    ? SRI_LANKA_BANKS.find((b) => b.id === selectedBankId)
    : null;

  const canProceed =
    paymentType === PAYMENT_CASH || (paymentType === PAYMENT_BANK && selectedBankId != null);

  const handleProceed = async () => {
    if (!canProceed) return;
    try {
      setLoading(true);

      await confirmSaleOrder(saleOrderId);

      const pickings = await getPickingBySaleOrder(saleOrderId);
      if (!pickings.length) {
        throw new Error('No delivery order found');
      }

      const picking = pickings[0];
      const moveLines = await getMoveLines(picking.move_line_ids);

      for (const ml of moveLines) {
        const demandQty = ml.product_uom_qty;
        if (demandQty > 0) {
          await updateMoveLineQty(ml.id, demandQty);
        }
      }

      await validatePicking(picking.id);

      const selectedBankName =
        paymentType === PAYMENT_BANK && selectedBank
          ? selectedBank.name
          : null;

      navigation.replace('InvoiceScreen', {
        saleOrderId,
        total,
        paymentType,
        selectedBankId: paymentType === PAYMENT_BANK ? selectedBankId : null,
        selectedBankName,
      });
    } catch (err) {
      console.error(err);
      Alert.alert(
        'Delivery Error',
        err.message || 'Failed to complete delivery'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Confirm Payment</Text>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Amount</Text>
        <Text style={styles.total}>LKR {Number(total).toFixed(2)}</Text>
      </View>

      {/* Payment type: Cash | Bank */}
      <Text style={styles.sectionLabel}>Payment method</Text>
      <View style={styles.radioRow}>
        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_CASH && styles.radioOptionSelected]}
          onPress={() => {
            setPaymentType(PAYMENT_CASH);
            setSelectedBankId(null);
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.radioCircle, paymentType === PAYMENT_CASH && styles.radioCircleSelected]}>
            {paymentType === PAYMENT_CASH && <View style={styles.radioDot} />}
          </View>
          <Ionicons
            name="cash-outline"
            size={22}
            color={paymentType === PAYMENT_CASH ? '#fff' : colors.text}
          />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_CASH && styles.radioLabelSelected]}>
            Cash
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.radioOption, paymentType === PAYMENT_BANK && styles.radioOptionSelected]}
          onPress={() => setPaymentType(PAYMENT_BANK)}
          activeOpacity={0.8}
        >
          <View style={[styles.radioCircle, paymentType === PAYMENT_BANK && styles.radioCircleSelected]}>
            {paymentType === PAYMENT_BANK && <View style={styles.radioDot} />}
          </View>
          <Ionicons
            name="card-outline"
            size={22}
            color={paymentType === PAYMENT_BANK ? '#fff' : colors.text}
          />
          <Text style={[styles.radioLabel, paymentType === PAYMENT_BANK && styles.radioLabelSelected]}>
            Bank
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bank list when Bank selected */}
      {paymentType === PAYMENT_BANK && (
        <>
          <Text style={styles.sectionLabel}>Select bank (Sri Lanka)</Text>

          {selectedBank ? (
            <View style={styles.selectedBankWrap}>
              <TouchableOpacity
                style={styles.bankCardSelectedOnly}
                onPress={() => {}}
                activeOpacity={1}
              >
                <View style={styles.bankIconWrapSmall}>
                  <Ionicons name={selectedBank.icon} size={22} color="#fff" />
                </View>
                <Text style={styles.bankNameSelectedOnly} numberOfLines={1}>
                  {selectedBank.name}
                </Text>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.changeBankBtn}
                onPress={() => {
                  setSelectedBankId(null);
                  setBankSearch('');
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                <Text style={styles.changeBankText}>Change bank</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={bankSearch}
                  onChangeText={setBankSearch}
                  placeholder="Search banks..."
                  placeholderTextColor={colors.textSecondary}
                  returnKeyType="search"
                />
                {bankSearch.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setBankSearch('')}
                    style={styles.searchClear}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.bankList}>
                {filteredBanks.map((bank) => (
                  <TouchableOpacity
                    key={bank.id}
                    style={styles.bankCard}
                    onPress={() => setSelectedBankId(bank.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.bankIconWrap}>
                      <Ionicons name={bank.icon} size={24} color={colors.primary} />
                    </View>
                    <Text style={styles.bankName} numberOfLines={1}>
                      {bank.name}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
                {filteredBanks.length === 0 && (
                  <Text style={styles.noBanksText}>No banks match your search</Text>
                )}
              </View>
            </>
          )}
        </>
      )}

      <View style={styles.bottomSpacer} />

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl + 80,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
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
  totalLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  total: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  radioRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  radioOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
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
  radioOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#fff',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  radioLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  radioLabelSelected: {
    color: '#fff',
  },
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
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  searchClear: {
    padding: 2,
  },
  selectedBankWrap: {
    marginBottom: spacing.lg,
  },
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
  bankNameSelectedOnly: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  changeBankBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 8,
  },
  changeBankText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  bankList: {
    marginBottom: spacing.lg,
  },
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
  bankName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  noBanksText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  bottomSpacer: { height: spacing.md },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.success,
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  payBtnDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.7,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

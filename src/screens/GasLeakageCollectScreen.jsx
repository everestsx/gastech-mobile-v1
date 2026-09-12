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
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedOrders, getUserSession } from '../services/sync.service';
import { getAllPartners, getCustomersByVehicle } from '../database/partners';
import { getLocalizedCustomerName } from '../utils/customerDisplayName';
import { labelFromKg } from '../utils/cylinderCatalog';
import { customersFromOrdersTab, indexPartnersById } from '../utils/orderTabCustomers';
import { formatLocalYyyyMmDd } from '../utils/localDate';
import {
  LEAKAGE_REASON_PRESETS,
  loadLeakageCylinderProducts,
  buildGasLeakageChatterBody,
  submitLeakageCollectOfflineFirst,
} from '../services/gasLeakage.service';

const REASON_FALLBACKS = {
  en: {
    gasBurnerIssue: 'Gas Burner Issue',
    gasLeakage: 'Gas Leakage',
    cylinderDamage: 'Cylinder Damage',
    valveIssue: 'Valve Issue',
    others: 'Others',
  },
  si: {
    gasBurnerIssue: 'ගෑස් බර්නර් ගැටලුව',
    gasLeakage: 'ගෑස් කාන්දුව',
    cylinderDamage: 'සිලින්ඩරය හානි වීම',
    valveIssue: 'වෑල්ව් ගැටලුව',
    others: 'වෙනත්',
  },
  ta: {
    gasBurnerIssue: 'கேஸ் பர்னர் பிரச்சினை',
    gasLeakage: 'கேஸ் கசிவு',
    cylinderDamage: 'சிலிண்டர் சேதம்',
    valveIssue: 'வால்வு பிரச்சினை',
    others: 'மற்றவை',
  },
};

function uniquePartners(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const p of list || []) {
      const id = Number(p?.id);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(p);
    }
  }
  return out;
}

function groupRowsByKg(productRows) {
  const map = new Map();
  for (const row of productRows || []) {
    const kg = Number(row.kg);
    if (!map.has(kg)) map.set(kg, { kg, gas: null, empty: null });
    const group = map.get(kg);
    if (row.kind === 'empty') group.empty = row;
    else group.gas = row;
  }
  return [...map.values()].sort((a, b) => a.kg - b.kg);
}

export default function GasLeakageCollectScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { colors, appLanguage } = useTheme();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productRows, setProductRows] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [customerModalVisible, setCustomerModalVisible] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('today');
  const [allPartners, setAllPartners] = useState([]);
  const [saleOrders, setSaleOrders] = useState([]);
  const [partnerQuery, setPartnerQuery] = useState('');
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [selectedReasonKey, setSelectedReasonKey] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'default',
    buttons: [],
  });
  const todayStr = formatLocalYyyyMmDd(new Date());

  const hideAlert = useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  const showAlert = useCallback((title, message, { type = 'default', buttons } = {}) => {
    setAlertConfig({
      visible: true,
      title,
      message,
      type,
      buttons: buttons || [
        {
          text: t('common.ok', 'OK'),
          onPress: () => setAlertConfig((prev) => ({ ...prev, visible: false })),
        },
      ],
    });
  }, [t]);

  const resolvedLanguage = useMemo(
    () => String(i18n?.resolvedLanguage || i18n?.language || 'en').split('-')[0].toLowerCase(),
    [i18n?.language, i18n?.resolvedLanguage]
  );

  const reasonOptions = useMemo(
    () =>
      LEAKAGE_REASON_PRESETS.map((item) => ({
        ...item,
        label:
          t(`gasleakagecollect.reasons.${item.key}`, { defaultValue: '' }) ||
          REASON_FALLBACKS[resolvedLanguage]?.[item.key] ||
          REASON_FALLBACKS.en[item.key],
      })),
    [resolvedLanguage, t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await loadLeakageCylinderProducts({ allowRemote: false });
      setProductRows((rows || []).map((row) => ({ ...row, qty: 0 })));
      const session = await getUserSession();
      const vehicleId = session?.vehicleId;
      const [byVehicle, all, orders] = await Promise.all([
        vehicleId != null ? getCustomersByVehicle(vehicleId) : Promise.resolve([]),
        getAllPartners(),
        getCachedOrders(vehicleId ?? null),
      ]);
      setAllPartners(uniquePartners([byVehicle, all]));
      setSaleOrders(Array.isArray(orders) ? orders : []);
    } catch {
      setProductRows([]);
      setAllPartners([]);
      setSaleOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupRowsByKg(productRows), [productRows]);
  const totalCollected = useMemo(
    () => productRows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    [productRows]
  );
  const hasCollection = totalCollected > 0;

  const partnerLookup = useMemo(() => indexPartnersById(allPartners), [allPartners]);
  const todayPartners = useMemo(
    () => customersFromOrdersTab(saleOrders, todayStr, 'delivery_date', partnerLookup),
    [partnerLookup, saleOrders, todayStr]
  );
  const catalogPartners = customerFilter === 'today' ? todayPartners : allPartners;

  const filteredPartners = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    if (!q) return catalogPartners;
    return catalogPartners.filter((p) => {
      const name = String(getLocalizedCustomerName(p, appLanguage) || '').toLowerCase();
      const phone = String(p.phone || '').toLowerCase();
      const city = String(p.city || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || city.includes(q);
    });
  }, [appLanguage, catalogPartners, partnerQuery]);

  const setQty = useCallback((productKey, text) => {
    const cleaned = String(text || '').replace(/[^0-9]/g, '');
    const nextNum = cleaned === '' ? 0 : Math.max(0, parseInt(cleaned, 10) || 0);
    setProductRows((prev) =>
      prev.map((r) => (rowKey(r) === productKey ? { ...r, qty: nextNum } : r))
    );
  }, []);

  const changeQtyBy = useCallback((productKey, delta) => {
    setProductRows((prev) =>
      prev.map((r) => {
        if (rowKey(r) !== productKey) return r;
        return { ...r, qty: Math.max(0, (Number(r.qty) || 0) + delta) };
      })
    );
  }, []);

  const persistAndContinue = useCallback(
    async (reasonApi) => {
      setSaving(true);
      try {
        const partnerId = Number(selectedPartner?.id);
        if (!Number.isFinite(partnerId) || partnerId <= 0) {
          throw new Error(t('gasleakagecollect.pleaseSelectACustomer', 'Please select a customer.'));
        }
        const collected = productRows.filter((r) => Number(r.qty) > 0);
        const missing = collected.filter((r) => r.productId == null);
        if (missing.length > 0) {
          throw new Error(
            t(
              'gasleakagecollect.productMissing',
              'Gas product mapping is missing for some sizes. Sync master data and try again.'
            )
          );
        }
        const chatterBody = buildGasLeakageChatterBody(collected, reasonApi);

        await submitLeakageCollectOfflineFirst({
          partnerId,
          reason: reasonApi,
          moves: collected.map((r) => ({
            productId: r.productId,
            qty: Number(r.qty),
            kg: r.kg,
            kind: r.kind,
            displayName: r.displayName,
          })),
          saleOrderId: null,
          chatterBody,
          chatterAttachedToPayment: false,
          partnerName: selectedPartner?.name || '',
          source: 'menu',
        });

        setReasonModalVisible(false);
        showAlert(
          t('gasleakagecollect.successTitle', 'Collection saved'),
          t('gasleakagecollect.successBody', 'Gas leakage collection was saved and will sync to Back Office.'),
          {
            type: 'success',
            buttons: [
              {
                text: t('common.ok', 'OK'),
                onPress: () => {
                  hideAlert();
                  navigation.goBack();
                },
              },
            ],
          }
        );
      } catch (e) {
        showAlert(
          t('gasleakagecollect.error', 'Error'),
          e?.message || t('gasleakagecollect.submitFailed', 'Could not submit gas leakage collection.'),
          { type: 'error' }
        );
      } finally {
        setSaving(false);
      }
    },
    [hideAlert, navigation, productRows, selectedPartner, showAlert, t]
  );

  const onPressContinue = useCallback(() => {
    if (!selectedPartner?.id) {
      showAlert(
        t('gasleakagecollect.customerRequired', 'Customer required'),
        t('gasleakagecollect.pleaseSelectACustomer', 'Please select a customer.'),
        { type: 'warning' }
      );
      return;
    }
    if (!hasCollection) {
      showAlert(
        t('gasleakagecollect.quantityRequired', 'Quantity required'),
        t('gasleakagecollect.pleaseCollectAtLeastOne', 'Please enter quantity for at least one product.'),
        { type: 'warning' }
      );
      return;
    }
    setSelectedReasonKey('');
    setOtherReason('');
    setReasonModalVisible(true);
  }, [hasCollection, selectedPartner, showAlert, t]);

  const onConfirmReason = useCallback(() => {
    const selected = reasonOptions.find((reason) => reason.key === selectedReasonKey);
    const apiValue =
      selectedReasonKey === 'others'
        ? String(otherReason || '').trim()
        : String(selected?.apiValue || '').trim();
    if (!apiValue) {
      showAlert(
        t('gasleakagecollect.reasonRequired', 'Reason required'),
        selectedReasonKey === 'others'
          ? t('gasleakagecollect.pleaseTypeOtherReason', 'Please type the other reason.')
          : t('gasleakagecollect.pleaseSelectAReason', 'Please select a reason.'),
        { type: 'warning' }
      );
      return;
    }
    void persistAndContinue(apiValue);
  }, [otherReason, persistAndContinue, reasonOptions, selectedReasonKey, showAlert, t]);

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
        title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 2 },
        heroText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
        customerChip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.lg,
          padding: spacing.sm + 2,
          marginBottom: spacing.md,
        },
        customerIcon: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.primary + '14',
          alignItems: 'center',
          justifyContent: 'center',
        },
        customerLabel: {
          fontSize: 11,
          fontWeight: '800',
          color: colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        },
        customerName: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 2 },
        cardsWrap: { gap: spacing.sm },
        card: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.lg,
          padding: spacing.sm + 2,
        },
        sizeLabel: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
        sectionLabel: {
          fontSize: 11,
          fontWeight: '700',
          color: colors.textSecondary,
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        },
        qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2, marginBottom: spacing.sm },
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
        otherInput: {
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
          marginBottom: spacing.xs,
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
        searchWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.sm,
        },
        searchInput: { flex: 1, paddingVertical: 10, color: colors.text, fontSize: 15, fontWeight: '600' },
        sourceRow: {
          flexDirection: 'row',
          gap: 8,
          marginBottom: spacing.sm,
        },
        sourceTab: {
          flex: 1,
          paddingVertical: 8,
          borderRadius: 10,
          alignItems: 'center',
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
        },
        sourceTabActive: {
          borderColor: colors.primary,
          backgroundColor: colors.primarySurface || colors.primary + '14',
        },
        sourceTabText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
        sourceTabTextActive: { color: colors.primary },
        customerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
      }),
    [colors]
  );

  const renderQtyRow = (row, label) => {
    if (!row) return null;
    const key = rowKey(row);
    return (
      <View>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.qtyRow}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQtyBy(key, -1)} activeOpacity={0.85}>
            <Ionicons name="remove" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={styles.qtyInput}
            value={String(row.qty ?? 0)}
            onChangeText={(text) => setQty(key, text)}
            keyboardType="number-pad"
            selectTextOnFocus
          />
          <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQtyBy(key, 1)} activeOpacity={0.85}>
            <Ionicons name="add" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

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
          <Text style={styles.title}>{t('gasleakagecollect.title', 'Gas Leakage Collect')}</Text>
          <Text style={styles.heroText}>
            {t(
              'gasleakagecollect.heroMenu',
              'Select the customer, then enter leaked gas and empty quantities by size.'
            )}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.customerChip}
          onPress={() => {
            setCustomerFilter('today');
            setPartnerQuery('');
            setCustomerModalVisible(true);
          }}
          activeOpacity={0.85}
        >
          <View style={styles.customerIcon}>
            <Ionicons name="person-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.customerLabel}>{t('gasleakagecollect.customer', 'Customer')}</Text>
            <Text style={styles.customerName} numberOfLines={1}>
              {selectedPartner?.name || t('gasleakagecollect.selectCustomer', 'Select customer')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.cardsWrap}>
          {grouped.map((group) => (
            <View style={styles.card} key={String(group.kg)}>
              <Text style={styles.sizeLabel}>{labelFromKg(group.kg)}</Text>
              {renderQtyRow(group.gas, t('gasleakagecollect.gasProduct', 'Gas filled'))}
              {renderQtyRow(group.empty, t('gasleakagecollect.emptyProduct', 'Empty'))}
            </View>
          ))}
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>
            {t('gasleakagecollect.totalCollected', 'Total leakage collected')}
          </Text>
          <Text style={styles.summaryVal}>{totalCollected.toLocaleString('en-IN')}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footerBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity style={styles.cta} onPress={() => void onPressContinue()} disabled={saving} activeOpacity={0.88}>
          {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark-circle" size={24} color="#fff" />}
          <Text style={styles.ctaText}>{t('gasleakagecollect.continue', 'Continue')}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {hasCollection
            ? t('gasleakagecollect.reasonRequiredBecauseCollected', 'You collected leakage, so a reason is required.')
            : t('gasleakagecollect.pleaseCollectAtLeastOne', 'Please enter quantity for at least one product.')}
        </Text>
      </View>

      <Modal visible={reasonModalVisible} animationType="slide" transparent onRequestClose={() => setReasonModalVisible(false)}>
        <Pressable style={styles.modalWrap} onPress={() => setReasonModalVisible(false)}>
          <Pressable style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('gasleakagecollect.reasonForCollect', 'Reason for leakage collect')}</Text>
            <Text style={styles.modalSub}>
              {t('gasleakagecollect.selectOneReasonToContinue', 'Select one reason to continue.')}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
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
              {selectedReasonKey === 'others' ? (
                <TextInput
                  style={styles.otherInput}
                  value={otherReason}
                  onChangeText={setOtherReason}
                  placeholder={t('gasleakagecollect.otherReasonPlaceholder', 'Type the other reason')}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
              ) : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={() => setReasonModalVisible(false)}>
                <Text style={styles.modalBtnSecondaryText}>{t('gasleakagecollect.back', 'Back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnPrimary} onPress={onConfirmReason} disabled={saving}>
                <Text style={styles.modalBtnPrimaryText}>
                  {t('gasleakagecollect.saveAndContinue', 'Save and continue')}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={customerModalVisible} animationType="slide" transparent onRequestClose={() => setCustomerModalVisible(false)}>
        <Pressable style={styles.modalWrap} onPress={() => setCustomerModalVisible(false)}>
          <Pressable style={[styles.modalCard, { maxHeight: '85%', paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('gasleakagecollect.selectCustomer', 'Select customer')}</Text>
            <View style={styles.sourceRow}>
              {[
                { key: 'today', label: t('gasleakagecollect.filterTodayOrders', "Today's orders") },
                { key: 'all', label: t('gasleakagecollect.filterAllCustomers', 'All customers') },
              ].map((opt) => {
                const active = customerFilter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.sourceTab, active && styles.sourceTabActive]}
                    onPress={() => {
                      setCustomerFilter(opt.key);
                      setPartnerQuery('');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.sourceTabText, active && styles.sourceTabTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                value={partnerQuery}
                onChangeText={setPartnerQuery}
                placeholder={t('gasleakagecollect.searchCustomer', 'Search customer')}
                placeholderTextColor={colors.textSecondary}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredPartners}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 360 }}
              ListEmptyComponent={
                <Text style={[styles.heroText, { paddingVertical: spacing.md }]}>
                  {customerFilter === 'today'
                    ? t(
                        'gasleakagecollect.noTodayCustomers',
                        "No customers with today's committed orders."
                      )
                    : t('gasleakagecollect.noCustomers', 'No customers found. Sync from Menu and try again.')}
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.customerRow}
                  onPress={() => {
                    setSelectedPartner({
                      id: Number(item.id),
                      name: getLocalizedCustomerName(item, appLanguage) || item.name || `#${item.id}`,
                    });
                    setCustomerModalVisible(false);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.customerName} numberOfLines={1}>
                      {getLocalizedCustomerName(item, appLanguage) || item.name || '—'}
                    </Text>
                    {item.city || item.phone ? (
                      <Text style={styles.heroText} numberOfLines={1}>
                        {[item.city, item.phone].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={() => setCustomerModalVisible(false)}>
                <Text style={styles.modalBtnSecondaryText}>{t('gasleakagecollect.back', 'Back')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </View>
  );
}

function rowKey(row) {
  if (row?.productId != null) return `id:${row.productId}`;
  return `${row?.kg}:${row?.kind}`;
}

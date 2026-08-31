import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../context/ThemeContext';
import { borderRadius, spacing } from '../constants/theme';
import { getAllCustomers } from '../services/customer.service';
import { getCachedCustomers, getCachedOrders, getUserSession } from '../services/sync.service';
import { getLocalizedCustomerName } from '../utils/customerDisplayName';
import { formatLocalYyyyMmDd } from '../utils/localDate';
import { customersFromOrdersTab, indexPartnersById } from '../utils/orderTabCustomers';
import { shareQrPdf } from '../utils/qrPdf';
import { getGasTechLogoDataUri } from '../utils/gastechLogo';
import {
  customerInitials,
  customerQrValue,
  filterCustomers,
  qrImageFileName,
} from '../utils/customerQr';
import { captureQrBase64, savePngToGallery } from '../utils/qrFile';
import CustomerQrCard, {
  QR_CARD_BASE_HEIGHT,
  QR_CARD_BASE_WIDTH,
} from '../components/CustomerQrCard';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function QrGenerateScreen() {
  const { t } = useTranslation();
  const { colors, isDark, appLanguage, syncDateField } = useTheme();
  const insets = useSafeAreaInsets();

  const [allCustomers, setAllCustomers] = useState([]);
  const [cachedPartners, setCachedPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadCount, setLoadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('bulk');
  const [source, setSource] = useState('today');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [captureCustomer, setCaptureCustomer] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [logoDataUri, setLogoDataUri] = useState(null);

  const qrRef = useRef(null);
  const qrValueRef = useRef('');

  const styles = useMemo(() => createStyles(colors), [colors]);
  const dateStr = formatLocalYyyyMmDd(selectedDate);

  const loadLocal = useCallback(async () => {
    try {
      const session = await getUserSession();
      const vehicleId = session?.isAdmin === false ? session.vehicleId : null;
      const [orderRows, partners] = await Promise.all([
        getCachedOrders(vehicleId),
        getCachedCustomers(),
      ]);
      setOrders(Array.isArray(orderRows) ? orderRows : []);
      setCachedPartners(Array.isArray(partners) ? partners : []);
    } catch (e) {
      console.warn('[QR] load local orders', e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAllCustomers = useCallback(async () => {
    setLoadingAll(true);
    try {
      const data = await getAllCustomers({
        onProgress: (n) => setLoadCount(n),
      });
      setAllCustomers(Array.isArray(data) && data.length ? data : []);
    } catch (e) {
      console.warn('[QR] load all customers', e);
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => {
    loadLocal();
    loadAllCustomers();
    getGasTechLogoDataUri()
      .then(setLogoDataUri)
      .catch(() => setLogoDataUri(null));
  }, [loadLocal, loadAllCustomers]);

  const partnerLookup = useMemo(
    () => indexPartnersById(cachedPartners, allCustomers),
    [cachedPartners, allCustomers]
  );

  const todayCustomers = useMemo(
    () => customersFromOrdersTab(orders, dateStr, syncDateField, partnerLookup),
    [orders, dateStr, syncDateField, partnerLookup]
  );

  const catalog = source === 'today' ? todayCustomers : allCustomers.length ? allCustomers : cachedPartners;

  const filtered = useMemo(
    () => filterCustomers(catalog, search),
    [catalog, search]
  );

  const selectedCustomer = useMemo(
    () => catalog.find((c) => Number(c.id) === Number(selectedId)) || null,
    [catalog, selectedId]
  );

  const bulkSelected = useMemo(
    () => catalog.filter((c) => selectedIds[c.id]),
    [catalog, selectedIds]
  );

  const previewCustomer =
    captureCustomer ||
    (mode === 'bulk' ? bulkSelected[0] || null : selectedCustomer);
  const qrValue = previewCustomer ? customerQrValue(previewCustomer) : '';
  qrValueRef.current = qrValue;

  const displayName = useCallback(
    (customer) => getLocalizedCustomerName(customer, appLanguage),
    [appLanguage]
  );

  const exportRows = mode === 'bulk' && bulkSelected.length ? bulkSelected : filtered;

  const onSelectSingle = (customer) => {
    setSelectedId(customer.id);
    Keyboard.dismiss();
  };

  const onToggleBulk = (customer) => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[customer.id]) delete next[customer.id];
      else next[customer.id] = true;
      return next;
    });
  };

  const selectAllMatching = () => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      filtered.forEach((c) => {
        next[c.id] = true;
      });
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds({});
    setSelectedId(null);
  };

  const changeSource = (next) => {
    setSource(next);
    clearSelection();
    setSearch('');
  };

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) {
      setSelectedDate(date);
      clearSelection();
    }
  };

  const captureWithRetry = async () => {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await captureQrBase64(qrRef, 8000, {
          width: QR_CARD_BASE_WIDTH,
          height: QR_CARD_BASE_HEIGHT,
        });
      } catch (e) {
        lastErr = e;
        await wait(180);
      }
    }
    throw lastErr || new Error('QR not ready');
  };

  const downloadOne = async (customer, { allowShare }) => {
    const value = customerQrValue(customer);
    if (!value) throw new Error('Invalid customer');
    const needsPaint = qrValueRef.current !== value;
    setCaptureCustomer(customer);
    await wait(needsPaint ? 500 : 220);
    const base64 = await captureWithRetry();
    const fileCustomer = { ...customer, name: displayName(customer) };
    return savePngToGallery(qrImageFileName(fileCustomer), base64, { allowShare });
  };

  const downloadSingle = async () => {
    if (!selectedCustomer || saving) return;
    setSaving(true);
    setSaveProgress({ current: 1, total: 1 });
    try {
      const result = await downloadOne(selectedCustomer, { allowShare: true });
      const name = displayName(selectedCustomer);
      if (result.savedToGallery) {
        Alert.alert(
          t('qrgenerate.success', 'Saved'),
          t('qrgenerate.savedNamed', '{{name}} QR saved to gallery as {{file}}.', {
            name,
            file: result.fileName,
          })
        );
      }
    } catch (err) {
      console.warn('[QR] download', err);
      Alert.alert(
        t('qrgenerate.error', 'Error'),
        err?.message || t('qrgenerate.failedToSaveQr', 'Failed to save QR')
      );
    } finally {
      setSaving(false);
      setSaveProgress(null);
      setCaptureCustomer(null);
    }
  };

  const downloadBulk = async () => {
    if (!bulkSelected.length || saving) return;
    if (bulkSelected.length > 100) {
      const ok = await new Promise((resolve) => {
        Alert.alert(
          t('qrgenerate.downloadSelected', 'Download selected'),
          t(
            'qrgenerate.bulkConfirm',
            'Save {{count}} QR images to the gallery? This may take a minute.',
            { count: bulkSelected.length }
          ),
          [
            { text: t('drawer.cancel', 'Cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('qrgenerate.download', 'Download'), onPress: () => resolve(true) },
          ]
        );
      });
      if (!ok) return;
    }

    setSaving(true);
    let saved = 0;
    let failed = 0;
    try {
      for (let i = 0; i < bulkSelected.length; i += 1) {
        const customer = bulkSelected[i];
        setSaveProgress({ current: i + 1, total: bulkSelected.length });
        try {
          await downloadOne(customer, { allowShare: false });
          saved += 1;
        } catch (e) {
          console.warn('[QR] bulk item failed', customer?.id, e);
          failed += 1;
        }
      }
      Alert.alert(
        t('qrgenerate.success', 'Saved'),
        t('qrgenerate.savedBulk', '{{saved}} QR images saved to gallery{{failed}}.', {
          saved,
          failed: failed ? t('qrgenerate.failedSuffix', ', {{count}} failed', { count: failed }) : '',
        })
      );
    } finally {
      setSaving(false);
      setSaveProgress(null);
      setCaptureCustomer(null);
    }
  };

  const onDownload = () => {
    if (mode === 'bulk') downloadBulk();
    else downloadSingle();
  };

  const onExportPdf = async () => {
    if (!exportRows.length || exporting) return;
    setExporting(true);
    try {
      const stamp = source === 'today' ? dateStr : formatLocalYyyyMmDd(new Date());
      const fileName =
        source === 'today'
          ? `GasTech_QR_Orders_${stamp}.pdf`
          : `GasTech_QR_Customers_${stamp}.pdf`;
      await shareQrPdf(exportRows, fileName, {
        displayName,
        logoDataUri: logoDataUri || undefined,
      });
    } catch (err) {
      console.warn('[QR] pdf', err);
      Alert.alert(
        t('qrgenerate.error', 'Error'),
        err?.message || t('qrgenerate.pdfFailed', 'Could not export PDF.')
      );
    } finally {
      setExporting(false);
    }
  };

  const canDownload = mode === 'bulk' ? bulkSelected.length > 0 : !!selectedCustomer;
  const downloadLabel =
    mode === 'bulk'
      ? t('qrgenerate.downloadCount', 'Download {{count}} QR', { count: bulkSelected.length || 0 })
      : t('qrgenerate.downloadQR', 'Download QR');

  const listBusy = source === 'all' ? loadingAll && !catalog.length : loading;

  const renderItem = ({ item }) => {
    const name = displayName(item);
    const orderBit =
      source === 'today' && item.orderNames?.length
        ? t('qrgenerate.ordersCount', '{{count}} orders', { count: item.orderNames.length })
        : '';
    const meta = [orderBit, item.ref, item.phone, item.city].filter(Boolean).join(' · ');
    const checked = mode === 'bulk' ? !!selectedIds[item.id] : Number(selectedId) === Number(item.id);

    return (
      <TouchableOpacity
        style={[styles.row, checked && styles.rowSelected]}
        onPress={() => (mode === 'bulk' ? onToggleBulk(item) : onSelectSingle(item))}
        activeOpacity={0.75}
      >
        <View style={[styles.avatar, checked && styles.avatarSelected]}>
          <Text style={[styles.avatarText, checked && styles.avatarTextSelected]}>
            {customerInitials(name)}
          </Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={mode === 'bulk' ? (checked ? 'checkbox' : 'square-outline') : checked ? 'radio-button-on' : 'radio-button-off'}
          size={22}
          color={checked ? colors.primary : colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {qrValue && previewCustomer ? (
        <View pointerEvents="none" collapsable={false} style={styles.captureOffscreen}>
          <CustomerQrCard
            key={`capture-${qrValue}-${logoDataUri ? 'logo' : 'nologo'}`}
            value={qrValue}
            name={displayName(previewCustomer)}
            logoDataUri={logoDataUri}
            width={QR_CARD_BASE_WIDTH}
            getRef={(c) => {
              qrRef.current = c;
            }}
          />
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <View style={styles.modeRow}>
          {['single', 'bulk'].map((key) => {
            const active = mode === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.modeTab, active && styles.modeTabActive]}
                onPress={() => setMode(key)}
              >
                <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>
                  {key === 'single'
                    ? t('qrgenerate.single', 'Single')
                    : t('qrgenerate.bulk', 'Bulk')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sourceRow}>
          {[
            { key: 'today', label: t('qrgenerate.todaysOrders', "Today's orders") },
            { key: 'all', label: t('qrgenerate.allCustomers', 'All customers') },
          ].map((opt) => {
            const active = source === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sourceTab, active && styles.sourceTabActive]}
                onPress={() => changeSource(opt.key)}
              >
                <Text style={[styles.sourceTabText, active && styles.sourceTabTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {source === 'today' ? (
          <TouchableOpacity style={styles.dateChip} onPress={() => setShowPicker(true)}>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={styles.dateChipText}>
              {t('qrgenerate.committedDate', 'Committed date')}: {dateStr}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}

        {showPicker ? (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onDateChange}
          />
        ) : null}
        {showPicker && Platform.OS === 'ios' ? (
          <TouchableOpacity style={styles.dateDone} onPress={() => setShowPicker(false)}>
            <Text style={styles.link}>{t('saleorderlist.done', 'Done')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              source === 'today'
                ? t('qrgenerate.searchOrdersCustomers', 'Search today’s order customers')
                : t('qrgenerate.searchCustomers', 'Search name, phone, or code')
            }
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {listBusy
              ? t('qrgenerate.loadingCustomers', 'Loading customers… {{count}}', {
                  count: source === 'all' ? loadCount || '' : '',
                })
              : source === 'today'
                ? t('qrgenerate.showingOrders', '{{shown}} customers on Orders tab', {
                    shown: filtered.length,
                  })
                : t('qrgenerate.showingCount', '{{shown}} of {{total}} customers', {
                    shown: filtered.length,
                    total: catalog.length,
                  })}
          </Text>
          {mode === 'bulk' ? (
            <View style={styles.metaActions}>
              <TouchableOpacity onPress={selectAllMatching} hitSlop={8}>
                <Text style={styles.link}>{t('qrgenerate.selectAllMatching', 'Select all')}</Text>
              </TouchableOpacity>
              {bulkSelected.length > 0 ? (
                <TouchableOpacity onPress={clearSelection} hitSlop={8}>
                  <Text style={styles.linkMuted}>{t('qrgenerate.clearSelection', 'Clear')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={
            filtered.length ? styles.listContent : [styles.listContent, styles.listEmpty]
          }
          ListEmptyComponent={
            listBusy ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={36} color={colors.textSecondary} />
                <Text style={styles.emptyText}>
                  {search
                    ? t('qrgenerate.noMatches', 'No customers match that search.')
                    : source === 'today'
                      ? t(
                          'qrgenerate.noOrdersCustomers',
                          'No customers on the Orders tab for this committed date. Sync first if the list is empty.'
                        )
                      : t('qrgenerate.noCustomers', 'No customers found.')}
                </Text>
              </View>
            )
          }
        />

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.preview}>
            <View style={styles.qrFrame}>
              {qrValue && previewCustomer ? (
                <CustomerQrCard
                  value={qrValue}
                  name={displayName(previewCustomer)}
                  logoDataUri={logoDataUri}
                  width={112}
                />
              ) : (
                <Ionicons name="qr-code-outline" size={40} color={colors.textSecondary} />
              )}
            </View>
            <View style={styles.previewCopy}>
              <Text style={styles.previewLabel}>
                {mode === 'bulk'
                  ? t('qrgenerate.selectedCount', '{{count}} selected', { count: bulkSelected.length })
                  : t('qrgenerate.preview', 'Preview')}
              </Text>
              <Text style={styles.previewName} numberOfLines={2}>
                {previewCustomer
                  ? displayName(previewCustomer)
                  : t('qrgenerate.chooseCustomer', 'Select a customer to generate a QR code.')}
              </Text>
              {previewCustomer ? (
                <Text style={styles.previewFile} numberOfLines={1}>
                  {qrImageFileName({ ...previewCustomer, name: displayName(previewCustomer) })}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[styles.pdfBtn, (!exportRows.length || exporting || saving) && styles.downloadBtnDisabled]}
              disabled={!exportRows.length || exporting || saving}
              onPress={onExportPdf}
            >
              {exporting ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name="share-outline" size={18} color={colors.primary} />
              )}
              <Text style={styles.pdfText}>{t('qrgenerate.pdf', 'PDF')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.downloadBtn, (!canDownload || saving) && styles.downloadBtnDisabled]}
              disabled={!canDownload || saving}
              onPress={onDownload}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="download-outline" size={20} color="#fff" />
              )}
              <Text style={styles.downloadText}>
                {saving && saveProgress
                  ? t('qrgenerate.saving', 'Saving {{current}} of {{total}}…', saveProgress)
                  : downloadLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    captureOffscreen: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: QR_CARD_BASE_WIDTH,
      height: QR_CARD_BASE_HEIGHT,
      transform: [{ translateX: -3000 }],
    },
    flex: { flex: 1 },
    modeRow: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modeTab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    modeTabActive: { backgroundColor: colors.primary },
    modeTabText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    modeTabTextActive: { color: '#fff' },
    sourceRow: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginTop: 8,
      gap: 8,
    },
    sourceTab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sourceTabActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySurface,
    },
    sourceTabText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    sourceTabTextActive: { color: colors.primary },
    dateChip: {
      marginHorizontal: spacing.md,
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    dateChipText: { fontSize: 13, fontWeight: '700', color: colors.text },
    dateDone: { alignSelf: 'flex-end', marginHorizontal: spacing.md, marginTop: 4, padding: 8 },
    searchBox: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: 12,
      minHeight: 46,
    },
    searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 10 },
    metaRow: {
      marginHorizontal: spacing.md,
      marginTop: 10,
      marginBottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    metaText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
    metaActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    link: { fontSize: 13, fontWeight: '700', color: colors.primary },
    linkMuted: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    listContent: { paddingHorizontal: spacing.md, paddingBottom: 8 },
    listEmpty: { flexGrow: 1, justifyContent: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      gap: 10,
    },
    rowSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySurface,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSelected: { backgroundColor: colors.primary },
    avatarText: { fontSize: 13, fontWeight: '800', color: colors.primary },
    avatarTextSelected: { color: '#fff' },
    rowBody: { flex: 1 },
    rowName: { fontSize: 15, fontWeight: '700', color: colors.text },
    rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    empty: { alignItems: 'center', paddingVertical: 40, gap: 8, paddingHorizontal: 24 },
    emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    footer: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingTop: 12,
      gap: 12,
    },
    preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    qrFrame: {
      width: 116,
      height: 172,
      borderRadius: 16,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    previewCopy: { flex: 1 },
    previewLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    previewName: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4 },
    previewFile: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    footerActions: { flexDirection: 'row', gap: 8 },
    pdfBtn: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: borderRadius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    pdfText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
    downloadBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      minHeight: 48,
      borderRadius: borderRadius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    downloadBtnDisabled: { opacity: 0.45 },
    downloadText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}

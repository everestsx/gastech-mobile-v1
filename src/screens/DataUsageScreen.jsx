import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { borderRadius, spacing } from '../constants/theme';
import {
  clearUsageEvents,
  DATA_USAGE_RETENTION_MONTHS,
  filterEventsByRange,
  getPeriodRange,
  getUsagePrefs,
  listUsageEvents,
  pruneExpiredUsageEvents,
  saveUsagePrefs,
  summarizeUsage,
  toYmd,
} from '../services/dataUsage.service';

const PERIODS = [
  { id: 'today', label: 'Today', icon: 'sunny-outline' },
  { id: 'week', label: 'Week', icon: 'calendar-outline' },
  { id: 'month', label: 'Month', icon: 'stats-chart-outline' },
  { id: 'custom', label: 'Custom', icon: 'options-outline' },
];

function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function typeLabel(type) {
  if (type === 'master_data_sync') return 'Master Data';
  if (type === 'order_completion_sync') return 'Order Sync';
  if (type === 'precheck_sync') return 'Pre-check';
  return 'Sync';
}

function typeIcon(type) {
  if (type === 'master_data_sync') return 'cloud-download-outline';
  if (type === 'order_completion_sync') return 'checkmark-done-outline';
  if (type === 'precheck_sync') return 'shield-checkmark-outline';
  return 'sync-outline';
}

function parseLocalYmd(ymd) {
  const d = new Date(`${String(ymd || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function CustomRangeModal({
  visible,
  colors,
  dateFrom,
  dateTo,
  monthYmd,
  mode,
  onClose,
  onApply,
}) {
  const [draftMode, setDraftMode] = useState(mode === 'custom_month' ? 'month' : 'range');
  const [draftFrom, setDraftFrom] = useState(dateFrom);
  const [draftTo, setDraftTo] = useState(dateTo);
  const [draftMonth, setDraftMonth] = useState(monthYmd);
  const [pickerField, setPickerField] = useState(null);

  React.useEffect(() => {
    if (!visible) return;
    setDraftMode(mode === 'custom_month' ? 'month' : 'range');
    setDraftFrom(dateFrom);
    setDraftTo(dateTo);
    setDraftMonth(monthYmd);
    setPickerField(null);
  }, [visible, mode, dateFrom, dateTo, monthYmd]);

  const pickerValue = useMemo(() => {
    if (pickerField === 'from') return parseLocalYmd(draftFrom);
    if (pickerField === 'to') return parseLocalYmd(draftTo);
    return parseLocalYmd(draftMonth);
  }, [pickerField, draftFrom, draftTo, draftMonth]);

  const apply = () => {
    if (draftMode === 'month') {
      onApply?.({
        period: 'custom_month',
        monthYmd: draftMonth || toYmd(new Date()),
        dateFrom: draftFrom,
        dateTo: draftTo,
      });
      onClose?.();
      return;
    }
    let from = draftFrom;
    let to = draftTo;
    if (!from || !to) {
      Alert.alert('Date range', 'Please choose both From and To dates.');
      return;
    }
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    onApply?.({
      period: 'custom',
      dateFrom: from,
      dateTo: to,
      monthYmd: draftMonth,
    });
    onClose?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]}>Customize period</Text>
          <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
            Pick a date range or a full calendar month.
          </Text>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[
                styles.modeChip,
                {
                  backgroundColor: draftMode === 'range' ? colors.primary : colors.primarySurface,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setDraftMode('range')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.modeChipText,
                  { color: draftMode === 'range' ? '#fff' : colors.primary },
                ]}
              >
                Date range
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeChip,
                {
                  backgroundColor: draftMode === 'month' ? colors.primary : colors.primarySurface,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => setDraftMode('month')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.modeChipText,
                  { color: draftMode === 'month' ? '#fff' : colors.primary },
                ]}
              >
                Month
              </Text>
            </TouchableOpacity>
          </View>

          {draftMode === 'range' ? (
            <>
              <TouchableOpacity
                style={[styles.rangeRow, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setPickerField('from')}
                activeOpacity={0.85}
              >
                <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>From</Text>
                <Text style={[styles.rangeValue, { color: colors.text }]}>{draftFrom || '—'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rangeRow, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setPickerField('to')}
                activeOpacity={0.85}
              >
                <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>To</Text>
                <Text style={[styles.rangeValue, { color: colors.text }]}>{draftTo || '—'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.rangeRow, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => setPickerField('month')}
              activeOpacity={0.85}
            >
              <Text style={[styles.rangeLabel, { color: colors.textSecondary }]}>Month</Text>
              <Text style={[styles.rangeValue, { color: colors.text }]}>
                {parseLocalYmd(draftMonth).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </TouchableOpacity>
          )}

          {pickerField ? (
            <DateTimePicker
              value={pickerValue}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(e, date) => {
                if (e?.type === 'dismissed') {
                  if (Platform.OS === 'android') setPickerField(null);
                  return;
                }
                if (!date) {
                  if (Platform.OS === 'android') setPickerField(null);
                  return;
                }
                const ymd = toYmd(date);
                if (pickerField === 'from') setDraftFrom(ymd);
                else if (pickerField === 'to') setDraftTo(ymd);
                else setDraftMonth(ymd);
                if (Platform.OS === 'android') setPickerField(null);
              }}
            />
          ) : null}

          {pickerField && Platform.OS === 'ios' ? (
            <TouchableOpacity onPress={() => setPickerField(null)} style={styles.iosDone}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalBtn, { borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalApply, { backgroundColor: colors.primary }]}
              onPress={apply}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Apply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function DataUsageScreen() {
  const { colors } = useTheme();
  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('today');
  const [dateFrom, setDateFrom] = useState(toYmd(new Date()));
  const [dateTo, setDateTo] = useState(toYmd(new Date()));
  const [monthYmd, setMonthYmd] = useState(toYmd(new Date()));
  const [customOpen, setCustomOpen] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);

  const load = useCallback(async () => {
    await pruneExpiredUsageEvents();
    const rows = await listUsageEvents();
    setEvents(Array.isArray(rows) ? rows : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const prefs = await getUsagePrefs();
        if (!alive) return;
        setPeriod(prefs.period === 'custom_month' ? 'custom_month' : prefs.period || 'today');
        setDateFrom(prefs.dateFrom);
        setDateTo(prefs.dateTo);
        setMonthYmd(prefs.monthYmd);
        setPrefsReady(true);
        await load();
      })();
      return () => {
        alive = false;
      };
    }, [load])
  );

  const persistPeriod = useCallback(async (next) => {
    setPeriod(next.period);
    if (next.dateFrom) setDateFrom(next.dateFrom);
    if (next.dateTo) setDateTo(next.dateTo);
    if (next.monthYmd) setMonthYmd(next.monthYmd);
    await saveUsagePrefs(next);
  }, []);

  const onSelectPeriod = useCallback(
    async (id) => {
      if (id === 'custom') {
        setCustomOpen(true);
        return;
      }
      await persistPeriod({
        period: id,
        dateFrom,
        dateTo,
        monthYmd,
      });
    },
    [persistPeriod, dateFrom, dateTo, monthYmd]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const range = useMemo(() => {
    if (period === 'custom') {
      return getPeriodRange('custom', { dateFrom, dateTo });
    }
    if (period === 'custom_month') {
      return getPeriodRange('custom_month', { monthYmd });
    }
    return getPeriodRange(period);
  }, [period, dateFrom, dateTo, monthYmd]);

  const filtered = useMemo(
    () => filterEventsByRange(events, range.from, range.to),
    [events, range.from, range.to]
  );

  const summary = useMemo(() => summarizeUsage(filtered), [filtered]);

  const quickCards = useMemo(() => {
    const today = getPeriodRange('today');
    const week = getPeriodRange('week');
    const month = getPeriodRange('month');
    return [
      { id: 'today', title: 'Today', ...summarizeUsage(filterEventsByRange(events, today.from, today.to)) },
      { id: 'week', title: '7 days', ...summarizeUsage(filterEventsByRange(events, week.from, week.to)) },
      { id: 'month', title: 'Month', ...summarizeUsage(filterEventsByRange(events, month.from, month.to)) },
    ];
  }, [events]);

  const byTypeRows = useMemo(() => {
    return Object.entries(summary.byType || {})
      .map(([type, stats]) => ({ type, ...stats }))
      .sort((a, b) => b.total - a.total);
  }, [summary]);

  const maxTypeTotal = Math.max(1, ...byTypeRows.map((r) => r.total));

  const confirmClear = () => {
    Alert.alert('Clear history', 'Delete all saved data usage history on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearUsageEvents();
          await load();
        },
      },
    ]);
  };

  const selectedChipId =
    period === 'custom' || period === 'custom_month' ? 'custom' : period;

  const renderItem = ({ item }) => {
    const started = item?.startedAt ? new Date(item.startedAt) : null;
    const soId = item?.meta?.saleOrderId;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBubble, { backgroundColor: colors.primarySurface }]}>
              <Ionicons name={typeIcon(item?.type)} size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{typeLabel(item?.type)}</Text>
              <Text style={[styles.timeText, { color: colors.textSecondary }]}>
                {started ? started.toLocaleString() : '—'}
              </Text>
            </View>
          </View>
          <Text style={[styles.totalText, { color: colors.primary }]}>{formatBytes(item?.totalBytes)}</Text>
        </View>
        {Number.isFinite(Number(soId)) && Number(soId) > 0 ? (
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>Sale Order #{soId}</Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.metaPill}>
            <Ionicons name="arrow-up-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {formatBytes(item?.upBytes)}
            </Text>
          </View>
          <View style={styles.metaPill}>
            <Ionicons name="arrow-down-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {formatBytes(item?.downBytes)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (!prefsReady) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item?.id || Math.random())}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListHeaderComponent={
          <View>
            <View style={[styles.hero, { backgroundColor: colors.primary }]}>
              <Text style={styles.heroEyebrow}>Network usage</Text>
              <Text style={styles.heroValue}>{formatBytes(summary.total)}</Text>
              <Text style={styles.heroSub}>{range.label}</Text>
              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Upload</Text>
                  <Text style={styles.heroStatValue}>{formatBytes(summary.up)}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Download</Text>
                  <Text style={styles.heroStatValue}>{formatBytes(summary.down)}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Sessions</Text>
                  <Text style={styles.heroStatValue}>{summary.count}</Text>
                </View>
              </View>
            </View>

            <View style={styles.quickRow}>
              {quickCards.map((card) => {
                const active = selectedChipId === card.id;
                return (
                  <TouchableOpacity
                    key={card.id}
                    style={[
                      styles.quickCard,
                      {
                        backgroundColor: active ? colors.primarySurface : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => onSelectPeriod(card.id)}
                    activeOpacity={0.88}
                  >
                    <Text style={[styles.quickTitle, { color: colors.textSecondary }]}>{card.title}</Text>
                    <Text style={[styles.quickValue, { color: colors.text }]}>
                      {formatBytes(card.total)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.periodRow}>
              {PERIODS.map((p) => {
                const active = selectedChipId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.periodChip,
                      {
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => onSelectPeriod(p.id)}
                    activeOpacity={0.88}
                  >
                    <Ionicons name={p.icon} size={14} color={active ? '#fff' : colors.primary} />
                    <Text style={[styles.periodText, { color: active ? '#fff' : colors.text }]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {(period === 'custom' || period === 'custom_month') && (
              <TouchableOpacity
                style={[styles.customBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setCustomOpen(true)}
                activeOpacity={0.88}
              >
                <Ionicons name="calendar" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.customBannerTitle, { color: colors.text }]}>Custom filter</Text>
                  <Text style={[styles.customBannerSub, { color: colors.textSecondary }]}>
                    {range.label}
                  </Text>
                </View>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Edit</Text>
              </TouchableOpacity>
            )}

            {byTypeRows.length > 0 ? (
              <View style={[styles.breakdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>By sync type</Text>
                {byTypeRows.map((row) => (
                  <View key={row.type} style={styles.breakRow}>
                    <View style={styles.breakTop}>
                      <Text style={[styles.breakLabel, { color: colors.text }]}>{typeLabel(row.type)}</Text>
                      <Text style={[styles.breakValue, { color: colors.textSecondary }]}>
                        {formatBytes(row.total)} · {row.count}
                      </Text>
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: colors.primarySurface }]}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            backgroundColor: colors.primary,
                            width: `${Math.max(6, Math.round((row.total / maxTypeTotal) * 100))}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Activity</Text>
              <Text style={[styles.retentionNote, { color: colors.textSecondary }]}>
                Auto-clears after {DATA_USAGE_RETENTION_MONTHS} months
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No usage in this period. Run pre-check, master sync, or complete an order sync.
          </Text>
        }
        ListFooterComponent={
          <TouchableOpacity
            style={[styles.clearBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={confirmClear}
            activeOpacity={0.85}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
            <Text style={[styles.clearText, { color: colors.error }]}>Clear all history</Text>
          </TouchableOpacity>
        }
      />

      <CustomRangeModal
        visible={customOpen}
        colors={colors}
        dateFrom={dateFrom}
        dateTo={dateTo}
        monthYmd={monthYmd}
        mode={period}
        onClose={() => setCustomOpen(false)}
        onApply={async (next) => {
          await persistPeriod(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroEyebrow: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 6 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '600' },
  heroStatValue: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 },
  heroDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.25)' },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  quickCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  quickTitle: { fontSize: 11, fontWeight: '600' },
  quickValue: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  periodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  periodText: { fontSize: 12, fontWeight: '700' },
  customBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  customBannerTitle: { fontSize: 13, fontWeight: '700' },
  customBannerSub: { fontSize: 12, marginTop: 2 },
  breakdown: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  retentionNote: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  breakRow: { marginTop: 10 },
  breakTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  breakLabel: { fontSize: 13, fontWeight: '600' },
  breakValue: { fontSize: 12 },
  barTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 999 },
  card: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  totalText: { fontSize: 15, fontWeight: '800' },
  timeText: { fontSize: 11, marginTop: 2 },
  metaText: { fontSize: 12 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  empty: { textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.md },
  clearBtn: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { fontSize: 13, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalHint: { fontSize: 13, marginTop: 6, marginBottom: spacing.md },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  modeChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeChipText: { fontSize: 13, fontWeight: '700' },
  rangeRow: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rangeLabel: { fontSize: 12, fontWeight: '600' },
  rangeValue: { fontSize: 14, fontWeight: '700' },
  iosDone: { alignSelf: 'flex-end', paddingVertical: 8 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  modalBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalApply: { borderWidth: 0 },
});

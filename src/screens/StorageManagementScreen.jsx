import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { borderRadius, spacing } from '../constants/theme';
import {
  ASYNC_STORAGE_LIMIT_BYTES,
  getCleanupHistory,
  measureAsyncStorageUsage,
} from '../services/storageMonitor.service';
import { getStorageMaintenanceState } from '../database/sqliteMaintenance';

function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const TRIGGERS = {
  weekly: { label: 'Weekly cleanup', icon: 'calendar-outline' },
  automatic: { label: 'Automatic cleanup', icon: 'refresh-outline' },
  emergency: { label: 'Low-space recovery', icon: 'warning-outline' },
};

function statusMeta(status, colors) {
  if (status === 'success') return { label: 'Completed', color: colors.success };
  if (status === 'nothing_to_clean') return { label: 'Nothing to clean', color: colors.textSecondary };
  if (status === 'partial') return { label: 'Completed with errors', color: colors.warning };
  return { label: 'Failed', color: colors.error };
}

function levelMeta(pct, colors) {
  if (pct >= 90) return { label: 'Critical', color: colors.error };
  if (pct >= 70) return { label: 'High', color: colors.warning };
  return { label: 'Normal', color: colors.success };
}

function cleanedLines(items) {
  const i = items || {};
  const lines = [];
  if (i.signatures > 0) lines.push(`Old checkout signatures: ${i.signatures}`);
  if (i.customerCache > 0) lines.push(`Old customer invoice cache: ${i.customerCache}`);
  if (i.porterPhotos > 0) lines.push(`Porter photos removed from cache: ${i.porterPhotos}`);
  if (i.porterCacheRemoved) lines.push('Unreadable porter cache removed');
  if (i.usageEvents > 0) lines.push(`Old data-usage records: ${i.usageEvents}`);
  if (i.deliveryHistoryRows > 0) lines.push(`Expired delivery history rows: ${i.deliveryHistoryRows}`);
  return lines;
}

export default function StorageManagementScreen() {
  const { colors } = useTheme();
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState(null);
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [u, s, h] = await Promise.all([
      measureAsyncStorageUsage().then(
        (v) => ({ v }),
        (e) => ({ e })
      ),
      getStorageMaintenanceState().catch(() => null),
      getCleanupHistory(),
    ]);
    if (u.e) {
      setUsage(null);
      setUsageError(String(u.e?.message || u.e));
    } else {
      setUsage(u.v);
      setUsageError(null);
    }
    setState(s);
    setHistory(Array.isArray(h) ? h : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      load().finally(() => {
        if (alive) setLoading(false);
      });
      return () => {
        alive = false;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const limit = usage?.limitBytes || ASYNC_STORAGE_LIMIT_BYTES;
  const used = usage?.dataBytes ?? 0;
  const free = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 1000) / 10);
  const level = levelMeta(pct, colors);

  // "Last cleanup" = most recent weekly run (AsyncStorage stamp, or history if the stamp
  // could not be written because storage was full).
  const lastWeeklyFromHistory = history.find((h) => h?.trigger === 'weekly')?.finishedAt || null;
  const lastWeeklyAt = [state?.lastWeeklyAt, lastWeeklyFromHistory]
    .filter(Boolean)
    .sort()
    .pop() || null;
  const intervalMs = state?.intervalMs || 7 * 24 * 60 * 60 * 1000;
  const nextDueMs = lastWeeklyAt ? Date.parse(lastWeeklyAt) + intervalMs : null;
  const dueNow = nextDueMs == null || nextDueMs <= Date.now();
  const latest = history[0] || null;

  const renderItem = ({ item }) => {
    const trig = TRIGGERS[item?.trigger] || TRIGGERS.automatic;
    const st = statusMeta(item?.status, colors);
    const lines = cleanedLines(item?.items);
    const errors = Array.isArray(item?.errors) ? item.errors : [];
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBubble, { backgroundColor: colors.primarySurface }]}>
              <Ionicons name={trig.icon} size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{trig.label}</Text>
              <Text style={[styles.timeText, { color: colors.textSecondary }]}>{formatDateTime(item?.at)}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.totalText, { color: colors.primary }]}>
              {item?.freedBytes != null ? formatBytes(item.freedBytes) : '—'}
            </Text>
            <Text style={[styles.timeText, { color: colors.textSecondary }]}>freed</Text>
          </View>
        </View>
        <View style={[styles.statusPill, { borderColor: st.color }]}>
          <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
        </View>
        {lines.map((l) => (
          <Text key={l} style={[styles.metaText, { color: colors.text }]}>
            • {l}
          </Text>
        ))}
        {item?.before && item?.after ? (
          <Text style={[styles.metaText, { color: colors.textSecondary, marginTop: 4 }]}>
            {formatBytes(item.before.dataBytes)} → {formatBytes(item.after.dataBytes)}
          </Text>
        ) : null}
        {errors.map((e, idx) => (
          <Text key={`${idx}_${e}`} style={[styles.metaText, { color: colors.error, marginTop: 4 }]}>
            {e}
          </Text>
        ))}
      </View>
    );
  };

  if (loading && !usage && !usageError) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={history}
        keyExtractor={(item, idx) => String(item?.id || idx)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View>
            <View style={[styles.hero, { backgroundColor: colors.primary }]}>
              <Text style={styles.heroEyebrow}>App storage (AsyncStorage)</Text>
              <Text style={styles.heroValue}>{usage ? formatBytes(used) : '—'}</Text>
              <Text style={styles.heroSub}>of {formatBytes(limit)} limit</Text>
              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Free</Text>
                  <Text style={styles.heroStatValue}>{usage ? formatBytes(free) : '—'}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Items</Text>
                  <Text style={styles.heroStatValue}>{usage ? usage.keyCount : '—'}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>File on disk</Text>
                  <Text style={styles.heroStatValue}>
                    {usage?.fileBytes != null ? formatBytes(usage.fileBytes) : '—'}
                  </Text>
                </View>
              </View>
            </View>

            {usageError ? (
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.error }]}>
                <Text style={[styles.metaText, { color: colors.error }]}>Could not measure storage: {usageError}</Text>
              </View>
            ) : null}

            {usage ? (
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Usage level</Text>
                  <Text style={[styles.levelText, { color: level.color }]}>
                    {level.label} · {pct}%
                  </Text>
                </View>
                <View style={[styles.barTrack, { backgroundColor: colors.primarySurface }]}>
                  <View style={[styles.barFill, { backgroundColor: level.color, width: `${Math.max(2, pct)}%` }]} />
                </View>
                {usage.unreadableKeys?.length > 0 ? (
                  <Text style={[styles.metaText, { color: colors.warning, marginTop: 8 }]}>
                    {usage.unreadableKeys.length} item(s) are larger than 2 MB and cannot be read, so the real usage
                    is higher than shown. The next cleanup removes unreadable caches.
                  </Text>
                ) : null}
                {Platform.OS !== 'android' ? (
                  <Text style={[styles.metaText, { color: colors.textSecondary, marginTop: 8 }]}>
                    The 6 MB limit applies to Android only.
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 6 }]}>Cleanup schedule</Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Status</Text>
                <Text style={[styles.infoValue, { color: state?.running ? colors.primary : colors.text }]}>
                  {state?.running ? 'Weekly cleanup running…' : 'Idle'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Last weekly cleanup</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {lastWeeklyAt ? formatDateTime(lastWeeklyAt) : 'Not run yet'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Next weekly cleanup</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {dueNow ? 'Due — runs on next app open or sync' : formatDateTime(new Date(nextDueMs).toISOString())}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Last result</Text>
                <Text
                  style={[
                    styles.infoValue,
                    { color: latest ? statusMeta(latest.status, colors).color : colors.textSecondary },
                  ]}
                >
                  {latest ? statusMeta(latest.status, colors).label : '—'}
                </Text>
              </View>
              <Text style={[styles.metaText, { color: colors.textSecondary, marginTop: 6 }]}>
                Light cleanup also runs automatically when the app opens and after sync. Pending sync data, active
                checkouts and the current session are never removed.
              </Text>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Cleanup history</Text>
              <Text style={[styles.note, { color: colors.textSecondary }]}>Last 50 runs</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No cleanup has been recorded yet. Runs that remove data appear here.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: { borderRadius: borderRadius.xl, padding: spacing.lg, marginBottom: spacing.md },
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
  section: { borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  note: { fontSize: 11 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  levelText: { fontSize: 13, fontWeight: '700' },
  barTrack: { height: 10, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 999 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  card: { borderRadius: borderRadius.md, borderWidth: 1, padding: spacing.md, marginBottom: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBubble: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  totalText: { fontSize: 15, fontWeight: '800' },
  timeText: { fontSize: 11, marginTop: 2 },
  statusPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 8,
    marginBottom: 6,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  metaText: { fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.md },
});

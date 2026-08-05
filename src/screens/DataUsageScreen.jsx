import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { borderRadius, spacing } from '../constants/theme';
import { clearUsageEvents, listUsageEvents } from '../services/dataUsage.service';

function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function typeLabel(type) {
  if (type === 'master_data_sync') return 'Master Data Sync';
  if (type === 'order_completion_sync') return 'Order Completion Sync';
  if (type === 'precheck_sync') return 'Pre-check Sync';
  return 'Sync';
}

export default function DataUsageScreen() {
  const { colors } = useTheme();
  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await listUsageEvents();
    setEvents(Array.isArray(rows) ? rows : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
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

  const totals = useMemo(() => {
    return (events || []).reduce(
      (acc, item) => {
        acc.up += Number(item?.upBytes) || 0;
        acc.down += Number(item?.downBytes) || 0;
        acc.total += Number(item?.totalBytes) || 0;
        return acc;
      },
      { up: 0, down: 0, total: 0 }
    );
  }, [events]);

  const renderItem = ({ item }) => {
    const started = item?.startedAt ? new Date(item.startedAt) : null;
    const ended = item?.endedAt ? new Date(item.endedAt) : null;
    const soId = item?.meta?.saleOrderId;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>{typeLabel(item?.type)}</Text>
          </View>
          <Text style={[styles.totalText, { color: colors.text }]}>{formatBytes(item?.totalBytes)}</Text>
        </View>
        <Text style={[styles.timeText, { color: colors.textSecondary }]}>
          {started ? started.toLocaleString() : '-'}
          {ended ? `  ->  ${ended.toLocaleTimeString()}` : ''}
        </Text>
        {Number.isFinite(Number(soId)) && Number(soId) > 0 ? (
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>Sale Order: #{soId}</Text>
        ) : null}
        <View style={styles.row}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            Upload: {formatBytes(item?.upBytes)}
          </Text>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            Download: {formatBytes(item?.downBytes)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Total Data</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>{formatBytes(totals.total)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>Uploaded</Text>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>{formatBytes(totals.up)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>Downloaded</Text>
          <Text style={[styles.summarySub, { color: colors.textSecondary }]}>{formatBytes(totals.down)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.clearBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
        onPress={async () => {
          await clearUsageEvents();
          await load();
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.clearText, { color: colors.textSecondary }]}>Clear History</Text>
      </TouchableOpacity>

      <FlatList
        data={events}
        keyExtractor={(item) => String(item?.id || Math.random())}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No data usage entries yet. Run pre-check, master sync, or complete an order sync.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summary: {
    margin: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, fontWeight: '600' },
  summaryValue: { fontSize: 20, fontWeight: '800' },
  summarySub: { fontSize: 12, marginTop: 4 },
  clearBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { fontSize: 13, fontWeight: '600' },
  list: { padding: spacing.md, paddingTop: 0, paddingBottom: spacing.xl },
  card: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  totalText: { fontSize: 15, fontWeight: '700' },
  timeText: { fontSize: 12, marginTop: 8 },
  metaText: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: spacing.xl, fontSize: 13 },
});

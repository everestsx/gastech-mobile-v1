import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSyncLogRecent, getLastSyncTime } from '../services/sync.service';

export default function SyncHistoryScreen() {
  const { colors } = useTheme();
  const [log, setLog] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [recent, last] = await Promise.all([
      getSyncLogRecent(20),
      getLastSyncTime(),
    ]);
    setLog(recent || []);
    setLastSync(last);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderItem = ({ item }) => {
    const isSuccess = (item.status || '').toLowerCase() === 'success';
    return (
      <View
        style={[
          styles.item,
          {
            backgroundColor: colors.surface,
            borderLeftColor: isSuccess ? colors.success : colors.error,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: isSuccess ? colors.success : colors.error }]} />
        <View style={styles.itemBody}>
          <Text style={[styles.itemTime, { color: colors.textSecondary }]}>
            {item.sync_at ? new Date(item.sync_at).toLocaleString() : '—'}
          </Text>
          <Text style={[styles.itemStatus, { color: colors.text }]}>
            {item.status || '—'}
          </Text>
          {item.message ? (
            <Text style={[styles.itemMessage, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.message}
            </Text>
          ) : null}
          {item.counts && typeof item.counts === 'object' ? (
            <Text style={[styles.itemCounts, { color: colors.textSecondary }]}>
              {JSON.stringify(item.counts)}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {lastSync && (
        <View style={[styles.lastSyncBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.lastSyncLabel, { color: colors.textSecondary }]}>
            Last successful sync:
          </Text>
          <Text style={[styles.lastSyncTime, { color: colors.text }]}>
            {new Date(lastSync).toLocaleString()}
          </Text>
        </View>
      )}
      <FlatList
        data={log}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textSecondary }]}>No sync history yet</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  lastSyncBar: {
    padding: spacing.md,
    borderBottomWidth: 1,
  },
  lastSyncLabel: { fontSize: 12 },
  lastSyncTime: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  list: { padding: spacing.md, paddingBottom: 40 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderBottomWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10, marginTop: 6 },
  itemBody: { flex: 1 },
  itemTime: { fontSize: 11 },
  itemStatus: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  itemMessage: { fontSize: 12, marginTop: 4 },
  itemCounts: { fontSize: 11, marginTop: 2 },
  empty: { textAlign: 'center', padding: spacing.xl },
});

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSync } from '../context/SyncContext';

/**
 * Compact sync status for headers (better UX than long "Device Syncing..." copy).
 * Subscribes to SyncContext so it updates while background sync runs.
 *
 * @param {'header' | 'surface' | 'dashboard'} variant
 *   - header: native stack header (typically colored background, light text)
 *   - surface: light app bar / card header (dark text)
 *   - dashboard: home top bar (light text on gradient/orange)
 */
export default function SyncHeaderBadge({ variant = 'surface' }) {
  const { t } = useTranslation();
  const { isSyncing, hideSyncIndicator } = useSync();
  if (!isSyncing || hideSyncIndicator) return null;

  const isLightOnDark = variant === 'header' || variant === 'dashboard';
  const pillBg = isLightOnDark ? 'rgba(255,255,255,0.22)' : 'rgba(99, 102, 241, 0.12)';
  const borderCol = isLightOnDark ? 'rgba(255,255,255,0.35)' : 'rgba(99, 102, 241, 0.35)';
  const textCol = isLightOnDark ? '#fff' : '#4338ca';
  const spinCol = isLightOnDark ? '#fff' : '#4f46e5';

  return (
    <View style={[styles.pill, { backgroundColor: pillBg, borderColor: borderCol }]}>
      <ActivityIndicator size="small" color={spinCol} style={styles.spinner} />
      <Text style={[styles.label, { color: textCol }]} numberOfLines={1}>
        {t('common.syncing', 'Syncing')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 4,
    maxWidth: 200,
  },
  spinner: { marginRight: 8, transform: [{ scale: 0.85 }] },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
});

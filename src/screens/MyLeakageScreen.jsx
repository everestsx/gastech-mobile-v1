import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getAllGasLeakageCollects } from '../database/gasLeakageCollects.js';
import { labelFromKg } from '../utils/cylinderCatalog';

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

function moveLabel(move) {
  const qty = Number(move?.qty) || 0;
  const name = String(move?.displayName || '').trim();
  if (name) return `${name} × ${qty}`;
  const kg = Number(move?.kg);
  const kind = move?.kind === 'empty' ? 'empty' : 'gas';
  const size = Number.isFinite(kg) ? labelFromKg(kg) : '';
  return [size, kind, `× ${qty}`].filter(Boolean).join(' ');
}

export default function MyLeakageScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await getAllGasLeakageCollects();
    setRows(Array.isArray(data) ? data : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          if (active) await load();
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        list: { padding: spacing.md, paddingBottom: 40 },
        card: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.sm,
        },
        headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
        date: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
        badge: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
          borderWidth: 1,
        },
        badgeText: { fontSize: 11, fontWeight: '800' },
        customer: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
        reason: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 8 },
        movesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
        chip: {
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        chipText: { fontSize: 12, fontWeight: '700', color: colors.text },
        source: { fontSize: 11, color: colors.textSecondary, marginTop: 8, fontWeight: '600' },
        empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
        emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 10 },
        emptySub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
      }),
    [colors]
  );

  const renderItem = ({ item }) => {
    const synced = String(item.odooSyncStatus || '') === 'synced';
    const statusColor = synced ? colors.success || '#22c55e' : colors.warning || '#d97706';
    const moves = (item.moves || []).filter((m) => Number(m.qty) > 0);
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.date, { marginLeft: 6 }]}>{formatDateTime(item.collectedAt)}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor + '18', borderColor: statusColor + '30' }]}>
            <Ionicons name={synced ? 'checkmark-circle-outline' : 'cloud-upload-outline'} size={12} color={statusColor} />
            <Text style={[styles.badgeText, { color: statusColor }]}>
              {synced
                ? t('myleakage.updated', 'Updated')
                : t('myleakage.pending', 'Pending')}
            </Text>
          </View>
        </View>
        <Text style={styles.customer} numberOfLines={1}>
          {item.partnerName || t('myleakage.unknownCustomer', 'Customer')}
        </Text>
        <Text style={styles.reason} numberOfLines={2}>
          {t('myleakage.reason', 'Reason')}: {item.reason || '—'}
        </Text>
        <View style={styles.movesWrap}>
          {moves.length === 0 ? (
            <Text style={styles.source}>{t('myleakage.noProducts', 'No products')}</Text>
          ) : (
            moves.map((move, idx) => (
              <View style={styles.chip} key={`${item.id}-${idx}`}>
                <Text style={styles.chipText}>{moveLabel(move)}</Text>
              </View>
            ))
          )}
        </View>
        <Text style={styles.source}>
          {item.source === 'checkout'
            ? t('myleakage.fromOrder', 'Collected during sale order')
            : t('myleakage.fromMenu', 'Collected from menu')}
        </Text>
      </View>
    );
  };

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, rows.length === 0 && styles.empty]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="water-outline" size={42} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>{t('myleakage.emptyTitle', 'No leakage collected yet')}</Text>
            <Text style={styles.emptySub}>
              {t(
                'myleakage.emptyBody',
                'Leakage collected during delivery or from Gas Leakage Collect will appear here.'
              )}
            </Text>
          </View>
        }
      />
    </View>
  );
}

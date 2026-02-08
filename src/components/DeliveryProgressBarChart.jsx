import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../constants/theme';

const BAR_HEIGHT = 24;
const BAR_GAP = 8;
const LABEL_WIDTH = 36;
const CHART_LEFT = LABEL_WIDTH + spacing.sm;

/**
 * Horizontal bar chart: Delivery Progress by Shop.
 * data = [{ shopId, shopName?, delivered, pending }]
 * Green = delivered, Red = pending.
 */
export default function DeliveryProgressBarChart({ data = [], title = 'Delivery Progress by Shop' }) {
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.max(screenWidth - spacing.md * 2 - CHART_LEFT, 200);
  const maxVal = useMemo(() => {
    const max = Math.max(
      ...data.map((d) => (Number(d.delivered) || 0) + (Number(d.pending) || 0)),
      1
    );
    return max;
  }, [data]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.md,
          overflow: 'hidden',
        },
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: spacing.md,
          gap: 8,
        },
        title: { fontSize: 16, fontWeight: '700', color: colors.text },
        scrollHint: {
          fontSize: 12,
          color: colors.textSecondary,
          marginTop: spacing.sm,
          textAlign: 'center',
        },
        legendRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.lg,
          marginTop: spacing.md,
        },
        legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        legendBox: { width: 14, height: 14, borderRadius: 3 },
        legendText: { fontSize: 13, fontWeight: '600' },
      }),
    [colors]
  );

  if (!data.length) {
    return (
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="bar-chart-outline" size={20} color={colors.primary} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={[styles.scrollHint, { marginBottom: spacing.sm }]}>No shop data for today</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="bar-chart-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: spacing.md }}
      >
        <View style={{ width: chartWidth + CHART_LEFT, minWidth: screenWidth - spacing.md * 2 }}>
          {data.map((row, i) => {
            const delivered = Math.max(0, Number(row.delivered) || 0);
            const pending = Math.max(0, Number(row.pending) || 0);
            const total = delivered + pending || 1;
            const deliveredW = (delivered / maxVal) * chartWidth;
            const pendingW = (pending / maxVal) * chartWidth;
            const label = row.shopName || row.shopId || `S${i + 1}`;
            const shortLabel = String(label).replace(/^.*\s/, '').slice(0, 6) || `S${i + 1}`;
            return (
              <View
                key={row.shopId || i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: BAR_GAP,
                  height: BAR_HEIGHT,
                }}
              >
                <Text
                  style={{
                    width: LABEL_WIDTH,
                    fontSize: 11,
                    fontWeight: '600',
                    color: colors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {shortLabel}
                </Text>
                <View style={{ flex: 1, flexDirection: 'row', height: BAR_HEIGHT - 2, borderRadius: 4, overflow: 'hidden' }}>
                  {delivered > 0 && (
                    <View
                      style={{
                        width: Math.max(2, deliveredW),
                        backgroundColor: colors.success ?? '#059669',
                        borderTopLeftRadius: 4,
                        borderBottomLeftRadius: 4,
                      }}
                    />
                  )}
                  {pending > 0 && (
                    <View
                      style={{
                        width: Math.max(2, pendingW),
                        backgroundColor: colors.error ?? '#dc2626',
                        borderTopRightRadius: 4,
                        borderBottomRightRadius: 4,
                      }}
                    />
                  )}
                </View>
                <Text
                  style={{
                    width: 28,
                    fontSize: 10,
                    fontWeight: '700',
                    color: colors.text,
                    textAlign: 'right',
                    marginLeft: 4,
                  }}
                >
                  {delivered + pending}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Text style={styles.scrollHint}>← Swipe to see all shops →</Text>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: colors.success ?? '#059669' }]} />
          <Text style={[styles.legendText, { color: colors.success ?? '#059669' }]}>
            Delivered ({data.reduce((s, d) => s + (Number(d.delivered) || 0), 0)})
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: colors.error ?? '#dc2626' }]} />
          <Text style={[styles.legendText, { color: colors.error ?? '#dc2626' }]}>
            Pending ({data.reduce((s, d) => s + (Number(d.pending) || 0), 0)})
          </Text>
        </View>
      </View>
    </View>
  );
}

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../constants/theme';

const CHART_HEIGHT = 200;
const BAR_GAP = 6;
const MIN_BAR_WIDTH = 24;
const LABEL_HEIGHT = 36;

/**
 * Vertical bar chart: Delivery Progress by Shop.
 * data = [{ shopId, shopName?, delivered, pending }]
 * Each shop = one bar: fully green (delivered) or fully red (pending), no mix.
 */
export default function DeliveryProgressBarChart({ data = [], title = 'Delivery Progress by Shop' }) {
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.max(screenWidth - spacing.md * 2, 240);
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    (chartWidth - (data.length + 1) * BAR_GAP) / Math.max(data.length, 1)
  );
  const totalBarWidth = data.length * (barWidth + BAR_GAP) + BAR_GAP;

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

  const successColor = colors.success ?? '#059669';
  const errorColor = colors.error ?? '#dc2626';

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
        <View style={{ minWidth: Math.max(chartWidth, totalBarWidth) }}>
          <View style={{ flexDirection: 'row', height: CHART_HEIGHT - LABEL_HEIGHT }}>
            {data.map((row, i) => {
              const delivered = Math.max(0, Number(row.delivered) || 0);
              const pending = Math.max(0, Number(row.pending) || 0);
              const total = delivered + pending || 0;
              const isFullyDelivered = pending === 0 && total > 0;
              const barColor = isFullyDelivered ? successColor : errorColor;
              const barHeight = total > 0 ? Math.max(8, (total / maxVal) * (CHART_HEIGHT - LABEL_HEIGHT - 12)) : 0;
              return (
                <View
                  key={row.shopId || i}
                  style={{
                    width: barWidth + BAR_GAP,
                    height: CHART_HEIGHT - LABEL_HEIGHT,
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    marginLeft: i === 0 ? BAR_GAP : 0,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: colors.text,
                      marginBottom: 4,
                    }}
                  >
                    {total}
                  </Text>
                  <View
                    style={{
                      width: barWidth,
                      height: barHeight,
                      backgroundColor: barColor,
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                    }}
                  />
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', height: LABEL_HEIGHT, paddingLeft: BAR_GAP }}>
            {data.map((row, i) => {
              const label = row.shopName || row.shopId || `S${i + 1}`;
              const shortLabel = String(label).length > 10 ? String(label).slice(0, 8) + '…' : String(label);
              return (
                <View
                  key={`label-${row.shopId || i}`}
                  style={{
                    width: barWidth + BAR_GAP,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '600',
                      color: colors.textSecondary,
                      textAlign: 'center',
                    }}
                    numberOfLines={2}
                  >
                    {shortLabel}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <Text style={styles.scrollHint}>← Swipe to see all shops →</Text>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: successColor }]} />
          <Text style={[styles.legendText, { color: successColor }]}>
            Delivered ({data.filter((d) => (Number(d.pending) || 0) === 0 && ((Number(d.delivered) || 0) + (Number(d.pending) || 0)) > 0).length})
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: errorColor }]} />
          <Text style={[styles.legendText, { color: errorColor }]}>
            Pending ({data.filter((d) => (Number(d.pending) || 0) > 0).length})
          </Text>
        </View>
      </View>
    </View>
  );
}

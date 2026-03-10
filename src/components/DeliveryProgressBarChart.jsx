import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../constants/theme';

const CHART_HEIGHT = 140;
const BAR_GAP = 4;
const FIXED_BAR_WIDTH = 18;
const LABEL_HEIGHT = 28;

/**
 * Vertical bar chart: Delivery Progress by Shop.
 * data = [{ shopId, shopName?, delivered, pending }]
 * Sorted: To deliver (pending) first, then Delivered. Colors: To deliver = red, Delivered = green.
 */
export default function DeliveryProgressBarChart({ data = [], title = 'Delivery Progress', rightElement = null }) {
  const { colors } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const barWidth = FIXED_BAR_WIDTH;
  const sortedData = useMemo(() => {
    return [...(data || [])].sort((a, b) => {
      const pendingA = Number(a.pending) || 0;
      const pendingB = Number(b.pending) || 0;
      if (pendingA === 0 && pendingB > 0) return 1;
      if (pendingA > 0 && pendingB === 0) return -1;
      return 0;
    });
  }, [data]);
  const totalBarWidth = sortedData.length * (barWidth + BAR_GAP) + BAR_GAP;

  const maxVal = useMemo(() => {
    const max = Math.max(
      ...sortedData.map((d) => (Number(d.delivered) || 0) + (Number(d.pending) || 0)),
      1
    );
    return max;
  }, [sortedData]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: 10,
          padding: spacing.sm,
          marginBottom: spacing.sm,
          overflow: 'hidden',
        },
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: spacing.sm,
          gap: 6,
        },
        title: { fontSize: 14, fontWeight: '700', color: colors.text },
        scrollHint: {
          fontSize: 10,
          color: colors.textSecondary,
          marginTop: spacing.xs,
          textAlign: 'center',
        },
        legendRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.md,
          marginTop: spacing.sm,
        },
        legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        legendBox: { width: 12, height: 12, borderRadius: 2 },
        legendText: { fontSize: 11, fontWeight: '600' },
        tooltipWrap: {
          position: 'absolute',
          left: spacing.sm,
          right: spacing.sm,
          top: 40,
          zIndex: 10,
          alignItems: 'center',
        },
        tooltip: {
          backgroundColor: colors.surface,
          borderRadius: 8,
          paddingVertical: 8,
          paddingHorizontal: 12,
          minWidth: 140,
          maxWidth: 200,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 6,
          borderWidth: 1,
          borderColor: colors.border || 'rgba(0,0,0,0.08)',
        },
        tooltipTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
        tooltipRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
        tooltipLabel: { fontSize: 11, color: colors.textSecondary },
        tooltipValue: { fontSize: 12, fontWeight: '600', color: colors.text },
      }),
    [colors]
  );

  if (!sortedData.length) {
    return (
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="bar-chart-outline" size={20} color={colors.primary} />
          <Text style={[styles.title, { flex: 1 }]}>{title}</Text>
          {rightElement}
        </View>
        <Text style={[styles.scrollHint, { marginBottom: spacing.sm }]}>No shop data for this date</Text>
      </View>
    );
  }

  const deliveredColor = colors.success ?? '#059669';
  const toDeliverColor = colors.error ?? '#dc2626';

  const selectedRow = selectedIndex != null ? sortedData[selectedIndex] : null;
  const toDeliverCount = sortedData.filter((d) => (Number(d.pending) || 0) > 0).length;
  const deliveredCount = sortedData.filter((d) => (Number(d.pending) || 0) === 0 && ((Number(d.delivered) || 0) + (Number(d.pending) || 0)) > 0).length;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
        <Text style={[styles.title, { flex: 1 }]}>{title}</Text>
        {rightElement}
      </View>
      {selectedRow != null && (
        <View style={styles.tooltipWrap} pointerEvents="box-none">
          <View style={styles.tooltip}>
            <View style={styles.tooltipRow}>
              <Text style={[styles.tooltipValue, { flex: 1, marginLeft: 8, textAlign: 'left' }]} numberOfLines={2}>
                {selectedRow.shopName || selectedRow.shopId || `Shop ${selectedIndex + 1}`}
              </Text>
            </View>
            <View style={styles.tooltipRow}>
              <Text style={styles.tooltipLabel}>Delivered (qty)</Text>
              <Text style={styles.tooltipValue}>{Math.max(0, Number(selectedRow.delivered) || 0)}</Text>
            </View>
            <View style={styles.tooltipRow}>
              <Text style={styles.tooltipLabel}>Pending (qty)</Text>
              <Text style={styles.tooltipValue}>{Math.max(0, Number(selectedRow.pending) || 0)}</Text>
            </View>
            <View style={[styles.tooltipRow, { marginBottom: 0 }]}>
              <Text style={styles.tooltipLabel}>Total gas</Text>
              <Text style={styles.tooltipValue}>
                {Math.max(0, Number(selectedRow.delivered) || 0) + Math.max(0, Number(selectedRow.pending) || 0)}
              </Text>
            </View>
          </View>
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: spacing.md }}
      >
        <View style={{ minWidth: totalBarWidth }}>
          <View style={{ flexDirection: 'row', height: CHART_HEIGHT - LABEL_HEIGHT }}>
            {sortedData.map((row, i) => {
              const delivered = Math.max(0, Number(row.delivered) || 0);
              const pending = Math.max(0, Number(row.pending) || 0);
              const total = delivered + pending || 0;
              const isFullyDelivered = pending === 0 && total > 0;
              const barColor = isFullyDelivered ? deliveredColor : toDeliverColor;
              const barHeight = total > 0 ? Math.max(6, (total / maxVal) * (CHART_HEIGHT - LABEL_HEIGHT - 10)) : 0;
              const isSelected = selectedIndex === i;
              return (
                <Pressable
                  key={row.shopId || i}
                  onPress={() => setSelectedIndex(isSelected ? null : i)}
                  style={({ pressed }) => ({
                    width: barWidth + BAR_GAP,
                    height: CHART_HEIGHT - LABEL_HEIGHT,
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    marginLeft: i === 0 ? BAR_GAP : 0,
                    opacity: pressed ? 0.85 : 1,
                    backgroundColor: isSelected ? (colors.primary + '12') : 'transparent',
                    borderRadius: 6,
                  })}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '700',
                      color: colors.text,
                      marginBottom: 2,
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
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', height: LABEL_HEIGHT, paddingLeft: BAR_GAP }}>
            {sortedData.map((row, i) => {
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
                      fontSize: 9,
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
          <View style={[styles.legendBox, { backgroundColor: toDeliverColor }]} />
          <Text style={[styles.legendText, { color: toDeliverColor }]}>
            To deliver ({toDeliverCount})
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: deliveredColor }]} />
          <Text style={[styles.legendText, { color: deliveredColor }]}>
            Delivered ({deliveredCount})
          </Text>
        </View>
      </View>
    </View>
  );
}

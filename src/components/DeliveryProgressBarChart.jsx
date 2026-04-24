import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../constants/theme';

const CHART_HEIGHT = 140;
const BAR_GAP = 4;
const FIXED_BAR_WIDTH = 18;
const LABEL_HEIGHT = 28;

const STACK_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0f766e'];
const COLOR_DELIVERED = '#16a34a';
const COLOR_PENDING = '#dc2626';

function gasSort(a, b) {
  const an = Number(String(a).replace(/[^0-9.]/g, ''));
  const bn = Number(String(b).replace(/[^0-9.]/g, ''));
  const aFinite = Number.isFinite(an);
  const bFinite = Number.isFinite(bn);
  if (aFinite && bFinite) return an - bn;
  if (aFinite) return -1;
  if (bFinite) return 1;
  return String(a).localeCompare(String(b));
}

/**
 * Vertical stacked bar chart: Delivery by Shop split by gas type.
 * data = [{ shopId, shopName?, delivered, pending, total, stacks: { [gasType]: qty } }]
 */
export default function DeliveryProgressBarChart({ data = [], title = 'Delivery Progress', rightElement = null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const barWidth = FIXED_BAR_WIDTH;
  const sortedData = useMemo(() => {
    return [...(data || [])].sort((a, b) => {
      const deliveredA = Math.max(0, Number(a.delivered) || 0);
      const deliveredB = Math.max(0, Number(b.delivered) || 0);
      if (deliveredA !== deliveredB) return deliveredB - deliveredA;
      const pendingA = Math.max(0, Number(a.pending) || 0);
      const pendingB = Math.max(0, Number(b.pending) || 0);
      return pendingB - pendingA;
    });
  }, [data]);
  const totalBarWidth = sortedData.length * (barWidth + BAR_GAP) + BAR_GAP;

  const gasKeys = useMemo(() => {
    const set = new Set();
    (sortedData || []).forEach((row) => {
      Object.keys(row?.stacks || {}).forEach((k) => set.add(k));
    });
    return Array.from(set).sort(gasSort);
  }, [sortedData]);

  const gasColorByKey = useMemo(() => {
    const map = {};
    gasKeys.forEach((k, i) => {
      map[k] = STACK_COLORS[i % STACK_COLORS.length];
    });
    return map;
  }, [gasKeys]);

  const maxVal = useMemo(() => {
    const max = Math.max(
      ...sortedData.map((d) => {
        const totalFromStacks = Object.values(d?.stacks || {}).reduce((s, n) => s + (Number(n) || 0), 0);
        const totalFallback = (Number(d.delivered) || 0) + (Number(d.pending) || 0);
        return Number(d.total) || totalFromStacks || totalFallback || 0;
      }),
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
          flexWrap: 'wrap',
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
          <Text style={[styles.title, { flex: 1 }]}>{title || t('dashboard.deliveryProgress', 'Delivery Progress')}</Text>
          {rightElement}
        </View>
        <Text style={[styles.scrollHint, { marginBottom: spacing.sm }]}>{t('common.noShopDataForThisDate', 'No shop data for this date')}</Text>
      </View>
    );
  }

  const selectedRow = selectedIndex != null ? sortedData[selectedIndex] : null;
  const toDeliverCount = sortedData.filter((d) => (Number(d.pending) || 0) > 0).length;
  const deliveredCount = sortedData.filter((d) => (Number(d.pending) || 0) === 0 && ((Number(d.delivered) || 0) + (Number(d.pending) || 0)) > 0).length;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
        <Text style={[styles.title, { flex: 1 }]}>{title || t('dashboard.deliveryProgress', 'Delivery Progress')}</Text>
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
            {gasKeys.map((k) => {
              const qty = Number(selectedRow?.stacks?.[k]) || 0;
              if (qty <= 0) return null;
              return (
                <View style={styles.tooltipRow} key={`tip-${k}`}>
                  <Text style={styles.tooltipLabel}>{k}</Text>
                  <Text style={styles.tooltipValue}>{qty}</Text>
                </View>
              );
            })}
            <View style={styles.tooltipRow}>
              <Text style={styles.tooltipLabel}>{t('common.deliveredQty', 'Delivered (qty)')}</Text>
              <Text style={styles.tooltipValue}>{Math.max(0, Number(selectedRow.delivered) || 0)}</Text>
            </View>
            <View style={styles.tooltipRow}>
              <Text style={styles.tooltipLabel}>{t('common.pendingQty', 'Pending (qty)')}</Text>
              <Text style={styles.tooltipValue}>{Math.max(0, Number(selectedRow.pending) || 0)}</Text>
            </View>
            <View style={[styles.tooltipRow, { marginBottom: 0 }]}>
              <Text style={styles.tooltipLabel}>{t('common.totalGas', 'Total gas')}</Text>
              <Text style={styles.tooltipValue}>
                {Math.max(
                  0,
                  Number(selectedRow.total) ||
                    Object.values(selectedRow?.stacks || {}).reduce((s, n) => s + (Number(n) || 0), 0) ||
                    (Math.max(0, Number(selectedRow.delivered) || 0) + Math.max(0, Number(selectedRow.pending) || 0))
                )}
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
              const totalFromStacks = Object.values(row?.stacks || {}).reduce((s, n) => s + (Number(n) || 0), 0);
              const total = Number(row.total) || totalFromStacks || delivered + pending || 0;
              const drawable = CHART_HEIGHT - LABEL_HEIGHT - 10;
              const barHeight = total > 0 ? Math.max(6, (total / maxVal) * drawable) : 0;
              const isSelected = selectedIndex === i;
              const isIncomplete = pending > 0;

              const activeKeys = gasKeys.filter((k) => Math.max(0, Number(row?.stacks?.[k]) || 0) > 0);
              let used = 0;
              const stackSegments = activeKeys
                .map((k, idx) => {
                  const qty = Math.max(0, Number(row?.stacks?.[k]) || 0);
                  if (qty <= 0 || total <= 0) return null;
                  let h = (qty / total) * barHeight;
                  if (idx === activeKeys.length - 1) {
                    h = Math.max(0, barHeight - used);
                  }
                  used += h;
                  return {
                    key: k,
                    height: h,
                    color: gasColorByKey[k],
                  };
                })
                .filter(Boolean);

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
                      overflow: 'hidden',
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                      justifyContent: 'flex-end',
                    }}
                  >
                    {isIncomplete ? (
                      <View
                        style={{
                          width: '100%',
                          height: barHeight,
                          backgroundColor: COLOR_PENDING,
                        }}
                      />
                    ) : stackSegments.length ? (
                      stackSegments.map((seg) => (
                        <View
                          key={`${row.shopId || i}-${seg.key}`}
                          style={{
                            width: '100%',
                            height: seg.height,
                            backgroundColor: seg.color,
                          }}
                        />
                      ))
                    ) : (
                      <View
                        style={{
                          width: '100%',
                          height: barHeight,
                          backgroundColor: COLOR_DELIVERED,
                        }}
                      />
                    )}
                  </View>
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
      <Text style={styles.scrollHint}>{t('common.swipeToSeeAllShops', '← Swipe to see all shops →')}</Text>
      <View style={styles.legendRow}>
        {gasKeys.map((k) => (
          <View style={styles.legendItem} key={`legend-${k}`}>
            <View style={[styles.legendBox, { backgroundColor: gasColorByKey[k] }]} />
            <Text style={[styles.legendText, { color: colors.text }]}>{k}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: COLOR_PENDING }]} />
          <Text style={[styles.legendText, { color: colors.text }]}>
            {t('common.toDeliver', 'To deliver')}
          </Text>
        </View>
      </View>
      <View style={[styles.legendRow, { marginTop: 6 }]}>
        <View style={styles.legendItem}>
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            {t('common.toDeliver', 'To deliver (')}{toDeliverCount})
          </Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            {t('common.delivered', 'Delivered (')}{deliveredCount})
          </Text>
        </View>
      </View>
    </View>
  );
}

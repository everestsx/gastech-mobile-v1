import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { colors, spacing } from '../constants/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHART_HEIGHT = 160;
const PADDING = { left: 24, right: 24, top: 12, bottom: 28 };
const POINT_RADIUS = 5;

/**
 * Build a smooth cubic Bezier path through points (Catmull-Rom style).
 */
function smoothPathThroughPoints(points) {
  if (points.length < 2) return '';
  const n = points.length;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const tension = 1 / 6;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

export default function WeeklyLineChart({ data = [], label = 'Weekly Sales' }) {
  const values = Array.isArray(data) && data.length > 0
    ? data.map((v) => Math.max(0, Number(v)))
    : [0, 4, 2, 1, 5, 3, 4];
  const min = 0;
  const max = Math.max(...values, 1);
  const range = max - min || 1;

  const { width: screenWidth } = useWindowDimensions();
  const cardPadding = spacing.md * 2;
  const chartWidth = Math.min(screenWidth - cardPadding, 340);
  const w = chartWidth - PADDING.left - PADDING.right;
  const h = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const points = values.map((v, i) => ({
    x: PADDING.left + (i / (values.length - 1 || 1)) * w,
    y: PADDING.top + h - ((v - min) / range) * h,
  }));

  const pathD = smoothPathThroughPoints(points);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        <Line
          x1={PADDING.left}
          y1={PADDING.top + h}
          x2={PADDING.left + w}
          y2={PADDING.top + h}
          stroke={colors.border}
          strokeWidth={1}
        />
        <Line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + h}
          stroke={colors.border}
          strokeWidth={1}
        />
        <Path
          d={pathD}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={POINT_RADIUS}
            fill={colors.primary}
            stroke={colors.surface}
            strokeWidth={2}
          />
        ))}
      </Svg>
      <View style={[styles.daysRow, { width: w, marginLeft: PADDING.left }]}>
        {DAYS.map((d, i) => (
          <Text key={i} style={styles.dayText}>
            {d}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginVertical: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  dayText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
});

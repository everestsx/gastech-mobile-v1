import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { colors } from '../constants/theme';

const DAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
const CHART_WIDTH = 280;
const CHART_HEIGHT = 120;
const PADDING = { left: 28, right: 12, top: 8, bottom: 24 };

export default function WeeklyLineChart({ data = [], label = 'Weekly Sales' }) {
  const values = Array.isArray(data) && data.length > 0
    ? data
    : [0, 4, 2, 1, 5, 3, 4];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = CHART_WIDTH - PADDING.left - PADDING.right;
  const h = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const points = values
    .map((v, i) => {
      const x = PADDING.left + (i / (values.length - 1 || 1)) * w;
      const y = PADDING.top + h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
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
        <Polyline
          points={points}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <View style={styles.daysRow}>
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
    marginVertical: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  daysRow: {
    flexDirection: 'row',
    width: CHART_WIDTH - PADDING.left - PADDING.right,
    marginLeft: PADDING.left,
    justifyContent: 'space-between',
    marginTop: 4,
  },
  dayText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
});

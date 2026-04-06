import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useSync } from '../context/SyncContext';

const DOT_SIZE = 6;
const GAP = 4;

/**
 * Horizontal three-dots sync indicator. Same animation as dashboard.
 * Renders only when app is syncing with backend (isSyncing from SyncContext).
 */
export default function SyncIndicator({ dotSize = DOT_SIZE, gap = GAP, style }) {
  const { isSyncing } = useSync();
  const a1 = useRef(new Animated.Value(0.4)).current;
  const a2 = useRef(new Animated.Value(0.4)).current;
  const a3 = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!isSyncing) return;
    const duration = 600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(a1, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(a2, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a3, { toValue: 0.4, duration, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(a1, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a2, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(a3, { toValue: 0.4, duration, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(a1, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a2, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a3, { toValue: 1, duration, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(a1, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a2, { toValue: 0.4, duration, useNativeDriver: true }),
          Animated.timing(a3, { toValue: 0.4, duration, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isSyncing, a1, a2, a3]);

  if (!isSyncing) return null;

  const color = '#22c55e';
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.label}>Syncing…</Text>
      <View style={styles.row}>
        <Animated.View style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color, opacity: a1 }]} />
        <Animated.View style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color, opacity: a2, marginLeft: gap }]} />
        <Animated.View style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color, opacity: a3, marginLeft: gap }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '300', color: 'rgba(255,255,255,0.95)', marginBottom: 6, letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: {},
});

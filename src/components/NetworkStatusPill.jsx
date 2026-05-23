import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { subscribeNetworkStatus, NetworkQuality } from '../services/networkStatus.service';

const PILL_THEME = {
  [NetworkQuality.GOOD]: {
    label: 'Online',
    dot: '#34d399',
    text: '#34d399',
    border: '#34d399',
    bg: 'rgba(52, 211, 153, 0.14)',
  },
  [NetworkQuality.WEAK]: {
    label: 'Weak signal',
    dot: '#fbbf24',
    text: '#fbbf24',
    border: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.14)',
  },
  [NetworkQuality.OFFLINE]: {
    label: 'Offline',
    dot: '#f87171',
    text: '#f87171',
    border: '#f87171',
    bg: 'rgba(248, 113, 113, 0.14)',
  },
};

/**
 * Animated pill badge for live connection status (replaces emoji signal row).
 */
export default function NetworkStatusPill({ style }) {
  const [quality, setQuality] = useState(NetworkQuality.OFFLINE);
  const fade = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const dotPulse = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef(null);

  useEffect(() => {
    return subscribeNetworkStatus((snap) => setQuality(snap.quality));
  }, []);

  useEffect(() => {
    fade.setValue(0.72);
    scale.setValue(0.94);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [quality, fade, scale]);

  useEffect(() => {
    pulseLoopRef.current?.stop?.();
    if (quality === NetworkQuality.OFFLINE) {
      dotPulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 1.35,
          duration: quality === NetworkQuality.GOOD ? 900 : 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: quality === NetworkQuality.GOOD ? 900 : 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoopRef.current = loop;
    loop.start();
    return () => loop.stop();
  }, [quality, dotPulse]);

  const theme = PILL_THEME[quality] || PILL_THEME[NetworkQuality.OFFLINE];

  return (
    <Animated.View
      style={[
        styles.wrap,
        style,
        {
          opacity: fade,
          transform: [{ scale }],
          backgroundColor: theme.bg,
          borderColor: theme.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Internet: ${theme.label}`}
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: theme.dot, transform: [{ scale: dotPulse }] },
        ]}
      />
      <Text style={[styles.label, { color: theme.text }]}>{theme.label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
});

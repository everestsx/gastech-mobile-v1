import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNetwork } from '../context/NetworkContext';

const size = 10;

export default function NetworkStatusIndicator() {
  const { isOnline, isSyncingAfterReconnect } = useNetwork();
  const color = isSyncingAfterReconnect
    ? '#eab308'
    : isOnline === true
      ? '#22c55e'
      : isOnline === false
        ? '#ef4444'
        : '#94a3b8';
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: size,
    height: size,
    borderRadius: size / 2,
  },
});

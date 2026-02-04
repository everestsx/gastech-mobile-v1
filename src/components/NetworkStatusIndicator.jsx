import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNetwork } from '../context/NetworkContext';

const size = 10;

export default function NetworkStatusIndicator() {
  const { isOnline, isSyncingAfterReconnect } = useNetwork();
  const color = isSyncingAfterReconnect
    ? '#eab308'
    : isOnline
      ? '#22c55e'
      : '#ef4444';
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: size,
    height: size,
    borderRadius: size / 2,
  },
});

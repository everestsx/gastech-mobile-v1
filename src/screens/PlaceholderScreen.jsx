import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../constants/theme';

export default function PlaceholderScreen({ route }) {
  const { colors } = useTheme();
  const title = route?.params?.title ?? 'Coming soon';
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  text: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 14, marginTop: 8 },
});

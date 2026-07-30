import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { createDashboardModalStyles } from './dashboardModalStyles';

export default function DashboardInitialLoadScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createDashboardModalStyles(colors), [colors]);

  return (
    <View style={[styles.initialSyncCenter, { flex: 1, backgroundColor: colors.background }]}>
      <Ionicons name="cloud-download-outline" size={36} color={colors.primary} />
      <Text style={[styles.initialSyncTitle, { color: colors.text }]}>
        {t('dashboard.initialSyncTitle', 'Loading your data...')}
      </Text>
      <Text style={[styles.initialSyncSub, { color: colors.textSecondary }]}>
        {t('dashboard.initialSyncSub', 'This only takes a moment.')}
      </Text>
      <ActivityIndicator style={{ marginTop: 16 }} size="large" color={colors.primary} />
    </View>
  );
}

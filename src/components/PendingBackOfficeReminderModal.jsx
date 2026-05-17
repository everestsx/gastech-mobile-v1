import React, { useMemo } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';

/**
 * Shown when orange “payment pending upload” count stays > 0 for 10+ minutes.
 * Copy uses the app’s current language only.
 */
export default function PendingBackOfficeReminderModal({
  visible,
  orderCount,
  onClose,
  onSyncPress,
  syncActive = false,
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const count = Math.max(0, Number(orderCount) || 0);

  const title = t('dashboard.pendingBackOffice.title', { count });
  const body = t('dashboard.pendingBackOffice.body', { count });
  const closeLabel = t('dashboard.pendingBackOffice.close', 'Close');
  const syncLabel = syncActive
    ? t('menu.syncing', 'Syncing...')
    : t('dashboard.pendingBackOffice.sync', 'Sync now');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          justifyContent: 'center',
          padding: spacing.lg,
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        accent: {
          alignSelf: 'center',
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: `${colors.warning ?? '#d97706'}22`,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        headline: {
          fontSize: 18,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        body: {
          fontSize: 14,
          lineHeight: 22,
          color: colors.textSecondary,
          textAlign: 'center',
          marginBottom: spacing.lg,
        },
        syncBtn: {
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: 14,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          marginBottom: spacing.sm,
        },
        syncBtnDisabled: {
          opacity: 0.75,
        },
        syncBtnText: {
          color: '#fff',
          fontSize: 16,
          fontWeight: '700',
        },
        closeBtn: {
          borderRadius: borderRadius.md,
          paddingVertical: 12,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        },
        closeBtnText: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
      }),
    [colors]
  );

  const handleSync = () => {
    if (syncActive || !onSyncPress) return;
    onSyncPress();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.accent}>
            <Ionicons name="cloud-upload-outline" size={34} color={colors.warning ?? '#d97706'} />
          </View>
          <Text style={styles.headline}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity
            style={[styles.syncBtn, syncActive && styles.syncBtnDisabled]}
            onPress={handleSync}
            disabled={syncActive}
            activeOpacity={0.88}
          >
            {syncActive ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="sync-outline" size={20} color="#fff" />
            )}
            <Text style={styles.syncBtnText}>{syncLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.88}>
            <Text style={styles.closeBtnText}>{closeLabel}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

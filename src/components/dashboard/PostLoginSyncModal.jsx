import React, { useMemo } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { createDashboardModalStyles } from './dashboardModalStyles';

export default function PostLoginSyncModal({ visible, copy, onClose }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDashboardModalStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.syncSuccessAccent}>
            <Ionicons name="cloud-done" size={40} color={colors.primary} />
          </View>
          <Text style={styles.syncSuccessTitle}>{copy?.title}</Text>
          <Text style={styles.syncSuccessSubtitle}>{copy?.subtitle}</Text>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose} activeOpacity={0.88}>
            <Text style={styles.modalCloseBtnText}>{copy?.button}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

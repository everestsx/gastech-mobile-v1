import React, { useMemo } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { odooImageToUri } from '../../services/employee.service';
import { createDashboardModalStyles } from './dashboardModalStyles';

export default function ProfileModal({ visible, profile, onClose }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createDashboardModalStyles(colors), [colors]);

  const openDial = (raw) => {
    const s = String(raw || '').replace(/[^\d+]/g, '');
    if (!s) return;
    Linking.openURL(`tel:${s}`).catch(() => {});
  };

  const avatarUri = profile?.imageBase64 ? odooImageToUri(profile.imageBase64) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          {profile ? (
            <>
              <View style={styles.profileHero}>
                <View style={styles.profileAvatarLg}>
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="person" size={44} color={colors.textSecondary} />
                    </View>
                  )}
                </View>
                <Text style={styles.profileNameLg}>{profile.name}</Text>
                <Text style={styles.profileRole}>{profile.subtitle}</Text>
                {profile.phone ? (
                  <TouchableOpacity
                    style={styles.profilePhoneRow}
                    onPress={() => openDial(profile.phone)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="call-outline" size={22} color={colors.primary} />
                    <Text style={styles.profilePhoneText}>{profile.phone}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.profileNoPhone}>
                    {t('dashboard.noPhoneOnFile', 'No phone number on file')}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose} activeOpacity={0.88}>
                <Text style={styles.modalCloseBtnText}>{t('settings.close', 'Close')}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

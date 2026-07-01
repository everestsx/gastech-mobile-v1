import React, { useMemo } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { createDashboardModalStyles } from './dashboardModalStyles';

export default function RoutePickerModal({
  visible,
  routes = [],
  selectedRouteId,
  onSelectRoute,
  onClose,
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createDashboardModalStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t('dashboard.chooseRoute', 'Choose route')}</Text>
          <Text style={styles.modalSubtitle}>
            {t(
              'dashboard.chooseRouteHint',
              "Pick a route to filter your list, or Recommended for today's usual route."
            )}
          </Text>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[styles.routePickRow, selectedRouteId === null && styles.routePickRowActive]}
              onPress={() => {
                onSelectRoute?.(null);
                onClose?.();
              }}
            >
              <Text style={styles.routePickName}>{t('dashboard.recommendedToday', 'Recommended (today)')}</Text>
              {selectedRouteId === null ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : null}
            </TouchableOpacity>
            {routes.map((r) => {
              const id = Number(r.id);
              const active = selectedRouteId != null && Number(selectedRouteId) === id;
              return (
                <TouchableOpacity
                  key={String(r.id)}
                  style={[styles.routePickRow, active && styles.routePickRowActive]}
                  onPress={() => {
                    onSelectRoute?.(id);
                    onClose?.();
                  }}
                >
                  <Text style={styles.routePickName}>{r.name || `Route ${r.id}`}</Text>
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose} activeOpacity={0.88}>
            <Text style={styles.modalCloseBtnText}>{t('settings.close', 'Close')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

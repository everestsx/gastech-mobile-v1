import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, Platform, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { formatDateRangeLabel, getTodayDateRange } from '../../services/commisrioNew.service';
import { createDashboardModalStyles } from './dashboardModalStyles';

export default function CommissionRangeModal({ visible, initialRange, onClose, onApply }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createDashboardModalStyles(colors), [colors]);

  const [draft, setDraft] = useState({ dateFrom: '', dateTo: '' });
  const [pickerField, setPickerField] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setDraft({
      dateFrom: initialRange?.dateFrom || '',
      dateTo: initialRange?.dateTo || '',
    });
    setPickerField(null);
  }, [visible, initialRange?.dateFrom, initialRange?.dateTo]);

  const closeModal = () => {
    setPickerField(null);
    onClose?.();
  };

  const handleApply = () => {
    let dateFrom = draft.dateFrom;
    let dateTo = draft.dateTo;
    if (!dateFrom || !dateTo) {
      Alert.alert(
        t('dashboard.rangeInvalid', 'Date range'),
        t('dashboard.selectBothDates', 'Please choose both from and to dates.')
      );
      return;
    }
    if (dateFrom > dateTo) {
      const swapped = dateFrom;
      dateFrom = dateTo;
      dateTo = swapped;
    }
    onApply?.({ dateFrom, dateTo });
    closeModal();
  };

  const pickerValue = (() => {
    const key = pickerField === 'from' ? 'dateFrom' : 'dateTo';
    const raw = draft[key] || initialRange?.[key] || getTodayDateRange().dateFrom;
    const d = new Date(`${String(raw).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModal}>
      <Pressable style={styles.modalBackdrop} onPress={closeModal}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t('dashboard.commissionDateRange', 'Date range')}</Text>
          <Text style={styles.modalSubtitle}>
            {t(
              'dashboard.commissionDateRangeHint',
              'Choose from and to, then apply. You can also use Today / Yesterday / This month.'
            )}
          </Text>
          <TouchableOpacity
            style={styles.commissionModalRangeRow}
            onPress={() => setPickerField('from')}
            activeOpacity={0.8}
          >
            <Text style={styles.commissionModalRangeLabel}>{t('dashboard.dateFrom', 'From')}</Text>
            <Text style={styles.commissionModalRangeValue}>
              {formatDateRangeLabel(draft.dateFrom, draft.dateFrom)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.commissionModalRangeRow}
            onPress={() => setPickerField('to')}
            activeOpacity={0.8}
          >
            <Text style={styles.commissionModalRangeLabel}>{t('dashboard.dateTo', 'To')}</Text>
            <Text style={styles.commissionModalRangeValue}>
              {formatDateRangeLabel(draft.dateTo, draft.dateTo)}
            </Text>
          </TouchableOpacity>
          {pickerField ? (
            <DateTimePicker
              value={pickerValue}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(e, date) => {
                if (e?.type === 'dismissed') {
                  if (Platform.OS === 'android') setPickerField(null);
                  return;
                }
                if (!date) {
                  if (Platform.OS === 'android') setPickerField(null);
                  return;
                }
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d0 = String(date.getDate()).padStart(2, '0');
                const s = `${y}-${m}-${d0}`;
                setDraft((prev) => ({
                  ...prev,
                  [pickerField === 'from' ? 'dateFrom' : 'dateTo']: s,
                }));
                if (Platform.OS === 'android') setPickerField(null);
              }}
            />
          ) : null}
          {pickerField && Platform.OS === 'ios' ? (
            <TouchableOpacity onPress={() => setPickerField(null)} style={styles.commissionModalDoneBtn}>
              <Text style={[styles.commissionModalDoneText, { color: colors.primary }]}>
                {t('dashboard.done', 'Done')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.commissionModalActionRow}>
            <TouchableOpacity style={styles.commissionModalCancelBtn} onPress={closeModal} activeOpacity={0.86}>
              <Text style={styles.commissionModalCancelText}>{t('common.cancel', 'Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commissionModalApplyBtn} onPress={handleApply} activeOpacity={0.86}>
              <Text style={styles.commissionModalApplyText}>{t('dashboard.apply', 'Apply')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

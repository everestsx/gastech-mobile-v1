import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Dimensions,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { formatCurrency } from '../../utils/format';
import { insertPostCheckSubmission } from '../../database/postcheckSubmissions.js';
import { createCheckSheetStyles } from './checkSheetStyles';

export default function PostCheckHandoverModal({
  visible,
  onClose,
  orderSyncStats,
  user,
  initialCash,
  initialCheque,
  initialCredit,
  onSubmitted,
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createCheckSheetStyles(colors), [colors]);

  const [editCash, setEditCash] = useState(String(initialCash ?? ''));
  const [editCheque, setEditCheque] = useState(String(initialCheque ?? ''));
  const [editCredit, setEditCredit] = useState(String(initialCredit ?? ''));
  const [dropoffLocation, setDropoffLocation] = useState('headoffice');
  const [submitting, setSubmitting] = useState(false);
  const [lockedStats, setLockedStats] = useState({ localCompleted: 0, syncedCompleted: 0 });

  const wasVisibleRef = useRef(false);

  const sheetLayout = useMemo(() => {
    const screenH = Dimensions.get('window').height;
    const sheetMax = Math.round(screenH * 0.92);
    const footerH = 76 + Math.max(insets.bottom, 12);
    const scrollH = Math.max(220, sheetMax - footerH);
    return { sheetMax, scrollH };
  }, [insets.bottom]);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setEditCash(String(initialCash ?? ''));
      setEditCheque(String(initialCheque ?? ''));
      setEditCredit(String(initialCredit ?? ''));
      setDropoffLocation('headoffice');
      setSubmitting(false);
      setLockedStats({
        localCompleted: orderSyncStats?.localCompleted ?? 0,
        syncedCompleted: orderSyncStats?.syncedCompleted ?? 0,
      });
    }
    wasVisibleRef.current = visible;
  }, [visible, initialCash, initialCheque, initialCredit, orderSyncStats]);

  const pendingUpload = (lockedStats.localCompleted ?? 0) > 0;
  const submitDisabled = pendingUpload || submitting;

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    const pendingNow = (orderSyncStats?.localCompleted ?? 0) > 0;
    if (pendingNow) {
      Alert.alert(
        t('dashboard.postCheckSyncRequiredTitle', 'Sync required'),
        t(
          'dashboard.postCheckSyncRequiredBody',
          '{{count}} payment(s) still pending upload. Please sync before submitting handover.',
          { count: orderSyncStats?.localCompleted ?? 0 }
        )
      );
      return;
    }

    const finalCash = parseFloat(editCash) || 0;
    const finalCheque = parseFloat(editCheque) || 0;
    const finalCredit = parseFloat(editCredit) || 0;

    setSubmitting(true);
    try {
      await insertPostCheckSubmission({
        submittedAt: new Date().toISOString(),
        driverId: user?.driverId ?? null,
        driverName: user?.driverName ?? null,
        vehicleId: user?.vehicleId ?? null,
        vehicleName: user?.vehicleName ?? null,
        cashTotal: finalCash,
        chequeTotal: finalCheque,
        creditTotal: finalCredit,
        dropoffLocation,
        ordersSynced: orderSyncStats?.syncedCompleted ?? 0,
        ordersPending: orderSyncStats?.localCompleted ?? 0,
      });
      onClose();
      onSubmitted?.({
        finalCash,
        finalCheque,
        finalCredit,
        dropoffLocation,
      });
    } catch (err) {
      Alert.alert(
        t('common.error', 'Error'),
        t('dashboard.postCheckSaveFailed', 'Could not save handover. Please try again.')
      );
      console.error('[PostCheck] save failed', err);
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    orderSyncStats,
    editCash,
    editCheque,
    editCredit,
    dropoffLocation,
    user,
    onClose,
    onSubmitted,
    t,
  ]);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.60)' }}>
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
          />
          <View
            style={[
              styles.postCheckSheet,
              styles.postCheckHandoverSheet,
              { maxHeight: sheetLayout.sheetMax },
            ]}
          >
            <ScrollView
              style={{ height: sheetLayout.scrollH }}
              contentContainerStyle={{ paddingBottom: 8, paddingHorizontal: 20 }}
              showsVerticalScrollIndicator
              persistentScrollbar={Platform.OS === 'android'}
              bounces
              overScrollMode="always"
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              nestedScrollEnabled
            >
              <View style={styles.postCheckHandle} />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: (colors.primary ?? '#6366f1') + '22',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="cash-outline" size={20} color={colors.primary ?? '#6366f1'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.postCheckTitle}>
                    {t('dashboard.postCheckTitle', 'End Day Handover Summary')}
                  </Text>
                </View>
              </View>

              <View style={styles.postCheckDivider} />

              {pendingUpload ? (
                <View style={styles.postCheckPendingWarning}>
                  <Ionicons name="warning-outline" size={18} color="#f59e0b" />
                  <Text style={styles.postCheckPendingWarningText}>
                    {t(
                      'dashboard.postCheckPendingWarning',
                      '{{count}} payment pending upload. Sync before submitting.',
                      { count: lockedStats.localCompleted }
                    )}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.postCheckSectionLabel}>
                {t('dashboard.postCheckCollectionSummary', 'Collection Summary')}
              </Text>

              <View style={styles.postCheckRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: 'rgba(34,197,94,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="cash" size={16} color="#22c55e" />
                  </View>
                  <Text style={styles.postCheckRowLabel}>{t('dashboard.cash', 'Cash')}</Text>
                </View>
                <View
                  style={[
                    styles.postCheckEditWrap,
                    { borderColor: '#22c55e44', backgroundColor: 'rgba(34,197,94,0.06)' },
                  ]}
                >
                  <TextInput
                    style={[styles.postCheckEditInput, { color: '#22c55e' }]}
                    value={editCash}
                    onChangeText={setEditCash}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    placeholderTextColor="#22c55e88"
                    editable={!submitting}
                  />
                </View>
              </View>

              <View style={styles.postCheckRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: 'rgba(99,102,241,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="document-text" size={16} color={colors.primary} />
                  </View>
                  <Text style={styles.postCheckRowLabel}>{t('dashboard.cheque', 'Cheque')}</Text>
                </View>
                <View
                  style={[
                    styles.postCheckEditWrap,
                    {
                      borderColor: (colors.primary ?? '#6366f1') + '44',
                      backgroundColor: (colors.primary ?? '#6366f1') + '0d',
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.postCheckEditInput, { color: colors.primary }]}
                    value={editCheque}
                    onChangeText={setEditCheque}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    placeholderTextColor={(colors.primary ?? '#6366f1') + '88'}
                    editable={!submitting}
                  />
                </View>
              </View>

              <View style={styles.postCheckRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: 'rgba(245,158,11,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="card" size={16} color="#f59e0b" />
                  </View>
                  <Text style={styles.postCheckRowLabel}>{t('dashboard.credit', 'Credit')}</Text>
                </View>
                <View
                  style={[
                    styles.postCheckEditWrap,
                    { borderColor: '#f59e0b44', backgroundColor: 'rgba(245,158,11,0.06)' },
                  ]}
                >
                  <TextInput
                    style={[styles.postCheckEditInput, { color: '#f59e0b' }]}
                    value={editCredit}
                    onChangeText={setEditCredit}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    placeholderTextColor="#f59e0b88"
                    editable={!submitting}
                  />
                </View>
              </View>

              <View style={styles.postCheckTotalRow}>
                <Text style={styles.postCheckTotalLabel}>
                  {t('dashboard.postCheckTotalHandover', 'Total Handover')}
                </Text>
                <Text style={styles.postCheckTotalValue}>
                  {formatCurrency((parseFloat(editCash) || 0) + (parseFloat(editCheque) || 0))}
                </Text>
              </View>

              <View style={styles.postCheckDivider} />

              <Text style={styles.postCheckSectionLabel}>
                {t('dashboard.postCheckOrdersSummary', 'Orders Summary')}
              </Text>
              <View style={styles.postCheckRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: 'rgba(34,197,94,0.12)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                  </View>
                  <Text style={styles.postCheckRowLabel}>
                    {t('dashboard.postCheckSyncedCompleted', 'Synced & Completed')}
                  </Text>
                </View>
                <Text style={[styles.postCheckRowValue, { color: '#22c55e' }]}>
                  {lockedStats.syncedCompleted ?? 0}
                </Text>
              </View>
              <View style={styles.postCheckRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: 'rgba(245,158,11,0.12)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="time-outline" size={16} color="#f59e0b" />
                  </View>
                  <Text style={styles.postCheckRowLabel}>
                    {t('dashboard.postCheckPendingInvoice', 'Pending Invoice')}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.postCheckRowValue,
                    { color: pendingUpload ? '#f59e0b' : (colors.textSecondary ?? '#94a3b8') },
                  ]}
                >
                  {lockedStats.localCompleted ?? 0}
                </Text>
              </View>

              <View style={styles.postCheckDivider} />

              <Text style={styles.postCheckDropLabel}>
                {t('dashboard.postCheckDropoffLocation', 'Drop-off Location')}
              </Text>
              <View style={styles.postCheckDropRow}>
                {['headoffice', 'showroom'].map((loc) => {
                  const active = dropoffLocation === loc;
                  const icon = loc === 'headoffice' ? 'storefront-outline' : 'business-outline';
                  const label =
                    loc === 'headoffice'
                      ? t('dashboard.postCheckHeadOffice', 'Head Office')
                      : t('dashboard.postCheckShowroom', 'Showroom');
                  return (
                    <TouchableOpacity
                      key={loc}
                      style={[styles.postCheckDropOption, active && styles.postCheckDropOptionActive]}
                      onPress={() => setDropoffLocation(loc)}
                      activeOpacity={0.8}
                      disabled={submitting}
                    >
                      <Ionicons
                        name={icon}
                        size={22}
                        color={active ? (colors.primary ?? '#6366f1') : (colors.textSecondary ?? '#94a3b8')}
                      />
                      <Text style={[styles.postCheckDropOptionText, active && styles.postCheckDropOptionTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <TouchableOpacity
                style={[styles.postCheckSubmitBtn, submitDisabled && styles.postCheckSubmitBtnDisabled]}
                disabled={submitDisabled}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => void handleSubmit()}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color={submitDisabled ? (colors.textSecondary ?? '#94a3b8') : '#fff'}
                  />
                )}
                <Text
                  style={[
                    styles.postCheckSubmitBtnText,
                    submitDisabled && { color: colors.textSecondary ?? '#94a3b8' },
                  ]}
                >
                  {submitting
                    ? t('dashboard.postCheckSubmitting', 'Submitting...')
                    : pendingUpload
                      ? t('dashboard.postCheckSyncPending', 'Sync Pending – Cannot Submit')
                      : t('dashboard.postCheckSubmit', 'Submit Handover')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { formatCurrency } from '../../utils/format';
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
  const [dropoffLocation, setDropoffLocation] = useState('showroom');

  React.useEffect(() => {
    if (visible) {
      setEditCash(String(initialCash ?? ''));
      setEditCheque(String(initialCheque ?? ''));
      setEditCredit(String(initialCredit ?? ''));
      setDropoffLocation('showroom');
    }
  }, [visible, initialCash, initialCheque, initialCredit]);

  const pendingUpload = (orderSyncStats?.localCompleted ?? 0) > 0;

  const handleSubmit = async () => {
    const finalCash = parseFloat(editCash) || 0;
    const finalCheque = parseFloat(editCheque) || 0;
    const finalCredit = parseFloat(editCredit) || 0;
    try {
      const { insertPostCheckSubmission } = await import('../../database/postcheckSubmissions.js');
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
      Alert.alert('Error', 'Could not save handover. Please try again.');
      console.error('[PostCheck] save failed', err);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.60)' }]}
          onPress={onClose}
        />
        <View style={[styles.postCheckSheet, { flexDirection: 'column' }]}>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 8, paddingHorizontal: 20 }}
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
                  {t('dashboard.postCheckTitle', 'End Day — Handover Summary')}
                </Text>
              </View>
            </View>

            <View style={styles.postCheckDivider} />

            {pendingUpload ? (
              <View style={styles.postCheckPendingWarning}>
                <Ionicons name="warning-outline" size={18} color="#f59e0b" />
                <Text style={styles.postCheckPendingWarningText}>
                  {orderSyncStats.localCompleted} payment
                  {orderSyncStats.localCompleted > 1 ? 's' : ''} pending upload. Sync before submitting.
                </Text>
              </View>
            ) : null}

            <Text style={styles.postCheckSectionLabel}>Collection Summary</Text>

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
                <Text style={styles.postCheckRowLabel}>Cash</Text>
              </View>
              <View
                style={[styles.postCheckEditWrap, { borderColor: '#22c55e44', backgroundColor: 'rgba(34,197,94,0.06)' }]}
              >
                <TextInput
                  style={[styles.postCheckEditInput, { color: '#22c55e' }]}
                  value={editCash}
                  onChangeText={setEditCash}
                  keyboardType="numeric"
                  selectTextOnFocus
                  placeholderTextColor="#22c55e88"
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
                <Text style={styles.postCheckRowLabel}>Cheque</Text>
              </View>
              <View
                style={[
                  styles.postCheckEditWrap,
                  { borderColor: (colors.primary ?? '#6366f1') + '44', backgroundColor: (colors.primary ?? '#6366f1') + '0d' },
                ]}
              >
                <TextInput
                  style={[styles.postCheckEditInput, { color: colors.primary }]}
                  value={editCheque}
                  onChangeText={setEditCheque}
                  keyboardType="numeric"
                  selectTextOnFocus
                  placeholderTextColor={(colors.primary ?? '#6366f1') + '88'}
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
                <Text style={styles.postCheckRowLabel}>Credit</Text>
              </View>
              <View
                style={[styles.postCheckEditWrap, { borderColor: '#f59e0b44', backgroundColor: 'rgba(245,158,11,0.06)' }]}
              >
                <TextInput
                  style={[styles.postCheckEditInput, { color: '#f59e0b' }]}
                  value={editCredit}
                  onChangeText={setEditCredit}
                  keyboardType="numeric"
                  selectTextOnFocus
                  placeholderTextColor="#f59e0b88"
                />
              </View>
            </View>

            <View style={styles.postCheckTotalRow}>
              <Text style={styles.postCheckTotalLabel}>Total Handover</Text>
              <Text style={styles.postCheckTotalValue}>
                {formatCurrency((parseFloat(editCash) || 0) + (parseFloat(editCheque) || 0))}
              </Text>
            </View>

            <View style={styles.postCheckDivider} />

            <Text style={styles.postCheckSectionLabel}>Orders Summary</Text>
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
                <Text style={styles.postCheckRowLabel}>Synced & Completed</Text>
              </View>
              <Text style={[styles.postCheckRowValue, { color: '#22c55e' }]}>
                {orderSyncStats?.syncedCompleted ?? 0}
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
                <Text style={styles.postCheckRowLabel}>Pending Invoice</Text>
              </View>
              <Text
                style={[
                  styles.postCheckRowValue,
                  { color: pendingUpload ? '#f59e0b' : (colors.textSecondary ?? '#94a3b8') },
                ]}
              >
                {orderSyncStats?.localCompleted ?? 0}
              </Text>
            </View>

            <View style={styles.postCheckDivider} />

            <Text style={styles.postCheckDropLabel}>Drop-off Location</Text>
            <View style={styles.postCheckDropRow}>
              {['showroom', 'headoffice'].map((loc) => {
                const active = dropoffLocation === loc;
                const icon = loc === 'showroom' ? 'storefront-outline' : 'business-outline';
                const label = loc === 'showroom' ? 'Showroom' : 'Head Office';
                return (
                  <TouchableOpacity
                    key={loc}
                    style={[styles.postCheckDropOption, active && styles.postCheckDropOptionActive]}
                    onPress={() => setDropoffLocation(loc)}
                    activeOpacity={0.8}
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
              style={[styles.postCheckSubmitBtn, pendingUpload && styles.postCheckSubmitBtnDisabled]}
              disabled={pendingUpload}
              activeOpacity={0.85}
              onPress={() => void handleSubmit()}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color={pendingUpload ? (colors.textSecondary ?? '#94a3b8') : '#fff'}
              />
              <Text
                style={[
                  styles.postCheckSubmitBtnText,
                  pendingUpload && { color: colors.textSecondary ?? '#94a3b8' },
                ]}
              >
                {pendingUpload ? 'Sync Pending – Cannot Submit' : 'Submit Handover'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

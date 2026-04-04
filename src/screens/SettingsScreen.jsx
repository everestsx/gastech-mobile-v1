import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Modal,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getUserSession } from '../services/sync.service';
import { odooImageToUri } from '../services/employee.service';
import { spacing, borderRadius } from '../constants/theme';

export default function SettingsScreen({ navigation }) {
  const {
    colors,
    theme,
    setTheme,
    showCreateSalesOrder,
    showReturnOrder,
    setShowCreateSalesOrder,
    setShowReturnOrder,
    syncPeriod,
    setSyncPeriod,
    syncDateField,
    setSyncDateField,
    syncInterval,
    setSyncInterval,
    appLanguage,
    setAppLanguage,
  } = useTheme();
  const [user, setUser] = useState(null);
  const [showSyncPeriodModal, setShowSyncPeriodModal] = useState(false);
  const [showSyncDateFieldModal, setShowSyncDateFieldModal] = useState(false);
  const [showSyncIntervalModal, setShowSyncIntervalModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  useEffect(() => {
    getUserSession().then(setUser);
  }, []);

  const sectionTitle = (label) => (
    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{label}</Text>
  );

  const row = (icon, label, right) => (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={22} color={colors.primary} />
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      </View>
      {right}
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile */}
      <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primary, overflow: 'hidden' }]}>
          {user?.driverImageBase64 ? (
            <Image
              source={{ uri: odooImageToUri(user.driverImageBase64) }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.avatarText}>
              {(user?.driverName || user?.username || user?.licensePlate || 'U').charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {user?.driverName || user?.username || user?.licensePlate || 'User'}
          </Text>
          <Text style={[styles.profileEmail, { color: colors.textSecondary }]} numberOfLines={2}>
            {user?.driverName
              ? [user?.licensePlate || user?.vehicleName, user?.driverBarcode].filter(Boolean).join(' · ')
              : user?.email || (user?.username ? `@${user.username}` : '—')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
      </View>

      {/* Theme */}
      {sectionTitle('Appearance')}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons
            name={theme === 'dark' ? 'moon' : 'sunny-outline'}
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Dark mode</Text>
        </View>
        <Switch
          value={theme === 'dark'}
          onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={theme === 'dark' ? colors.primary : colors.surface}
        />
      </View>

      {sectionTitle('Language')}
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowLanguageModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="language-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>App language</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>
            {appLanguage === 'ta' ? 'Tamil' : appLanguage === 'si' ? 'Sinhala' : 'English'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>

      {/* Dashboard cards */}
      {sectionTitle('Dashboard')}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons name="cart-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Show Create Sales Order card</Text>
        </View>
        <Switch
          value={showCreateSalesOrder}
          onValueChange={setShowCreateSalesOrder}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={showCreateSalesOrder ? colors.primary : colors.surface}
        />
      </View>
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons name="return-down-back-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Show Return Order card</Text>
        </View>
        <Switch
          value={showReturnOrder}
          onValueChange={setShowReturnOrder}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={showReturnOrder ? colors.primary : colors.surface}
        />
      </View>

      {/* Sync Settings */}
      {sectionTitle('Sync')}
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowSyncPeriodModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="cloud-download-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Sync Period</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>
            {syncPeriod === '7days' ? 'Last 7 days' : syncPeriod === '30days' ? 'Last 30 days' : syncPeriod === '90days' ? 'Last 90 days' : syncPeriod === '1year' ? 'Last year' : 'All time'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowSyncIntervalModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="time-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Sync Time</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>
            {syncInterval === '5min'
              ? '5 minutes'
              : syncInterval === '10min'
                ? '10 minutes'
              : syncInterval === '30min'
                ? '30 minutes'
                : syncInterval === '1hour'
                  ? '1 hour'
                  : syncInterval === '2hour'
                    ? '2 hours'
                    : '1 minute'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowSyncDateFieldModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="funnel-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Sync Date Field</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>
            {syncDateField === 'delivery_date' ? 'Delivery date' : 'Creation date'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>

      <Modal
        visible={showSyncPeriodModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSyncPeriodModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Sync Period</Text>
            {[
              { label: 'Last 7 days', value: '7days' },
              { label: 'Last 30 days', value: '30days' },
              { label: 'Last 90 days', value: '90days' },
              { label: 'Last 1 year', value: '1year' },
              { label: 'All time', value: 'all' },
            ].map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={async () => {
                  await setSyncPeriod(option.value);
                  setShowSyncPeriodModal(false);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.modalOptionText, { color: colors.text }]}>
                  {option.label}
                </Text>
                {syncPeriod === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => setShowSyncPeriodModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSyncIntervalModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSyncIntervalModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Sync Time</Text>
            {[
              { label: '1 minute', value: '1min' },
              { label: '5 minutes', value: '5min' },
              { label: '10 minutes', value: '10min' },
              { label: '30 minutes', value: '30min' },
              { label: '1 hour', value: '1hour' },
              { label: '2 hours', value: '2hour' },
            ].map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={async () => {
                  await setSyncInterval(option.value);
                  setShowSyncIntervalModal(false);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.modalOptionText, { color: colors.text }]}>
                  {option.label}
                </Text>
                {syncInterval === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => setShowSyncIntervalModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLanguageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>App language</Text>
            {[
              { label: 'English', value: 'en' },
              { label: 'Tamil', value: 'ta' },
              { label: 'Sinhala', value: 'si' },
            ].map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={async () => {
                  await setAppLanguage(option.value);
                  setShowLanguageModal(false);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.modalOptionText, { color: colors.text }]}>{option.label}</Text>
                {appLanguage === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => setShowLanguageModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSyncDateFieldModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSyncDateFieldModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Sync Date Field</Text>
            {[
              { label: 'Creation date', value: 'creation_date' },
              { label: 'Delivery date', value: 'delivery_date' },
            ].map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={async () => {
                  await setSyncDateField(option.value);
                  setShowSyncDateFieldModal(false);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.modalOptionText, { color: colors.text }]}>
                  {option.label}
                </Text>
                {syncDateField === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => setShowSyncDateFieldModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Common app features (placeholders) */}
      {sectionTitle('App')}
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Notifications', 'Notification settings coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Notifications</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('About', 'GasTech Delivery v1.0')}
        activeOpacity={0.8}
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>About</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Help', 'Help & support coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Help & Support</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Privacy', 'Privacy policy coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Privacy</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl + 60 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '700' },
  profileEmail: { fontSize: 13, marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: '500', flex: 1 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  menuRowText: { fontSize: 16, fontWeight: '500', flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncPeriodValue: { fontSize: 14, fontWeight: '500', marginRight: 8 },
  bottomSpacer: { height: 40 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: borderRadius.lg,
    minWidth: 280,
    maxWidth: '80%',
    paddingVertical: spacing.lg,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 0,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  modalOptionText: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  modalCloseBtn: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});


import React, { useState, useEffect, useCallback } from 'react';
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
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { getUserSession } from '../services/sync.service';
import { odooImageToUri } from '../services/employee.service';
import { spacing, borderRadius } from '../constants/theme';
import * as saleOrderLinesDb from '../database/saleOrderLines.js';

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
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [showSyncPeriodModal, setShowSyncPeriodModal] = useState(false);
  const [showSyncDateFieldModal, setShowSyncDateFieldModal] = useState(false);
  const [showSyncIntervalModal, setShowSyncIntervalModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showLocalDbModal, setShowLocalDbModal] = useState(false);
  const [localDbLoading, setLocalDbLoading] = useState(false);
  const [localDbError, setLocalDbError] = useState('');
  const [localDbOrderId, setLocalDbOrderId] = useState('');
  const [localDbSnapshot, setLocalDbSnapshot] = useState([]);

  useEffect(() => {
    getUserSession().then(setUser);
  }, []);

  const loadLocalDbSnapshot = useCallback(async (override = {}) => {
    const orderIdRaw = override.orderId != null ? override.orderId : localDbOrderId;
    const orderIdNum = Number(orderIdRaw);
    const orderId = Number.isFinite(orderIdNum) && orderIdNum > 0 ? orderIdNum : null;
    setLocalDbLoading(true);
    setLocalDbError('');
    try {
      const data = await saleOrderLinesDb.getOrderLineQtySnapshot({
        orderId,
        limitOrders: 20,
      });
      setLocalDbSnapshot(Array.isArray(data) ? data : []);
    } catch (err) {
      setLocalDbSnapshot([]);
      setLocalDbError(err?.message || t('settings.localDbError', 'Failed to load local database.'));
    } finally {
      setLocalDbLoading(false);
    }
  }, [localDbOrderId, t]);

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

  const syncPeriodLabel = syncPeriod === '7days'
    ? t('settings.syncPeriodOptions.last7Days', 'Last 7 days')
    : syncPeriod === '30days'
      ? t('settings.syncPeriodOptions.last30Days', 'Last 30 days')
      : syncPeriod === '90days'
        ? t('settings.syncPeriodOptions.last90Days', 'Last 90 days')
        : syncPeriod === '1year'
          ? t('settings.syncPeriodOptions.last1Year', 'Last year')
          : t('settings.syncPeriodOptions.allTime', 'All time');

  const syncIntervalLabel = syncInterval === '5min'
    ? t('settings.syncTimeOptions.fiveMinutes', '5 minutes')
    : syncInterval === '10min'
      ? t('settings.syncTimeOptions.tenMinutes', '10 minutes')
      : syncInterval === '30min'
        ? t('settings.syncTimeOptions.thirtyMinutes', '30 minutes')
        : syncInterval === '1hour'
          ? t('settings.syncTimeOptions.oneHour', '1 hour')
          : syncInterval === '2hour'
            ? t('settings.syncTimeOptions.twoHours', '2 hours')
            : t('settings.syncTimeOptions.oneMinute', '1 minute');

  const syncDateFieldLabel = syncDateField === 'delivery_date'
    ? t('settings.syncDateOptions.deliveryDate', 'Delivery date')
    : t('settings.syncDateOptions.creationDate', 'Creation date');

  const languageLabel = appLanguage === 'ta'
    ? t('settings.languageNames.tamil', 'Tamil')
    : appLanguage === 'si'
      ? t('settings.languageNames.sinhala', 'Sinhala')
      : t('settings.languageNames.english', 'English');

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
      {sectionTitle(t('settings.appearance'))}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons
            name={theme === 'dark' ? 'moon' : 'sunny-outline'}
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.darkMode')}</Text>
        </View>
        <Switch
          value={theme === 'dark'}
          onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={theme === 'dark' ? colors.primary : colors.surface}
        />
      </View>

      {sectionTitle(t('settings.language'))}
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowLanguageModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="language-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.appLanguage')}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>
            {languageLabel}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>

      {/* Dashboard cards */}
      {sectionTitle(t('dashboard.title'))}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons name="cart-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('dashboard.showCreateSalesOrder')}</Text>
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
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('dashboard.showReturnOrder')}</Text>
        </View>
        <Switch
          value={showReturnOrder}
          onValueChange={setShowReturnOrder}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={showReturnOrder ? colors.primary : colors.surface}
        />
      </View>

      {/* Sync Settings */}
      {sectionTitle(t('settings.sync'))}
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowSyncPeriodModal(true)}
        activeOpacity={0.8}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="cloud-download-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.syncPeriod')}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>{syncPeriodLabel}</Text>
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
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.syncTime')}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>{syncIntervalLabel}</Text>
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
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.syncDateField')}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.syncPeriodValue, { color: colors.textSecondary }]}>{syncDateFieldLabel}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.syncPeriod')}</Text>
            {[
              { label: t('settings.syncPeriodOptions.last7Days', 'Last 7 days'), value: '7days' },
              { label: t('settings.syncPeriodOptions.last30Days', 'Last 30 days'), value: '30days' },
              { label: t('settings.syncPeriodOptions.last90Days', 'Last 90 days'), value: '90days' },
              { label: t('settings.syncPeriodOptions.last1Year', 'Last 1 year'), value: '1year' },
              { label: t('settings.syncPeriodOptions.allTime', 'All time'), value: 'all' },
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
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>{t('settings.close')}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.syncTime')}</Text>
            {[
              { label: t('settings.syncTimeOptions.oneMinute', '1 minute'), value: '1min' },
              { label: t('settings.syncTimeOptions.fiveMinutes', '5 minutes'), value: '5min' },
              { label: t('settings.syncTimeOptions.tenMinutes', '10 minutes'), value: '10min' },
              { label: t('settings.syncTimeOptions.thirtyMinutes', '30 minutes'), value: '30min' },
              { label: t('settings.syncTimeOptions.oneHour', '1 hour'), value: '1hour' },
              { label: t('settings.syncTimeOptions.twoHours', '2 hours'), value: '2hour' },
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
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>{t('settings.close')}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.appLanguage')}</Text>
            {[
              { label: t('settings.languageNames.english', 'English'), value: 'en' },
              { label: t('settings.languageNames.tamil', 'Tamil'), value: 'ta' },
              { label: t('settings.languageNames.sinhala', 'Sinhala'), value: 'si' },
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
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>{t('settings.close')}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.syncDateField')}</Text>
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
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>{t('settings.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Common app features (placeholders) */}
      {sectionTitle(t('settings.app'))}
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert(t('settings.notifications', 'Notifications'), t('settings.notAvailableYet', 'Not available yet.'))}
        activeOpacity={0.8}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>{t('settings.notifications')}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert(t('settings.about', 'About'), t('settings.aboutMessage', 'GasTech Delivery v1.0'))}
        activeOpacity={0.8}
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>{t('settings.about')}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert(t('settings.help', 'Help & Support'), t('settings.helpMessage', 'Support options are not available yet.'))}
        activeOpacity={0.8}
      >
        <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>{t('settings.help')}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert(t('settings.privacy', 'Privacy'), t('settings.privacyMessage', 'Privacy policy is not available yet.'))}
        activeOpacity={0.8}
      >
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>{t('settings.privacy')}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {sectionTitle(t('settings.localDb', 'Local DB'))}
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => {
          setShowLocalDbModal(true);
          loadLocalDbSnapshot();
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="server-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>
          {t('settings.localDbOrderLines', 'Order line quantities')}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={showLocalDbModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLocalDbModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={styles.localDbTitleRow}>
              <Text style={[styles.modalTitle, styles.localDbTitleText, { color: colors.text }]}>
                {t('settings.localDbOrderLinesTitle', 'Local DB - Order line quantities')}
              </Text>
              <TouchableOpacity
                style={styles.localDbIconBtn}
                onPress={() => loadLocalDbSnapshot()}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.localDbFilterRow}>
              <TextInput
                value={localDbOrderId}
                onChangeText={setLocalDbOrderId}
                placeholder={t('settings.localDbOrderIdPlaceholder', 'Order ID (optional)')}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[
                  styles.localDbInput,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
                ]}
              />
            </View>
            {localDbError ? (
              <Text style={[styles.localDbErrorText, { color: colors.error || '#c00' }]}>{localDbError}</Text>
            ) : null}
            {localDbLoading ? (
              <View style={styles.localDbLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <ScrollView
                style={styles.localDbList}
                contentContainerStyle={{ paddingBottom: spacing.md, paddingHorizontal: spacing.md }}
              >
                {localDbSnapshot.length === 0 ? (
                  <Text style={[styles.localDbEmptyText, { color: colors.textSecondary }]}>
                    {t('settings.localDbEmpty', 'No local order lines found.')}
                  </Text>
                ) : (
                  localDbSnapshot.map((order) => (
                    <View
                      key={`order-${order.orderId}`}
                      style={[styles.localDbOrderCard, { borderColor: colors.border }]}
                    >
                      <View style={styles.localDbOrderHeader}>
                        <Text style={[styles.localDbOrderTitle, { color: colors.text }]} numberOfLines={1}>
                          {t('settings.localDbOrderLabel', 'Order')} #{order.orderId}
                          {order.orderName ? ` · ${order.orderName}` : ''}
                        </Text>
                        <Text style={[styles.localDbOrderBadge, { color: colors.primary }]}>
                          {order.lines.length} {t('settings.localDbLines', 'lines')}
                        </Text>
                      </View>
                      {order.partnerName ? (
                        <Text style={[styles.localDbOrderSub, { color: colors.textSecondary }]}>
                          {order.partnerName}
                        </Text>
                      ) : null}
                      {order.lines.map((line) => (
                        <View key={`line-${order.orderId}-${line.lineId}`} style={styles.localDbLineRow}>
                          <View style={styles.localDbLineLeft}>
                            <Text style={[styles.localDbLineName, { color: colors.text }]} numberOfLines={1}>
                              {line.productName || line.lineName || t('settings.localDbLine', 'Line')}
                            </Text>
                            {line.lineName ? (
                              <Text style={[styles.localDbLineSub, { color: colors.textSecondary }]} numberOfLines={1}>
                                {line.lineName}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.localDbLineRight}>
                            <View style={[styles.localDbQtyPill, { backgroundColor: colors.primaryLight }]}>
                              <Text style={[styles.localDbQtyText, { color: colors.primary }]}>Qty {line.qty}</Text>
                            </View>
                            {line.qtyDelivered ? (
                              <Text style={[styles.localDbLineDelivered, { color: colors.textSecondary }]}>
                                {t('settings.localDbQtyDelivered', 'Delivered')} {line.qtyDelivered}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => setShowLocalDbModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCloseBtnText, { color: colors.primary }]}>{t('settings.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  localDbFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  localDbTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  localDbTitleText: {
    flex: 1,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  localDbIconBtn: {
    padding: 6,
    borderRadius: 999,
  },
  localDbInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 14,
  },
  localDbLoading: { paddingVertical: spacing.md },
  localDbErrorText: { marginTop: spacing.sm, fontSize: 13, fontWeight: '600' },
  localDbList: { marginTop: spacing.sm },
  localDbEmptyText: { fontSize: 14, textAlign: 'center', marginTop: spacing.md },
  localDbOrderCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  localDbOrderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  localDbOrderTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  localDbOrderBadge: { fontSize: 12, fontWeight: '700' },
  localDbOrderSub: { fontSize: 12, marginTop: 2 },
  localDbLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  localDbLineLeft: { flex: 1 },
  localDbLineRight: { alignItems: 'flex-end' },
  localDbLineName: { fontSize: 13, fontWeight: '600' },
  localDbLineSub: { fontSize: 11, marginTop: 2 },
  localDbQtyPill: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
  },
  localDbQtyText: { fontSize: 12, fontWeight: '700' },
  localDbLineDelivered: { fontSize: 11, marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: borderRadius.lg,
    minWidth: 280,
    width: '96%',
    maxWidth: '96%',
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


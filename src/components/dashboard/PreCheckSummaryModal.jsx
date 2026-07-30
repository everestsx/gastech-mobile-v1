import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { createCheckSheetStyles } from './checkSheetStyles';

export default function PreCheckSummaryModal({
  visible,
  vehicleName,
  routeName,
  todayDateStr,
  syncInProgress,
  activeOrdersToday,
  hasShortfall,
  stockRows,
  emptyRows,
  totalEmptyCollected,
  totalOnHand,
  totalOrdered,
  formatQty,
  onConfirm,
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createCheckSheetStyles(colors), [colors]);

  const sheetLayout = useMemo(() => {
    const screenH = Dimensions.get('window').height;
    const sheetMax = Math.round(screenH * 0.88);
    const footerH = 76 + Math.max(insets.bottom, 12);
    const scrollH = Math.max(220, sheetMax - footerH);
    return { sheetMax, scrollH };
  }, [insets.bottom]);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.postCheckBackdrop}>
        <View style={[styles.postCheckSheet, styles.preCheckSummarySheet, { maxHeight: sheetLayout.sheetMax }]}>
          <ScrollView
            style={{ height: sheetLayout.scrollH }}
            contentContainerStyle={styles.preCheckSummaryScrollContent}
            showsVerticalScrollIndicator
            persistentScrollbar={Platform.OS === 'android'}
            bounces
            overScrollMode="always"
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
          >
            <View style={styles.postCheckHandle} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: 'rgba(245, 158, 11, 0.18)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="shield-checkmark" size={22} color={colors.warning ?? '#f59e0b'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.postCheckTitle}>
                  {t('dashboard.preCheckTitle', 'Pre Check — Stock Summary')}
                </Text>
                <Text style={styles.postCheckSubtitle} numberOfLines={2}>
                  {vehicleName}
                  {routeName && routeName !== '—' ? ` · ${routeName}` : ''}
                </Text>
              </View>
            </View>

            <Text style={[styles.postCheckSubtitle, { marginBottom: 4 }]}>{todayDateStr}</Text>

            {syncInProgress ? (
              <View style={styles.preCheckSyncBanner}>
                <ActivityIndicator size="small" color={colors.primary ?? '#6366f1'} />
                <Text style={styles.preCheckSyncBannerText}>
                  {t(
                    'dashboard.preCheckSyncInProgress',
                    'Data is still syncing in the background. You can check stock and start work — numbers may update shortly.'
                  )}
                </Text>
              </View>
            ) : null}

            <View style={styles.postCheckDivider} />

            <Text style={styles.postCheckSectionLabel}>{t('dashboard.todaysOrders', "Today's orders")}</Text>
            <View style={styles.postCheckRow}>
              <Text style={styles.postCheckRowLabel}>
                {t('dashboard.totalOrdersToday', 'Total orders today')}
              </Text>
              <Text style={styles.postCheckRowValue}>{activeOrdersToday}</Text>
            </View>

            <View style={styles.postCheckDivider} />

            <Text style={styles.postCheckSectionLabel}>
              {t('dashboard.stockVsOrders', "Stock vs today's orders")}
            </Text>

            {hasShortfall ? (
              <View style={styles.preCheckShortfallBanner}>
                <Ionicons name="warning-outline" size={20} color={colors.warning ?? '#f59e0b'} />
                <Text style={styles.preCheckShortfallBannerText}>
                  {t(
                    'dashboard.preCheckShortfall',
                    'Not enough stock for some products. Please contact the operations team before starting delivery.'
                  )}
                </Text>
              </View>
            ) : null}

            {stockRows.length > 0 ? (
              stockRows.map((row) => {
                const ordered = Number(row.totalOrdered) || 0;
                const onHandColor = row.insufficient
                  ? '#dc2626'
                  : row.onHand <= 2
                    ? (colors.warning ?? '#f59e0b')
                    : colors.primary;
                return (
                  <View
                    key={row.key}
                    style={[
                      styles.preCheckStockCard,
                      row.insufficient && {
                        borderColor: (colors.warning ?? '#f59e0b') + '88',
                        backgroundColor: colors.warning + '10',
                      },
                    ]}
                  >
                    <Text style={styles.preCheckStockCardTitle}>{row.label}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 }}>
                      <Text style={styles.preCheckStockCardMeta}>
                        {t('dashboard.onHandShort', 'On hand')}:{' '}
                        <Text style={{ fontWeight: '800', color: onHandColor }}>{formatQty(row.onHand)}</Text>
                      </Text>
                      <Text style={styles.preCheckStockCardMeta}>
                        {t('dashboard.orderedToday', 'Orders need')}:{' '}
                        <Text style={{ fontWeight: '800', color: colors.text }}>{formatQty(ordered)}</Text>
                      </Text>
                    </View>
                    {row.insufficient ? (
                      <Text style={styles.preCheckStockStatusShort}>
                        {t('dashboard.shortBy', 'Short by')} {formatQty(row.shortfall)} —{' '}
                        {t('dashboard.contactOps', 'contact operations team')}
                      </Text>
                    ) : ordered > 0 ? (
                      <Text style={styles.preCheckStockStatusOk}>{t('dashboard.stockOk', 'Enough stock')}</Text>
                    ) : null}
                  </View>
                );
              })
            ) : (
              <View style={styles.postCheckRow}>
                <Text style={[styles.postCheckRowLabel, { color: colors.textSecondary }]}>
                  {t('dashboard.noStockData', 'No stock loaded yet — sync or pull to refresh.')}
                </Text>
              </View>
            )}

            {emptyRows.length > 0 ? (
              <>
                <Text style={[styles.postCheckSectionLabel, { marginTop: 14 }]}>
                  {t('dashboard.emptyCylindersOnLorry', 'Empty collected on lorry')}
                </Text>
                {emptyRows.map((row) => (
                  <View key={`empty-${row.kg}`} style={styles.postCheckRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor: 'rgba(15, 118, 110, 0.12)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="ellipse-outline" size={16} color="#0f766e" />
                      </View>
                      <Text style={styles.postCheckRowLabel}>
                        {t('dashboard.emptyKgLabel', '{{kg}} kg empty', { kg: row.kg })}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.postCheckRowValue,
                        { color: row.qty > 0 ? '#0f766e' : colors.textSecondary },
                      ]}
                    >
                      {row.qty.toLocaleString('en-IN')}
                    </Text>
                  </View>
                ))}
                <View
                  style={[
                    styles.postCheckTotalRow,
                    { marginTop: 0, backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={styles.postCheckTotalLabel}>
                    {t('dashboard.totalEmptyCollected', 'Total empty collected')}
                  </Text>
                  <Text style={[styles.postCheckTotalValue, { color: '#0f766e' }]}>
                    {totalEmptyCollected.toLocaleString('en-IN')}
                  </Text>
                </View>
              </>
            ) : null}

            <View style={styles.postCheckTotalRow}>
              <Text style={styles.postCheckTotalLabel}>{t('dashboard.totalOnHand', 'Total on hand')}</Text>
              <Text style={styles.postCheckTotalValue}>{totalOnHand.toLocaleString('en-IN')}</Text>
            </View>
            {totalOrdered > 0 ? (
              <View
                style={[
                  styles.postCheckTotalRow,
                  { marginTop: 0, backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={styles.postCheckTotalLabel}>
                  {t('dashboard.totalOrderedToday', 'Total ordered today')}
                </Text>
                <Text style={[styles.postCheckTotalValue, { color: colors.warning ?? '#f59e0b' }]}>
                  {formatQty(totalOrdered)}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity style={styles.postCheckSubmitBtn} activeOpacity={0.88} onPress={onConfirm}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.postCheckSubmitBtnText}>
                {t('dashboard.preCheckOk', 'OK Start delivery')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

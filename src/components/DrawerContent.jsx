import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../constants/theme';
import { runSync, getLastSyncTime, getUserSession, logout, getSyncIntervalMinutes } from '../services/sync.service';
import RichNotification from './RichNotification';

export default function DrawerContent({ navigation }) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [user, setUser] = useState(null);
  const [notification, setNotification] = useState({ visible: false, title: '', message: '', type: 'info' });

  const refreshLastSync = async () => {
    const t = await getLastSyncTime();
    setLastSync(t ? new Date(t) : null);
  };

  useEffect(() => {
    (async () => {
      setUser(await getUserSession());
      await refreshLastSync();
    })();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      getUserSession().then(setUser);
    }, [])
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await runSync();
      await refreshLastSync();
      if (result.error) {
        setNotification({
          visible: true,
          title: t('drawer.syncFailed', 'Sync failed'),
          message: result.error,
          type: 'error',
        });
      } else {
        setNotification({
          visible: true,
          title: t('drawer.syncDone', 'Sync done'),
          message: t('drawer.syncDoneMessage', '{{customers}} customers · {{orders}} orders', {
            customers: result.customers,
            orders: result.orders,
          }),
          type: 'success',
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('menu.logOut', 'Log out'), t('drawer.areYouSure', 'Are you sure?'), [
      { text: t('drawer.cancel', 'Cancel'), style: 'cancel' },
      {
        text: t('menu.logOut', 'Log out'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          const root = navigation.getParent?.();
          if (root?.reset) root.reset({ index: 0, routes: [{ name: 'Login' }] });
          else navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  const intervalMin = getSyncIntervalMinutes();

  return (
    <View style={styles.container}>
      <RichNotification
        visible={notification.visible}
        title={notification.title}
        message={notification.message}
        type={notification.type}
        onHide={() => setNotification((prev) => ({ ...prev, visible: false }))}
      />
      <View style={styles.header}>
        <Text style={styles.title}>{t('drawer.title', 'Gas Cylinder Delivery')}</Text>
        {user?.driverName ? (
          <Text style={styles.user} numberOfLines={1}>
            {t('drawer.driver', 'Driver')}: {user.driverName}
          </Text>
        ) : null}
        {user?.username ? (
          <Text style={styles.user}>@{user.username}</Text>
        ) : null}
        {!user?.driverName && !user?.username && user?.licensePlate ? (
          <Text style={styles.user} numberOfLines={1}>
            {user.licensePlate}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.syncBtn}
        onPress={handleSync}
        disabled={syncing}
        activeOpacity={0.8}
      >
        {syncing ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name="sync-outline" size={24} color="#fff" />
        )}
        <Text style={styles.syncText}>
          {syncing ? t('drawer.syncing', 'Syncing...') : t('drawer.syncData', 'Sync data')}
        </Text>
      </TouchableOpacity>

      <Text style={styles.lastSync}>
        {lastSync
          ? t('drawer.lastSync', 'Last sync: {{date}}', { date: lastSync.toLocaleString() })
          : t('drawer.notSyncedYet', 'Not synced yet')}
      </Text>
      <Text style={styles.hint}>
        {t('drawer.autoSyncHint', 'Auto-sync runs every {{interval}} minutes when app is open.', { interval: intervalMin })}
      </Text>

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.error} />
        <Text style={styles.logoutText}>{t('menu.logOut', 'Log out')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  header: { marginBottom: spacing.lg },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  user: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  syncText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  lastSync: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xl },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: colors.error },
});

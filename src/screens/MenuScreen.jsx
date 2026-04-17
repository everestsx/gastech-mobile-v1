import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  runSync,
  getLastSyncTime,
  getUserSession,
  logout,
  getSyncIntervalMinutes,
  deleteLocalData, clearAllTables,setIsLoggingOut
} from '../services/sync.service';
import CustomAlert from '../components/CustomAlert';
import { usePrinterConnection } from '../context/PrinterConnectionContext';
import { useFocusEffect } from '@react-navigation/native';
import { odooImageToUri } from '../services/employee.service';

export default function MenuScreen({ navigation }) {
  const { colors } = useTheme();
  const { clearPrinter } = usePrinterConnection();
  const [syncing, setSyncing] = useState(false);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [user, setUser] = useState(null);
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    buttons: []
  });
  const showAlert = (title, message, buttons = []) => {
    setAlertConfig({ visible: true, title, message, buttons });
  };

  const hideAlert = () => {
    setAlertConfig(prev => ({ ...prev, visible: false }));
  };
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
      // if (result.error) {
      //   showAlert('Sync failed', result.error);
      // } else {
      //   showAlert(
      //     'Sync complete',
      //     `Customers: ${result.customers}, Orders: ${result.orders}`
      //   );
      // }
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteLocalData = () => {
    showAlert(
      'Delete local data',
      'Removes customers, orders, and other synced data on this phone. You stay logged in. Sync again to reload from GasTech. Continue?',
      [
        { text: 'Cancel', style: 'cancel', onPress : hideAlert },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            hideAlert();
            try {
              await deleteLocalData();
              await refreshLastSync();
              showAlert('Done', 'Deleted. Tap Sync to download data again.');
            } catch (e) {
              if (e?.code === 'PENDING_SYNC') {
                const q = e.pendingQueueCount ?? 0;
                const a = e.pendingAttachmentCount ?? 0;
                showAlert(
                  'Not everything is synced',
                  `${q} item(s) in queue, ${a} photo(s) not sent yet. Sync first, or delete anyway and lose those items on the server.`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: hideAlert },
                    {
                      text: 'Discard & delete',
                      style: 'destructive',
                      onPress: async () => {
                        hideAlert();
                        try {
                          await deleteLocalData({ discardUnsynced: true });
                          await refreshLastSync();
                          showAlert('Done', 'Deleted (unsynced items were dropped). Tap Sync to reload.');
                        } catch (e2) {
                          showAlert('Error', e2?.message || 'Failed to delete local data.');
                        }
                      },
                    },
                  ]
                );
              } else {
                showAlert('Error', e?.message || 'Failed to delete local data.');
              }
            }
          },
        },
      ]
    );
  };

  const fetchAndPromptApplyUpdate = async () => {
    setCheckingAppUpdate(true);
    try {
      await Updates.fetchUpdateAsync();
      showAlert('Update ready', 'The latest update has been downloaded. Restart the app now?', [
        { text: 'Later', style: 'cancel', onPress: hideAlert },
        {
          text: 'Restart now',
          onPress: async () => {
            hideAlert();
            try {
              await Updates.reloadAsync();
            } catch (e) {
              showAlert('Restart failed', e?.message || 'Please close and reopen the app.');
            }
          },
        },
      ]);
    } catch (e) {
      showAlert('Update failed', e?.message || 'Could not download update. Try again.');
    } finally {
      setCheckingAppUpdate(false);
    }
  };

  const handleCheckAppUpdate = async () => {
    if (checkingAppUpdate) return;
    if (!Updates.isEnabled) {
      showAlert(
        'Updates unavailable',
        'This app build does not support OTA updates. Install an EAS-built update-enabled APK first.'
      );
      return;
    }
    setCheckingAppUpdate(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result?.isAvailable) {
        showAlert('Up to date', 'You are already on the latest app update.');
        return;
      }
      showAlert('Update available', 'A newer app update is available. Download now?', [
        { text: 'Later', style: 'cancel', onPress: hideAlert },
        {
          text: 'Update now',
          onPress: () => {
            hideAlert();
            void fetchAndPromptApplyUpdate();
          },
        },
      ]);
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (/development mode|dev mode|expo go/i.test(msg)) {
        showAlert('Updates unavailable', 'OTA updates work only in installed release/internal builds, not Expo Go/dev mode.');
      } else {
        showAlert('Update check failed', e?.message || 'Could not check for updates.');
      }
    } finally {
      setCheckingAppUpdate(false);
    }
  };

  const handleLogout = () => {
    showAlert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel', onPress: hideAlert },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsLoggingOut(true);
            await clearPrinter().catch(() => {});
            await logout();
            hideAlert();
            clearAllTables().then(() => {
              console.log('Database cleanup finished in background');
            });

            const root = navigation.getParent();
            if (root) {
              root.reset({ index: 0, routes: [{ name: 'Login' }] });
            } else {
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            }

          } catch (error) {
            console.error('Logout UI error:', error);
            await logout();
            navigation.navigate('Login');
          }
        },
      },
    ]);
  };

  const intervalMin = getSyncIntervalMinutes();

  const plateOrVehicle = user?.isAdmin ? '' : user?.licensePlate || user?.vehicleName || 'Vehicle';
  const profileTitle = user?.isAdmin ? 'Admin' : user?.driverName || plateOrVehicle;
  const profileSubtitle = user?.isAdmin
    ? 'Tap to open Settings'
    : user?.driverName
      ? `${plateOrVehicle} · Tap for settings`
      : 'Tap to open Settings';
  const profileAvatarUri = !user?.isAdmin && user?.driverImageBase64 ? odooImageToUri(user.driverImageBase64) : null;
  const profileInitial = (profileTitle || 'V').trim().charAt(0).toUpperCase();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile section - tap to open Settings */}
      <TouchableOpacity
        style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('Settings')}
        activeOpacity={0.8}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary, overflow: 'hidden' }]}>
          {profileAvatarUri ? (
            <Image source={{ uri: profileAvatarUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <Text style={styles.avatarText}>{profileInitial}</Text>
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {profileTitle}
          </Text>
          <Text style={[styles.profileHint, { color: colors.textSecondary }]} numberOfLines={2}>
            {profileSubtitle}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.syncBtn, { backgroundColor: colors.primary }]}
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
          {syncing ? 'Syncing...' : 'Sync'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('Customers')}
        activeOpacity={0.8}
      >
        <Ionicons name="people-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>My Customers</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('MyStocks')}
        activeOpacity={0.8}
      >
        <Ionicons name="cube-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>My Stocks</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('BluetoothPrinter')}
        activeOpacity={0.8}
      >
        <Ionicons name="bluetooth-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Bluetooth printer</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('MyCommissions')}
        activeOpacity={0.8}
      >
        <Ionicons name="cash-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>My Commissions</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity> */}

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('LocalInvoices')}
        activeOpacity={0.8}
      >
        <Ionicons name="document-text-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>My Invoices</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('SyncHistory')}
        activeOpacity={0.8}
      >
        <Ionicons name="time-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Sync History</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleCheckAppUpdate}
        activeOpacity={0.8}
        disabled={checkingAppUpdate}
      >
        {checkingAppUpdate ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="cloud-download-outline" size={24} color={colors.primary} />
        )}
        <Text style={[styles.menuItemText, { color: colors.text }]}>
          {checkingAppUpdate ? 'Checking updates...' : 'Check app update'}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleDeleteLocalData}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-outline" size={24} color={colors.error || '#dc2626'} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Delete local data</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('Settings')}
        activeOpacity={0.8}
      >
        <Ionicons name="settings-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Settings</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('QRGenerator')}
        activeOpacity={0.8}
      >
        <Ionicons name="qr-code-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Customer QR Generator</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <Text style={[styles.lastSync, { color: colors.textSecondary }]}>
        {lastSync
          ? `Last sync: ${lastSync.toLocaleString()}`
          : 'Not synced yet'}
      </Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Auto-sync runs every {intervalMin} minutes when app is open.
      </Text>

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.error} />
        <Text style={[styles.logoutText, { color: colors.error }]}>Log out</Text>
      </TouchableOpacity>
      <CustomAlert
          visible={alertConfig.visible}
          title={alertConfig.title}
          message={alertConfig.message}
          buttons={alertConfig.buttons}
          onClose={hideAlert}
      />
    </ScrollView>

  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.xl + spacing.lg },
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
  profileName: { fontSize: 18, fontWeight: '700' },
  profileHint: { fontSize: 13, marginTop: 2 },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  syncText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  lastSync: { fontSize: 12, marginBottom: 4 },
  hint: { fontSize: 11, marginBottom: spacing.md },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  menuItemText: { fontSize: 16, fontWeight: '600', flex: 1 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },
});

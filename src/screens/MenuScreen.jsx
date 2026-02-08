import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  runSync,
  getLastSyncTime,
  getUserSession,
  logout,
  getSyncIntervalMinutes,
} from '../services/sync.service';

export default function MenuScreen({ navigation }) {
  const { colors } = useTheme();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [user, setUser] = useState(null);

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

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await runSync();
      await refreshLastSync();
      if (result.error) {
        Alert.alert('Sync failed', result.error);
      } else {
        Alert.alert(
          'Sync complete',
          `Customers: ${result.customers}, Orders: ${result.orders}`
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
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
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>
            {(user?.username || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {user?.username || 'User'}
          </Text>
          <Text style={[styles.profileHint, { color: colors.textSecondary }]}>
            Tap to open Settings
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
        onPress={() => navigation.navigate('DailyVisit')}
        activeOpacity={0.8}
      >
        <Ionicons name="calendar-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>Daily Visit</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
        onPress={() => navigation.navigate('MyCommissions')}
        activeOpacity={0.8}
      >
        <Ionicons name="cash-outline" size={24} color={colors.primary} />
        <Text style={[styles.menuItemText, { color: colors.text }]}>My Commissions</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.xl },
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

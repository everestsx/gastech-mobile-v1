import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../constants/theme';
import { runSync, getLastSyncTime, getUserSession, logout, getSyncIntervalMinutes } from '../services/sync.service';

export default function DrawerContent({ navigation }) {
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Gas Cylinder Delivery</Text>
        {user?.driverName ? (
          <Text style={styles.user} numberOfLines={1}>
            Driver: {user.driverName}
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
          {syncing ? 'Syncing...' : 'Sync data'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.lastSync}>
        {lastSync
          ? `Last sync: ${lastSync.toLocaleString()}`
          : 'Not synced yet'}
      </Text>
      <Text style={styles.hint}>
        Auto-sync runs every {intervalMin} minutes when app is open.
      </Text>

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.error} />
        <Text style={styles.logoutText}>Log out</Text>
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

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedVehicles, runSync, saveUserSession } from '../services/sync.service';

const ADMIN_OPTION = { id: 'admin', name: 'Admin', license_plate: null, isAdmin: true };

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(ADMIN_OPTION);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadVehicles = useCallback(async () => {
    try {
      const list = await getCachedVehicles();
      setVehicles(Array.isArray(list) ? list : []);
    } catch {
      setVehicles([]);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      await runSync();
      await loadVehicles();
    } catch (e) {
      Alert.alert('Sync failed', e?.message || 'Could not sync.');
    } finally {
      setSyncing(false);
    }
  }, [loadVehicles]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await onSync();
    setRefreshing(false);
  }, [onSync]);

  const options = useMemo(() => [ADMIN_OPTION, ...vehicles.map((v) => ({ ...v, isAdmin: false }))], [vehicles]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.surface },
        content: {
          flex: 1,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xl,
          alignItems: 'center',
        },
        title: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: spacing.xl },
        subtitle: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
        label: { fontSize: 14, fontWeight: '600', color: colors.text, alignSelf: 'stretch', marginBottom: spacing.sm, marginTop: spacing.sm },
        dropdown: {
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 14,
          paddingHorizontal: 16,
          marginBottom: spacing.md,
        },
        dropdownText: { fontSize: 16, color: colors.text, flex: 1 },
        loginBtn: {
          alignSelf: 'stretch',
          backgroundColor: colors.primary,
          paddingVertical: 16,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          marginTop: spacing.xl,
        },
        loginBtnDisabled: { opacity: 0.7 },
        loginBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
        syncBtn: {
          alignSelf: 'stretch',
          paddingVertical: 12,
          marginTop: spacing.md,
          alignItems: 'center',
        },
        syncBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
        modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
        modalBox: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, maxHeight: 400 },
        optionRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        optionText: { fontSize: 16, color: colors.text, flex: 1 },
        emptyText: { fontSize: 14, color: colors.textSecondary, alignSelf: 'stretch', textAlign: 'center', marginTop: spacing.sm },
      }),
    [colors]
  );

  const handleLogin = async () => {
    setLoading(true);
    try {
      if (selected.isAdmin) {
        await saveUserSession({ isAdmin: true });
      } else {
        await saveUserSession({
          isAdmin: false,
          vehicleId: selected.id,
          vehicleName: selected.name,
          licensePlate: selected.license_plate || (selected.name || '').split('/').pop() || '',
        });
      }
      navigation.replace('Main');
    } catch (err) {
      Alert.alert('Login failed', err?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const displayLabel = selected.isAdmin ? 'Admin' : (selected.license_plate || selected.name || 'Vehicle');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppLogo size={140} showLabel={true} />

        <Text style={styles.title}>Log In</Text>
        <Text style={styles.subtitle}>Select vehicle or Admin to continue</Text>

        <Text style={styles.label}>Select user</Text>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setDropdownVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.dropdownText} numberOfLines={1}>
            {displayLabel}
          </Text>
          <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
        </TouchableOpacity>

        {vehicles.length === 0 && !syncing && (
          <Text style={styles.emptyText}>No vehicles in cache. Tap "Sync vehicles" below to load.</Text>
        )}

        <TouchableOpacity
          style={[styles.loginBtn, (loading || syncing) && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading || syncing}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>Log In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.syncBtn} onPress={onSync} disabled={syncing}>
          <Text style={styles.syncBtnText}>
            {syncing ? 'Syncing…' : 'Sync vehicles'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={dropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBack}
          activeOpacity={1}
          onPress={() => setDropdownVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalBox}>
              <FlatList
                data={options}
                keyExtractor={(item) => (item.isAdmin ? 'admin' : String(item.id))}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      setSelected(item);
                      setDropdownVisible(false);
                    }}
                  >
                    <Text style={styles.optionText} numberOfLines={1}>
                      {item.isAdmin ? 'Admin' : (item.license_plate || item.name || `Vehicle ${item.id}`)}
                    </Text>
                    {selected.id === item.id && !item.isAdmin ? (
                      <Ionicons name="checkmark" size={22} color={colors.primary} />
                    ) : selected.isAdmin && item.isAdmin ? (
                      <Ionicons name="checkmark" size={22} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.optionRow}>
                    <Text style={styles.emptyText}>No vehicles. Sync first.</Text>
                  </View>
                }
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

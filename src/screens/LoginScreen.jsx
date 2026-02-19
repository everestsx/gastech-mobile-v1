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
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedVehicles, runSync, saveUserSession, getUserSession } from '../services/sync.service';
import { getDb } from '../database/db';

// const ADMIN_OPTION = { id: 'admin', name: 'Admin', license_plate: null, isAdmin: true };

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadVehicles = useCallback(async () => {
    try {
      const list = await getCachedVehicles();
      console.log("Vehicles loaded from DB:", list.length); // Debug log
      setVehicles(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("loadVehicles error:", e);
      setVehicles([]);
    }
  }, []);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
  // const handleLogin = async () => {
  //   setLoading(true);
  //   try {
  //     if (selected.isAdmin) {
  //       await saveUserSession({ isAdmin: true });
  //     } else {
  //       await saveUserSession({
  //         isAdmin: false,
  //         vehicleId: selected.id,
  //         vehicleName: selected.name,
  //         licensePlate: selected.license_plate || (selected.name || '').split('/').pop() || '',
  //       });
  //     }
  //     // Verify session was persisted so Dashboard reads correct user on first load
  //     const saved = await getUserSession();
  //     if (!saved) {
  //       throw new Error('Session could not be saved. Please try again.');
  //     }
  //     // Ensure DB is ready before Main so Dashboard amounts load immediately
  //     try {
  //       await getDb();
  //     } catch (_) {
  //       // Continue; DB may already be open from Splash
  //     }
  //     navigation.replace('Main');
  //   } catch (err) {
  //     Alert.alert('Login failed', err?.message || 'Please try again.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };
  const initData = useCallback(async () => {
    await loadVehicles(); // Load cached data immediately
    setSyncing(true);
    try {
      await runSync(); // Fetch from Odoo & Save to SQLite
      await loadVehicles(); // Refresh the list with new data
    } catch (e) {
      console.log("Background sync failed", e);
    } finally {
      setSyncing(false);
    }
  }, [loadVehicles]);

  useEffect(() => {
    initData();
  }, [initData]);

  // --- 3. Login Logic (Top Level) ---
  // const handleLogin = async () => {
  //   if (!password) {
  //     Alert.alert('Required', 'Please enter your password');
  //     return;
  //   }
  //
  //   setLoading(true);
  //   try {
  //     const validPass = selected.isAdmin ? 'admin' : (selected.password || '1234');
  //     if (password !== validPass) throw new Error('Invalid password.');
  //
  //     if (selected.isAdmin) {
  //       await saveUserSession({ isAdmin: true });
  //     } else {
  //       await saveUserSession({
  //         isAdmin: false,
  //         vehicleId: selected.id,
  //         vehicleName: selected.name,
  //         licensePlate: selected.license_plate || (selected.name || '').split('/').pop() || '',
  //       });
  //     }
  //     navigation.replace('Main');
  //   } catch (err) {
  //     Alert.alert('Login failed', err.message);
  //   } finally {
  //     setLoading(false);
  //   }
  // };
  const handleLogin = async () => {
    // 1. Check if a vehicle is actually selected
    if (!selected) {
      Alert.alert('Selection Required', 'Please select a vehicle from the list.');
      return;
    }

    if (!password) {
      Alert.alert('Required', 'Please enter your password');
      return;
    }

    setLoading(true);
    try {
      // 2. Use a fallback password if the vehicle doesn't have one set in DB
      const validPass = selected?.password || '1234';
      if (password !== validPass) throw new Error('Invalid password.');

      // 3. Save the session using vehicle details
      await saveUserSession({
        vehicleId: selected.id,
        vehicleName: selected.name,
        licensePlate: selected.license_plate || (selected.name || '').split('/').pop() || '',
      });

      navigation.replace('Main');
    } catch (err) {
      Alert.alert('Login failed', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    initData();
  }, [initData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await onSync();
    setRefreshing(false);
  }, [onSync]);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface
    },
    // This is the main wrapper that handles centering
    innerContainer: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center', // Centers the card vertically
    },
    headerSection: {
      alignItems: 'center',
      marginBottom: spacing.xl,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.text,
      marginTop: spacing.md,
      textAlign: 'center'
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center'
    },
    formSection: {
      width: '100%',
      marginTop: spacing.lg,
    },
    inputLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 8,
      letterSpacing: 1,
      marginLeft: 4,
    },
    inputGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: borderRadius.lg,
      paddingHorizontal: 16,
      height: 56,
      marginBottom: spacing.lg,
    },
    loginBtn: {
      backgroundColor: colors.primary,
      height: 58,
      borderRadius: borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.md,
      // Add a small shadow for depth
      elevation: 3,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
    },
    loginBtnText: {
      fontSize: 18,
      fontWeight: '700',
      color: '#fff'
    },
    syncIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xl,
      gap: 8
    },
    // Modal styles
    modalBack: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end' // Slide up from bottom feel
    },
    modalBox: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '70%',
      paddingBottom: 40
    },
    dropdownListContainer: {
      position: 'absolute',
      // Matches the height of the inputGroup (56) to sit exactly below it
      top: 56,
      left: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      maxHeight: 200,
      zIndex: 3000,
      // Add shadow for better visibility over the password field
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 10,
    },
    optionRow: {
      padding: 15,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
    },
  }), [colors]);

  const options = useMemo(() => vehicles, [vehicles]);
  // const displayLabel = selected.isAdmin ? 'Admin' : (selected.license_plate || selected.name || 'Vehicle');
  const displayLabel = selected
      ? (selected?.license_plate || selected?.name)
      : 'Select Vehicle';
  return (

      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.innerContainer}>
            <View style={styles.headerSection}>
              <AppLogo size={150} useImage={true} />
              <Text style={styles.title}>Delivery Terminal</Text>
              <Text style={styles.subtitle}>Authorized Distributor Portal</Text>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>Vehicle ID</Text>


              <View style={{ zIndex: 2000 }}>
                <TouchableOpacity
                    style={styles.inputGroup}
                    onPress={() => setDropdownVisible(!dropdownVisible)}
                    activeOpacity={0.8}
                >
                  <Ionicons name="bus-outline" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                  <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>{displayLabel}</Text>
                  <Ionicons
                      name={dropdownVisible ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.textSecondary}
                  />
                </TouchableOpacity>


                {dropdownVisible && (
                    <View style={styles.dropdownListContainer}>
                      <FlatList
                          data={options}
                          keyExtractor={(item) => String(item.id)}
                          renderItem={({ item }) => (
                              <TouchableOpacity
                                  style={styles.optionRow}
                                  onPress={() => {
                                    setSelected(item);
                                    setDropdownVisible(false);
                                  }}
                              >
                                <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>
                                  {(item.license_plate || item.name)}
                                </Text>
                                {selected?.id === item.id && (
                                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                                )}
                              </TouchableOpacity>
                          )}
                          nestedScrollEnabled={true}
                      />
                    </View>
                )}
              </View>

              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputGroup}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.text }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Login</Text>}
              </TouchableOpacity>
            </View>

            {syncing && (
                <View style={styles.syncIndicator}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  {/*<Text style={{ fontSize: 12, color: colors.textSecondary }}>Refreshing fleet data...</Text>*/}
                </View>
            )}
          </View>
        </KeyboardAvoidingView>

      </SafeAreaView>
  );
}

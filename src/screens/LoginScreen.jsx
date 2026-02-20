import React, { useState, useMemo, useEffect, useCallback } from 'react';

import CustomAlert from '../components/CustomAlert';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,

} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {getCachedVehicles, runSync, saveUserSession, syncVehiclesOnly} from '../services/sync.service';
import { SafeAreaView } from 'react-native-safe-area-context';
import {authenticateVehicleOnline} from "@/src/services/vehicle.service";



export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
  const loadVehicles = useCallback(async () => {
    try {
      const list = await getCachedVehicles();
      console.log("Vehicles loaded from DB:", list.length);
      const vehicleList = Array.isArray(list) ? list : [];
      setVehicles(vehicleList);
      return vehicleList;
    } catch (e) {
      console.error("loadVehicles error:", e);
      setVehicles([]);
      return [];
    }
  }, []);

  const initData = useCallback(async () => {
    const localData = await loadVehicles();


    if (localData.length > 0) return;

    setSyncing(true);
    try {
      const success = await syncVehiclesOnly();
      if (success) await loadVehicles();
    } catch (e) {
      console.log("Background sync failed", e);
    } finally {

      setTimeout(() => setSyncing(false), 500);
    }
  }, [loadVehicles]);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      await runSync();
      await loadVehicles();
    } catch (e) {
      showAlert('Sync failed', e?.message || 'Could not sync.');
    } finally {
      setSyncing(false);
    }
  }, [loadVehicles]);

  useEffect(() => {
    initData();
  }, [initData]);

  const handleLogin = async () => {
    if (!selected) return showAlert('Required', 'Please select a vehicle.');
    if (!password) return showAlert('Required', 'Please enter your password');

    setLoading(true);
    try {
      const isAuthorized = await authenticateVehicleOnline(selected.id, password);

      if (!isAuthorized) {
        throw new Error('Invalid password. Please verify with Admin.');
      }

      await saveUserSession({
        vehicleId: selected.id,
        vehicleName: selected.name,
        licensePlate: selected.license_plate || '',
        loggedInAt: new Date().toISOString(),
      });

      // await runSync(); ///todo : discuss if force sync is necessary otherwise remove this line
      navigation.replace('Main');
    } catch (err) {
      showAlert('Login Failed', err.message, [
        { text: 'Try Again', onPress: hideAlert }
      ]);
    } finally {
      setLoading(false);
    }
  };


  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface
    },
    innerContainer: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
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
    dropdownListContainer: {
      position: 'absolute',
      top: 56,
      left: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      maxHeight: 200,
      zIndex: 3000,
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
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={handleLogin}
                  disabled={loading || syncing}
                  activeOpacity={0.8}
              >
                {loading || syncing ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <ActivityIndicator color="#fff" />
                    </View>
                ) : (
                    <Text style={styles.loginBtnText}>Login</Text>
                )}
              </TouchableOpacity>
            </View>


          </View>
        </KeyboardAvoidingView>

        <CustomAlert
            visible={alertConfig.visible}
            title={alertConfig.title}
            message={alertConfig.message}
            buttons={alertConfig.buttons}
            onClose={hideAlert}
        />
      </SafeAreaView>
  );
}

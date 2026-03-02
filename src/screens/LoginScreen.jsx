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
  Modal, Keyboard,
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

  useEffect(() => {
    initData();
  }, [initData]);

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (!selected) return showAlert('Required', 'Please select a vehicle.');
    if (!password) return showAlert('Required', 'Please enter your password');

    setLoading(true);
    try {
      const isAuthorized = await authenticateVehicleOnline(selected.id, password);

      if (!isAuthorized) {
        throw new Error('Invalid password. Please verify with Admin.');
      }

      await saveUserSession({
        isAdmin: false,
        vehicleId: selected.id,
        vehicleName: selected.name,
        licensePlate: selected.license_plate || '',
        loggedInAt: new Date().toISOString(),
      });

      await runSync(); //this is needed inital sync
      navigation.replace('Main');
    } catch (err) {
      showAlert('Login Failed', err.message, [
        { text: 'Try Again', onPress: hideAlert }
      ]);
    } finally {
      setLoading(false);
    }
  };


  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = React.useRef(null);


  const toggleDropdown = () => {
    Keyboard.dismiss();
    if (dropdownRef.current) {
      // measureInWindow is more accurate for absolute Modal positioning
      dropdownRef.current.measureInWindow((x, y, width, height) => {
        setDropdownPos({
          top: y + height - 2,
          left: x,
          width: width,
        });
        setDropdownVisible(true);
      });
    }
  };
  const styles = useMemo(() => StyleSheet.create({


    dropdownWrapper: {
      zIndex: 1000,
    },
    fullScreenOverlay: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    bottomFade: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 20,
      opacity: 0.4,
    },
    floatingMenu: {
      borderTopWidth: 0,
      position: 'absolute',
      maxHeight: 200,
      borderRadius: borderRadius.lg,
      borderWidth: 0,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 10,
      zIndex: 9999,
      marginTop: 0,
      paddingTop: 0,
      overflow: 'hidden'
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
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

              <View
                  style={styles.dropdownWrapper}
              >
                <Text style={styles.inputLabel}>Vehicle ID</Text>

                <TouchableOpacity
                    ref={dropdownRef}
                    style={[styles.inputGroup, dropdownVisible && { borderColor: colors.primary }]}
                    onPress={toggleDropdown}
                    activeOpacity={0.8}
                >
                  <Ionicons name="bus-outline" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                  <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>{displayLabel}</Text>
                  <Ionicons name={dropdownVisible ? "chevron-up" : "chevron-down"} size={20} color={colors.textSecondary} />
                </TouchableOpacity>

                <Modal visible={dropdownVisible} transparent animationType="fade">
                  <TouchableOpacity
                      style={[styles.fullScreenOverlay, { backgroundColor: 'transparent' }]}
                      activeOpacity={1}
                      onPress={() => setDropdownVisible(false)}
                  >
                    <View
                        style={[
                          styles.floatingMenu,
                          {
                            backgroundColor: colors.surface,
                            top: dropdownPos.top,
                            left: dropdownPos.left,
                            width: dropdownPos.width,
                          },
                        ]}
                    >
                      <FlatList
                          data={options}
                          keyExtractor={(item) => String(item.id)}
                          showsVerticalScrollIndicator={false}
                          ListEmptyComponent={
                            <View style={{ padding: 20, alignItems: 'center' }}>
                              <Text style={{ color: colors.textSecondary }}>No vehicles found.</Text>
                            </View>
                          }
                          renderItem={({ item }) => {
                            const isSelected = selected?.id === item.id;
                            return (
                                <TouchableOpacity
                                    style={[
                                      styles.optionRow,
                                      { borderBottomColor: colors.border },
                                      isSelected && { backgroundColor: colors.primary + '10' },
                                    ]}
                                    onPress={() => {
                                      setSelected(item);
                                      setDropdownVisible(false);
                                    }}
                                >
                                  <Text style={[
                                    { flex: 1, fontSize: 15, color: colors.text },
                                    isSelected && { fontWeight: '700', color: colors.primary }
                                  ]}>
                                    {item.license_plate || item.name}
                                  </Text>

                                  {isSelected && (
                                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                                  )}
                                </TouchableOpacity>
                            );
                          }}
                      />

                      <View
                          pointerEvents="none"
                          style={[styles.bottomFade, { backgroundColor: colors.surface }]}
                      />
                    </View>
                  </TouchableOpacity>
                </Modal>
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
                    returnKeyType="done"
                    onChangeText={setPassword}
                    onSubmitEditing={handleLogin}
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

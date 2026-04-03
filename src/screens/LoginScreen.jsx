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
  Modal,
  Keyboard,
  Image,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getCachedVehicles, getLastVehicleId, runSync, saveUserSession, saveLastVehicleId, syncVehiclesOnly } from '../services/sync.service';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchAndStoreVehicleJournals } from '../services/vehicle.service';
import { getDriverByBarcode, getPortersEmployees, odooImageToUri } from '../services/employee.service';



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
      const lastId = await getLastVehicleId();
      if (lastId && vehicleList.length > 0) {
        const match = vehicleList.find((v) => String(v.id) === String(lastId));
        if (match) setSelected(match);
      }
      return vehicleList;
    } catch (e) {
      console.error("loadVehicles error:", e);
      setVehicles([]);
      return [];
    }
  }, []);

  /** On login screen load: always fetch fleet.vehicle from Odoo (search_read), then refresh local list. */
  const initData = useCallback(async () => {
    await loadVehicles();
    setSyncing(true);
    try {
      const success = await syncVehiclesOnly();
      if (success) await loadVehicles();
    } catch (e) {
      console.log("Vehicle fetch failed", e);
    } finally {
      setTimeout(() => setSyncing(false), 500);
    }
  }, [loadVehicles]);
  /** Driver code / password (matched in Odoo on Driving employees; value is not shown from server). */
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /** credentials → driverReview (confirm face/name) → porterPick → Main */
  const [loginPhase, setLoginPhase] = useState('credentials');
  const [matchedDriver, setMatchedDriver] = useState(null);
  const [portersList, setPortersList] = useState([]);
  const [portersLoading, setPortersLoading] = useState(false);
  const [selectedPorterIds, setSelectedPorterIds] = useState([]);

  const resetLoginFlow = useCallback(() => {
    setLoginPhase('credentials');
    setMatchedDriver(null);
    setPortersList([]);
    setSelectedPorterIds([]);
  }, []);

  useEffect(() => {
    initData();
  }, [initData]);

  const togglePorter = useCallback((id) => {
    setSelectedPorterIds((prev) => {
      const n = Number(id);
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      return [...prev, n];
    });
  }, []);

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (!selected) return showAlert('Required', 'Please select a vehicle.');
    if (!password.trim()) return showAlert('Required', 'Please enter your driver code.');

    setLoading(true);
    try {
      const driver = await getDriverByBarcode(password);
      if (!driver) {
        throw new Error('Unknown driver code. Use the code set on your Driving employee in Odoo.');
      }
      setMatchedDriver(driver);
      setLoginPhase('driverReview');
    } catch (err) {
      showAlert('Login Failed', err.message || 'Could not verify driver.', [{ text: 'Try Again', onPress: hideAlert }]);
    } finally {
      setLoading(false);
    }
  };

  const openPorterSelection = async () => {
    Keyboard.dismiss();
    setPortersLoading(true);
    setLoginPhase('porterPick');
    setSelectedPorterIds([]);
    try {
      const list = await getPortersEmployees();
      setPortersList(Array.isArray(list) ? list : []);
      if (!list?.length) {
        showAlert(
          'No porters',
          'No employees found in the Porters department. Ask an admin to check Odoo.',
          [{ text: 'OK', onPress: hideAlert }]
        );
      }
    } catch (e) {
      showAlert('Could not load porters', e?.message || 'Check your connection and try again.', [
        { text: 'Back', onPress: () => { hideAlert(); setLoginPhase('driverReview'); } },
      ]);
      setPortersList([]);
    } finally {
      setPortersLoading(false);
    }
  };

  const finishLoginWithPorters = async () => {
    if (!selected || !matchedDriver) return;
    if (selectedPorterIds.length === 0) {
      return showAlert('Select porters', 'Choose at least one porter for this shift.', [{ text: 'OK', onPress: hideAlert }]);
    }

    const selectedPorters = portersList
      .filter((p) => selectedPorterIds.includes(Number(p.id)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        imageBase64: p.imageBase64,
      }));

    setLoading(true);
    try {
      await saveUserSession({
        isAdmin: false,
        vehicleId: selected.id,
        vehicleName: selected.name,
        licensePlate: selected.license_plate || '',
        driverId: matchedDriver.id,
        driverName: matchedDriver.name,
        driverBarcode: matchedDriver.barcode,
        driverImageBase64: matchedDriver.imageBase64,
        selectedPorters,
        loggedInAt: new Date().toISOString(),
      });

      saveLastVehicleId(selected.id);
      const licensePlate = (selected.license_plate || selected.name || '').trim();
      if (licensePlate) {
        await fetchAndStoreVehicleJournals(licensePlate);
      }
      runSync().catch(() => {});
      resetLoginFlow();
      setPassword('');
      navigation.replace('Main');
    } catch (err) {
      showAlert('Login Failed', err.message || 'Could not save session.', [{ text: 'Try Again', onPress: hideAlert }]);
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
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.55)',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.xl,
      padding: spacing.lg,
      maxHeight: '88%',
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    modalSubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.lg,
    },
    driverAvatarWrap: {
      alignSelf: 'center',
      width: 112,
      height: 112,
      borderRadius: 56,
      overflow: 'hidden',
      borderWidth: 3,
      borderColor: colors.primary,
      marginBottom: spacing.md,
      backgroundColor: colors.background,
    },
    driverAvatarImg: { width: '100%', height: '100%' },
    driverNameText: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    driverVehicleHint: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 6,
    },
    modalBtnRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    modalBtnSecondary: {
      flex: 1,
      height: 50,
      borderRadius: borderRadius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    modalBtnSecondaryText: { fontSize: 16, fontWeight: '700', color: colors.text },
    modalBtnPrimary: {
      flex: 1,
      height: 50,
      borderRadius: borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    modalBtnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
    porterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    porterAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.background,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.primary + '40',
    },
    porterCheck: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    porterCheckOn: { backgroundColor: colors.primary },

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
              <Text style={styles.inputLabel}>Driver code</Text>
              <View style={styles.inputGroup}>
                <Ionicons name="key-outline" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.text }}
                    placeholder="Your driver code (e.g. D1)"
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
                  disabled={loading || syncing || loginPhase !== 'credentials'}
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

        <Modal visible={loginPhase === 'driverReview'} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Signed in as driver</Text>
              <Text style={styles.modalSubtitle}>Confirm your profile, then choose your porters for this vehicle.</Text>
              <View style={styles.driverAvatarWrap}>
                {matchedDriver && odooImageToUri(matchedDriver.imageBase64) ? (
                  <Image
                    source={{ uri: odooImageToUri(matchedDriver.imageBase64) }}
                    style={styles.driverAvatarImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.driverAvatarImg, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="person" size={48} color={colors.primary} />
                  </View>
                )}
              </View>
              <Text style={styles.driverNameText}>{matchedDriver?.name || '—'}</Text>
              <Text style={styles.driverVehicleHint}>
                Vehicle: {selected ? (selected.license_plate || selected.name) : '—'}
              </Text>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalBtnSecondary}
                  onPress={() => {
                    resetLoginFlow();
                    setPassword('');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalBtnSecondaryText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnPrimary} onPress={openPorterSelection} activeOpacity={0.85}>
                  <Text style={styles.modalBtnPrimaryText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={loginPhase === 'porterPick'} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: spacing.md }]}>
              <Text style={styles.modalTitle}>Select porters</Text>
              <Text style={styles.modalSubtitle}>Tap one or more team members on this shift.</Text>
              {portersLoading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : (
                <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                  {portersList.map((p) => {
                    const id = Number(p.id);
                    const on = selectedPorterIds.includes(id);
                    const uri = odooImageToUri(p.imageBase64);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.porterRow}
                        onPress={() => togglePorter(id)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.porterAvatar}>
                          {uri ? (
                            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="person-outline" size={22} color={colors.textSecondary} />
                            </View>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{p.name}</Text>
                          {p.barcode ? (
                            <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{p.barcode}</Text>
                          ) : null}
                        </View>
                        <View style={[styles.porterCheck, on && styles.porterCheckOn]}>
                          {on ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalBtnSecondary}
                  onPress={() => setLoginPhase('driverReview')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalBtnSecondaryText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtnPrimary, loading && { opacity: 0.7 }]}
                  onPress={finishLoginWithPorters}
                  disabled={loading || portersLoading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>Go to dashboard</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

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

import { useTranslation } from 'react-i18next';
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
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getCachedVehicles,
  getLastVehicleId,
  runSync,
  setPostLoginSyncSuccessPending,
  saveUserSession,
  saveLastVehicleId,
  syncVehiclesOnly,
  getSessionExpiryAtIsoEndOfLocalDay,
} from '../services/sync.service';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchAndStoreVehicleJournals } from '../services/vehicle.service';
import {
  getDriverByBarcode,
  getPortersEmployeesOfflineFirst,
  refreshPortersEmployeesCache,
  odooImageToUri,
} from '../services/employee.service';



const LANGUAGE_OPTIONS = [
  { v: 'en', l: 'English' },
  { v: 'ta', l: 'தமிழ்' },
  { v: 'si', l: 'සිංහල' },
];
const MAX_SELECTED_PORTERS = 6;
const LOGIN_SYNC_BLOCK_MS = 8000;

function isTransientNetworkLikeError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('socket') ||
    msg.includes('failed to fetch') ||
    msg.includes('cannot reach server')
  );
}

export default function LoginScreen({ navigation }) {
  const { t } = useTranslation();
  const { colors, appLanguage, setAppLanguage } = useTheme();
  const insets = useSafeAreaInsets();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [languageMenuVisible, setLanguageMenuVisible] = useState(false);
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
  const [porterSearchQuery, setPorterSearchQuery] = useState('');

  const resetLoginFlow = useCallback(() => {
    setLoginPhase('credentials');
    setMatchedDriver(null);
    setPortersList([]);
    setSelectedPorterIds([]);
    setPorterSearchQuery('');
  }, []);

  useEffect(() => {
    initData();
  }, [initData]);

  const togglePorter = useCallback((id) => {
    setSelectedPorterIds((prev) => {
      const n = Number(id);
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_SELECTED_PORTERS) {
        showAlert(
          'Porter limit',
          `You can select up to ${MAX_SELECTED_PORTERS} porters only.`,
          [{ text: 'OK', onPress: hideAlert }]
        );
        return prev;
      }
      return [...prev, n];
    });
  }, []);

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (!selected) return showAlert('Required', 'Pick a vehicle first.');
    if (!password.trim()) return showAlert('Required', 'Enter your driver code.');

    setLoading(true);
    try {
      let driver = null;
      try {
        driver = await getDriverByBarcode(password);
      } catch (firstError) {
        if (!isTransientNetworkLikeError(firstError)) throw firstError;
        // Fast retry once for transient network spikes.
        await new Promise((resolve) => setTimeout(resolve, 600));
        driver = await getDriverByBarcode(password);
      }
      if (!driver) {
        throw new Error('That code does not match. Use the driver code from GasTech.');
      }
      setMatchedDriver(driver);
      setLoginPhase('driverReview');
    } catch (err) {
      showAlert('Login failed', err.message || 'Could not check your code.', [{ text: 'Try again', onPress: hideAlert }]);
    } finally {
      setLoading(false);
    }
  };

  const openPorterSelection = async () => {
    Keyboard.dismiss();
    setPortersLoading(true);
    setLoginPhase('porterPick');
    setSelectedPorterIds([]);
    setPorterSearchQuery('');
    try {
      // Fast path: load cached list first (offline-first), then refresh cache in background.
      const list = await getPortersEmployeesOfflineFirst();
      const normalized = Array.isArray(list) ? list : [];
      setPortersList(normalized);
      setPortersLoading(false);

      const refreshed = await refreshPortersEmployeesCache();
      if (Array.isArray(refreshed) && refreshed.length > 0) {
        setPortersList(refreshed);
      }

      if (!normalized.length && !(Array.isArray(refreshed) && refreshed.length > 0)) {
        showAlert('No porters', 'None on file. Ask your office to check the porter list in GasTech.', [
          { text: 'OK', onPress: hideAlert },
        ]);
      }
    } catch (e) {
      showAlert('Could not load porters', e?.message || 'Check your connection.', [
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
      return showAlert('Select porters', 'Pick at least one porter.', [{ text: 'OK', onPress: hideAlert }]);
    }
    if (selectedPorterIds.length > MAX_SELECTED_PORTERS) {
      return showAlert(
        'Porter limit',
        `You can select up to ${MAX_SELECTED_PORTERS} porters only.`,
        [{ text: 'OK', onPress: hideAlert }]
      );
    }

    // Use already loaded porter list for instant login UX; do not block on extra network calls here.
    const sourcePorters = portersList;

    const selectedPorters = sourcePorters
      .filter((p) => selectedPorterIds.includes(Number(p.id)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        imageBase64: p.imageBase64,
        phone: p.phone || '',
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
        driverPhone: matchedDriver.phone || '',
        selectedPorters,
        loggedInAt: new Date().toISOString(),
        sessionExpiresAt: getSessionExpiryAtIsoEndOfLocalDay(),
        pendingInitialSync: true,
      });

      try {
        await saveLastVehicleId(selected.id);
      } catch (e) {
        console.warn('[Login] saveLastVehicleId failed', e?.message || e);
      }
      const licensePlate = (selected.license_plate || selected.name || '').trim();

      // Do not block login UI on heavy network sync; driver must reach dashboard quickly.
      void (async () => {
        try {
          if (licensePlate) {
            await fetchAndStoreVehicleJournals(licensePlate);
          }
          const syncResult = await Promise.race([
            runSync(),
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ error: `Sync is taking longer than ${Math.floor(LOGIN_SYNC_BLOCK_MS / 1000)}s` }),
                LOGIN_SYNC_BLOCK_MS
              )
            ),
          ]);
          if (syncResult && !syncResult.error) {
            await setPostLoginSyncSuccessPending();
          } else if (syncResult?.error) {
            console.warn('[Login] background sync delayed/failed', syncResult.error);
          }
        } catch (syncErr) {
          console.warn('[Login] background sync failed', syncErr?.message || syncErr);
        }
      })();

      resetLoginFlow();
      setPassword('');
      navigation.replace('Main');
    } catch (err) {
      const msg = String(err?.message || '').trim();
      showAlert(
        'Login failed',
        msg || 'Could not save your session.',
        [{ text: 'Try again', onPress: hideAlert }]
      );
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
      paddingHorizontal: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 12,
    },
    porterRowSelected: {
      backgroundColor: (colors.primary || '#6366f1') + '14',
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 7,
    },
    porterSelectedSection: {
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    porterSelectedSectionLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    porterSelectedChipsScroll: { marginHorizontal: -4 },
    porterSelectedChipsContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 4 },
    porterSelectedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingLeft: 6,
      paddingRight: 10,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.primary,
      maxWidth: 168,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    porterChipAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.35)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.5)',
    },
    porterChipName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
      minWidth: 0,
    },
    porterSelectedEmpty: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: borderRadius.lg,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    porterSelectedEmptyText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    porterListSectionLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginTop: spacing.xs,
      marginBottom: 6,
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
    porterSearchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 10,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    porterSearchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 0,
    },
    porterListHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    porterEmptySearch: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
      paddingHorizontal: spacing.md,
    },
    mainScrollArea: {
      flex: 1,
      justifyContent: 'center',
    },
    langFooter: {
      paddingTop: spacing.sm,
    },
    langSelectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: borderRadius.lg,
      paddingHorizontal: 16,
      height: 52,
      gap: 10,
    },
    langSelectBtnOpen: {
      borderColor: colors.primary,
    },
    langSelectLabel: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    langMenuBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.45)',
    },
    langMenuDismissArea: {
      flex: 1,
    },
    langMenuSheet: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      maxHeight: 280,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 16,
    },
    langMenuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 18,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    langMenuRowOn: {
      backgroundColor: colors.primary + '12',
    },
    langMenuRowText: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    langMenuRowTextOn: {
      color: colors.primary,
      fontWeight: '700',
    },

  }), [colors]);

  const options = useMemo(() => vehicles, [vehicles]);

  const filteredPortersList = useMemo(() => {
    const q = porterSearchQuery.trim().toLowerCase();
    if (!q) return portersList;
    return portersList.filter((p) => {
      const name = String(p?.name || '').toLowerCase();
      const code = String(p?.barcode || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [portersList, porterSearchQuery]);

  /** Selected porters in stable list order — shown as chips under search. */
  const selectedPortersOrdered = useMemo(() => {
    const idSet = new Set(selectedPorterIds);
    return portersList.filter((p) => idSet.has(Number(p.id)));
  }, [portersList, selectedPorterIds]);
  const canGoDashboard = selectedPorterIds.length > 0 && !loading && !portersLoading;

  const displayLabel = selected
      ? (selected?.license_plate || selected?.name)
      : 'Select Vehicle';

  const currentLanguageLabel =
    LANGUAGE_OPTIONS.find((o) => o.v === appLanguage)?.l ?? 'English';

  return (

      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.innerContainer}>
            <View style={styles.mainScrollArea}>
            <View style={styles.headerSection}>
              <AppLogo size={150} useImage={true} />
              <Text style={styles.title}>Delivery Terminal</Text>
              <Text style={styles.subtitle}>Authorized Distributor Portal</Text>
            </View>

            <View style={styles.formSection}>
              <View
                  style={styles.dropdownWrapper}
              >
                <Text style={styles.inputLabel}>{t('login.vehicleID', 'Vehicle ID')}</Text>

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
                              <Text style={{ color: colors.textSecondary }}>{t('login.noVehiclesFound', 'No vehicles found.')}</Text>
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
              <Text style={styles.inputLabel}>{t('login.driverPin', 'Driver pin')}</Text>
              <View style={styles.inputGroup}>
                <Ionicons name="key-outline" size={20} color={colors.primary} style={{ marginRight: 12 }} />
                <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.text }}
                    placeholder={t('login.yourDriverPin', 'Your driver pin')}
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    value={password}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    blurOnSubmit
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
                    <Text style={styles.loginBtnText}>{t('login.login', 'Login')}</Text>
                )}
              </TouchableOpacity>
            </View>
            </View>

            {loginPhase === 'credentials' ? (
              <View style={[styles.langFooter, { paddingBottom: spacing.sm }]}>
                <TouchableOpacity
                  style={[styles.langSelectBtn, languageMenuVisible && styles.langSelectBtnOpen]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setLanguageMenuVisible(true);
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Language"
                  accessibilityHint="Choose app language"
                >
                  <Ionicons name="language-outline" size={22} color={colors.primary} />
                  <Text style={styles.langSelectLabel} numberOfLines={1}>
                    {currentLanguageLabel}
                  </Text>
                  <Ionicons
                    name={languageMenuVisible ? 'chevron-down' : 'chevron-up'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>

        <Modal
          visible={languageMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLanguageMenuVisible(false)}
        >
          <View style={styles.langMenuBackdrop}>
            <Pressable
              style={styles.langMenuDismissArea}
              onPress={() => setLanguageMenuVisible(false)}
            />
            <View
              style={[
                styles.langMenuSheet,
                { marginBottom: Math.max(insets.bottom, spacing.sm) },
              ]}
            >
              {LANGUAGE_OPTIONS.map((opt, index) => {
                const on = appLanguage === opt.v;
                return (
                  <TouchableOpacity
                    key={opt.v}
                    style={[
                      styles.langMenuRow,
                      on && styles.langMenuRowOn,
                      index === LANGUAGE_OPTIONS.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={() => {
                      void setAppLanguage(opt.v);
                      setLanguageMenuVisible(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.langMenuRowText, on && styles.langMenuRowTextOn]}>{opt.l}</Text>
                    {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>

        <Modal visible={loginPhase === 'driverReview'} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('login.signedInAsDriver', 'Signed in as driver')}</Text>
              <Text style={styles.modalSubtitle}>{t('login.ifThisIsYouContinueToPickPortersForThisVehicle', 'If this is you, continue to pick porters for this vehicle.')}</Text>
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
                  <Text style={styles.modalBtnSecondaryText}>{t('login.back', 'Back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnPrimary} onPress={openPorterSelection} activeOpacity={0.85}>
                  <Text style={styles.modalBtnPrimaryText}>{t('login.continue', 'Continue')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={loginPhase === 'porterPick'} transparent animationType="slide">
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
          >
            <View style={[styles.modalCard, { paddingBottom: spacing.md, maxHeight: '92%' }]}>
              <Text style={styles.modalTitle}>{t('login.whoSOnThisShift', 'Who\'s on this shift?')}</Text>
              <Text style={styles.modalSubtitle}>
                Tap names to add or remove. Select up to 6 porters. Selected people show above the list.
              </Text>
              {!portersLoading ? (
                <View style={styles.porterSearchWrap}>
                  <Ionicons name="search" size={22} color={colors.primary} />
                  <TextInput
                    style={styles.porterSearchInput}
                    placeholder={t('login.searchByNameOrCode', 'Search by name or code')}
                    placeholderTextColor={colors.textSecondary}
                    value={porterSearchQuery}
                    onChangeText={setPorterSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    blurOnSubmit
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                  {porterSearchQuery.length > 0 ? (
                    <TouchableOpacity onPress={() => setPorterSearchQuery('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              {!portersLoading ? (
                <View style={styles.porterSelectedSection}>
                  <Text style={styles.porterSelectedSectionLabel}>
                    On this shift ({selectedPortersOrdered.length})
                  </Text>
                  {selectedPortersOrdered.length === 0 ? (
                    <View style={styles.porterSelectedEmpty}>
                      <Ionicons name="arrow-down-outline" size={22} color={colors.primary} />
                      <Text style={styles.porterSelectedEmptyText}>
                        Nobody selected yet. Choose from the list below.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.porterSelectedChipsScroll}
                      contentContainerStyle={styles.porterSelectedChipsContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      {selectedPortersOrdered.map((p) => {
                        const id = Number(p.id);
                        const uri = odooImageToUri(p.imageBase64);
                        const shortName =
                          String(p.name || '')
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .join(' ') || '—';
                        return (
                          <TouchableOpacity
                            key={String(p.id)}
                            style={styles.porterSelectedChip}
                            onPress={() => togglePorter(id)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${p.name} from shift`}
                          >
                            <View style={styles.porterChipAvatar}>
                              {uri ? (
                                <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                              ) : (
                                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                  <Ionicons name="person" size={16} color="#fff" />
                                </View>
                              )}
                            </View>
                            <Text style={styles.porterChipName} numberOfLines={1}>
                              {shortName}
                            </Text>
                            <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.92)" />
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ) : null}
              {portersLoading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : (
                <>
                  <Text style={styles.porterListSectionLabel}>
                    {porterSearchQuery.trim() ? 'Matching porters' : 'All porters'}
                  </Text>
                  <Text style={styles.porterListHint}>
                    {filteredPortersList.length} shown
                    {porterSearchQuery.trim() ? ` · ${portersList.length} total` : ''}
                    {selectedPorterIds.length > 0 ? ` · ${selectedPorterIds.length} on shift` : ''}
                  </Text>
                  <FlatList
                    data={filteredPortersList}
                    keyExtractor={(item) => String(item.id)}
                    style={{ maxHeight: 280 }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    ListEmptyComponent={
                      <View style={styles.porterEmptySearch}>
                        <Ionicons name="people-outline" size={40} color={colors.textSecondary} style={{ marginBottom: 8 }} />
                        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' }}>
                          {portersList.length === 0 ? 'No porters loaded' : 'No matches'}
                        </Text>
                        <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                          {portersList.length === 0 ? 'Try again or contact the office.' : 'Try another search.'}
                        </Text>
                      </View>
                    }
                    renderItem={({ item: p }) => {
                      const id = Number(p.id);
                      const on = selectedPorterIds.includes(id);
                      const uri = odooImageToUri(p.imageBase64);
                      return (
                        <TouchableOpacity
                          style={[styles.porterRow, on && styles.porterRowSelected]}
                          onPress={() => togglePorter(id)}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.porterAvatar, on && { borderColor: colors.primary, borderWidth: 2 }]}>
                            {uri ? (
                              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                            ) : (
                              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="person-outline" size={22} color={colors.textSecondary} />
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }} numberOfLines={2}>
                              {p.name}
                            </Text>
                            {p.barcode ? (
                              <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{p.barcode}</Text>
                            ) : null}
                            {on ? (
                              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary, marginTop: 4 }}>
                                Selected — tap to remove
                              </Text>
                            ) : (
                              <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>{t('login.tapToSelect', 'Tap to select')}</Text>
                            )}
                          </View>
                          <View style={[styles.porterCheck, on && styles.porterCheckOn]}>
                            {on ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </>
              )}
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalBtnSecondary}
                  onPress={() => setLoginPhase('driverReview')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalBtnSecondaryText}>{t('login.back', 'Back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtnPrimary, !canGoDashboard && { opacity: 0.55 }]}
                  onPress={finishLoginWithPorters}
                  disabled={!canGoDashboard}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>{t('login.goToDashboard', 'Go to dashboard')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
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

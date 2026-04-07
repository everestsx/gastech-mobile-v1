import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { usePrinterConnection } from '../context/PrinterConnectionContext';
import { spacing, borderRadius } from '../constants/theme';
import { findBluetoothPrinters } from '../services/printerService';

export default function BluetoothPrinterScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    rongtaReady,
    thermalPrinter,
    thermalConnected,
    connectingThermal,
    connectThermalError,
    selectPrinter,
    clearPrinter,
    connect,
  } = usePrinterConnection();

  const [printerModalVisible, setPrinterModalVisible] = useState(false);
  const [loadingPairedPrinters, setLoadingPairedPrinters] = useState(false);
  const [pairedPrinterRows, setPairedPrinterRows] = useState([]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: {
          padding: spacing.lg,
          paddingBottom: spacing.xl + insets.bottom,
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
        sub: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.md },
        statusOk: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: spacing.md,
          backgroundColor: (colors.success ?? '#22c55e') + '18',
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: (colors.success ?? '#22c55e') + '55',
        },
        statusOkText: { fontSize: 14, fontWeight: '700', color: colors.success ?? '#15803d', flex: 1 },
        statusWarn: {
          fontSize: 13,
          color: colors.textSecondary,
          marginBottom: spacing.md,
          lineHeight: 20,
        },
        row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
        btn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        btnPrimary: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
          flex: 1,
          minWidth: 140,
          justifyContent: 'center',
        },
        btnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        btnTextOnPrimary: { fontSize: 14, fontWeight: '700', color: '#fff' },
        btnMuted: { borderColor: colors.border },
        btnTextMuted: { color: colors.textSecondary },
        connectBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          marginTop: spacing.sm,
        },
        err: { fontSize: 13, color: colors.error || '#dc2626', marginTop: 8 },
        modalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end',
        },
        modalSheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          padding: spacing.lg,
          paddingBottom: spacing.lg + insets.bottom,
          maxHeight: '72%',
        },
        modalHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.sm,
        },
        modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
        pickRow: {
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        pickName: { fontSize: 15, fontWeight: '600', color: colors.text },
        pickAddr: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
      }),
    [colors, insets.bottom]
  );

  const openPicker = useCallback(async () => {
    if (!rongtaReady) return;
    setPrinterModalVisible(true);
    setLoadingPairedPrinters(true);
    setPairedPrinterRows([]);
    try {
      const list = await findBluetoothPrinters();
      setPairedPrinterRows(list);
    } catch (e) {
      Alert.alert('Bluetooth', e?.message || 'Could not list paired printers.');
    } finally {
      setLoadingPairedPrinters(false);
    }
  }, [rongtaReady]);

  const handleConnect = useCallback(async () => {
    try {
      await connect();
    } catch (e) {
      Alert.alert('Bluetooth connection failed', e?.message || 'Could not connect.');
    }
  }, [connect]);

  useEffect(() => {
    if (!printerModalVisible || !thermalConnected || connectingThermal) return;
    const t = setTimeout(() => setPrinterModalVisible(false), 500);
    return () => clearTimeout(t);
  }, [printerModalVisible, thermalConnected, connectingThermal]);

  if (!rongtaReady) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Bluetooth printer</Text>
          <Text style={styles.sub}>
            Rongta Bluetooth printing runs on Android in a dev build or your release APK (native module). On
            iOS or Expo Go, use the system print dialog from the invoice screen instead.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Bluetooth Rongta printer</Text>
        <Text style={styles.sub}>
          Pair the printer in Android Settings → Bluetooth, then choose it here and connect. Your choice is
          saved on this device and works offline for printing after connection.
        </Text>

        {thermalConnected && thermalPrinter ? (
          <View style={styles.statusOk}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success ?? '#16a34a'} />
            <Text style={styles.statusOkText}>
              Connected — {thermalPrinter.name}
            </Text>
          </View>
        ) : (
          <Text style={styles.statusWarn}>
            {thermalPrinter
              ? 'Printer selected. Tap Connect to open the Bluetooth session before printing an invoice.'
              : 'No printer selected yet.'}
          </Text>
        )}

        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={openPicker} activeOpacity={0.85}>
            <Ionicons name="bluetooth" size={20} color={colors.primary} />
            <Text style={styles.btnText}>{thermalPrinter ? 'Change printer' : 'Choose printer'}</Text>
          </TouchableOpacity>
          {thermalPrinter ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnMuted]}
              onPress={() => clearPrinter().catch(() => {})}
              activeOpacity={0.85}
            >
              <Text style={[styles.btnText, styles.btnTextMuted]}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.connectBtn, (!thermalPrinter?.address || connectingThermal) && { opacity: 0.5 }]}
          onPress={handleConnect}
          disabled={!thermalPrinter?.address || connectingThermal}
          activeOpacity={0.85}
        >
          {connectingThermal ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="link" size={22} color="#fff" />
          )}
          <Text style={styles.btnTextOnPrimary}>
            {connectingThermal ? 'Connecting…' : 'Connect to printer'}
          </Text>
        </TouchableOpacity>
        {connectThermalError && !thermalConnected ? (
          <Text style={styles.err}>{connectThermalError}</Text>
        ) : null}
      </View>

      <Modal
        visible={printerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (connectingThermal) return;
          setPrinterModalVisible(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Paired Bluetooth printers</Text>
              <TouchableOpacity
                onPress={() => {
                  if (connectingThermal) return;
                  setPrinterModalVisible(false);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={26} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.btn, { marginBottom: spacing.sm, alignSelf: 'flex-start' }]}
              onPress={openPicker}
              disabled={loadingPairedPrinters}
            >
              {loadingPairedPrinters ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={20} color={colors.primary} />
              )}
              <Text style={styles.btnText}>Refresh list</Text>
            </TouchableOpacity>
            <FlatList
              data={pairedPrinterRows}
              keyExtractor={(item) => item.address}
              style={{ flexGrow: 0 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickRow}
                  onPress={async () => {
                    await selectPrinter(item);
                  }}
                >
                  <Text style={styles.pickName}>{item.name}</Text>
                  <Text style={styles.pickAddr}>{item.address}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                loadingPairedPrinters ? null : (
                  <Text style={{ color: colors.textSecondary, paddingVertical: 16 }}>
                    No paired devices. Pair in system Settings, then refresh.
                  </Text>
                )
              }
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

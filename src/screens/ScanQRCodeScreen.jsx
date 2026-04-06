import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getCustomerByRef, getPartnersByIds } from '../services/customer.service';
import { getCachedOrders, getUserSession } from '../services/sync.service';

const CUSTOMER_PREFIX = 'CUSTOMER:';

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Get today's first (non-cancelled) order for this customer from cache. */
async function getTodayOrderForCustomer(customerId, syncDateField) {
  const user = await getUserSession();
  const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
  const data = await getCachedOrders(vehicleId);
  const all = Array.isArray(data) ? data : [];
  const todayStr = formatDate(new Date());
  const list = all.filter(
    (o) =>
      String(
        (syncDateField === 'delivery_date'
          ? (o.commitment_date || o.date_order)
          : (o.date_order || o.commitment_date)) || ''
      ).startsWith(todayStr) &&
      o.partner_id?.[0] === customerId &&
      String(o.state || '') !== 'cancel'
  );
  return list.length ? list[0] : null;
}

export default function ScanQRCodeScreen({ navigation, route }) {
  const { colors, syncDateField } = useTheme();
  const returnTo = route?.params?.returnTo ?? null;
  const scanContext = route?.params?.scanContext ?? null;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [resolving, setResolving] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        center: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
          padding: 24,
        },
        text: { fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 16 },
        btn: {
          backgroundColor: colors.primary,
          paddingVertical: 12,
          paddingHorizontal: 24,
          borderRadius: 12,
        },
        btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
        overlay: {
          ...StyleSheet.absoluteFillObject,
          justifyContent: 'center',
          alignItems: 'center',
        },
        frame: {
          width: 220,
          height: 220,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.8)',
          borderRadius: 16,
          backgroundColor: 'transparent',
        },
        hint: {
          fontSize: 14,
          color: '#fff',
          marginTop: 16,
          textAlign: 'center',
          textShadowColor: '#000',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 2,
        },
        rescanBtn: {
          marginTop: 24,
          paddingVertical: 12,
          paddingHorizontal: 20,
          backgroundColor: 'rgba(0,0,0,0.5)',
          borderRadius: 12,
        },
        rescanText: { color: '#fff', fontSize: 16, fontWeight: '600' },
        resolvingWrap: { marginTop: 24, alignItems: 'center' },
        closeBtn: {
          position: 'absolute',
          top: 48,
          right: 20,
          padding: 8,
          backgroundColor: 'rgba(0,0,0,0.4)',
          borderRadius: 20,
        },
      }),
    [colors]
  );

  const navigateToOrderDetails = useCallback(
    (saleOrderId) => {
      navigation.reset({
        index: 1,
        routes: [
          { name: 'MainTabs' },
          { name: 'SaleOrderDetails', params: { saleOrderId } },
        ],
      });
    },
    [navigation]
  );

  const navigateToScanResult = useCallback(
    (params) => {
      navigation.reset({
        index: 1,
        routes: [
          { name: 'MainTabs' },
          { name: 'ScanResult', params },
        ],
      });
    },
    [navigation]
  );

  const resolveAndNavigate = useCallback(
    async (customerId, customerName = null) => {
      if (returnTo === 'DailyVisit') {
        navigation.reset({
          index: 0,
          routes: [
            { name: 'MainTabs', params: { screen: 'DailyVisit', params: { customerId } } },
          ],
        });
        return;
      }
      if (returnTo === 'DeliveredOrders') {
        const todayStr = formatDate(new Date());
        navigation.reset({
          index: 0,
          routes: [
            {
              name: 'MainTabs',
              params: {
                screen: 'DeliveredOrders',
                params: {
                  customerId,
                  customerName: customerName || '',
                  scannedDate: todayStr,
                },
              },
            },
          ],
        });
        return;
      }
      try {
        const order = await getTodayOrderForCustomer(customerId, syncDateField);
        if (order?.id) {
          navigateToOrderDetails(order.id);
        } else {
          navigateToScanResult({
            type: 'no_order',
            customerName: customerName || '',
          });
        }
      } catch (err) {
        console.warn('ScanQR: getTodayOrderForCustomer failed', err);
        navigateToScanResult({
          type: 'error',
          message: 'Could not load orders. Try again.',
        });
      }
    },
    [navigation, returnTo, navigateToOrderDetails, navigateToScanResult, syncDateField]
  );

  const scanHint =
    scanContext === 'delivered'
      ? "Scan the customer QR to see today's delivered orders"
      : 'Point the camera at the customer QR';

  const handleBarCodeScanned = useCallback(
    async ({ data }) => {
      if (scanned || resolving) return;
      setScanned(true);
      const trimmed = (data || '').trim();
      // Format 1: CUSTOMER:<partner_id>
      if (trimmed.startsWith(CUSTOMER_PREFIX)) {
        const idStr = trimmed.slice(CUSTOMER_PREFIX.length).trim();
        const customerId = parseInt(idStr, 10);
        if (!Number.isNaN(customerId)) {
          setResolving(true);
          try {
            const partners = await getPartnersByIds([customerId]);
            const partner = partners?.find((p) => p.id === customerId);
            const customerName = partner?.name ?? null;
            await resolveAndNavigate(customerId, customerName);
          } catch (err) {
            console.warn('ScanQR: getPartnersByIds failed', err);
            navigateToScanResult({
              type: 'error',
              message: 'Could not look up customer. Check connection and try again.',
            });
          } finally {
            setResolving(false);
          }
          return;
        }
      }
      // Format 2: plain customer ref code (e.g. 2019080029)
      setResolving(true);
      try {
        const customer = await getCustomerByRef(trimmed);
        if (customer?.id) {
          await resolveAndNavigate(customer.id, customer.name ?? null);
          return;
        }
        navigateToScanResult({
          type: 'customer_not_found',
          ref: trimmed,
        });
      } catch (err) {
        console.warn('ScanQR: getCustomerByRef failed', err);
        navigateToScanResult({
          type: 'error',
          message: 'Could not look up customer. Check connection and try again.',
        });
      } finally {
        setResolving(false);
        setScanned(false);
      }
    },
    [scanned, resolving, resolveAndNavigate, navigateToScanResult]
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Checking camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission is required to scan customer QR codes.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>{scanHint}</Text>
        {resolving && (
          <View style={styles.resolvingWrap}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.hint}>Looking up customer…</Text>
          </View>
        )}
        {scanned && !resolving && (
          <TouchableOpacity
            style={styles.rescanBtn}
            onPress={() => setScanned(false)}
          >
            <Ionicons name="scan-outline" size={24} color="#fff" />
            <Text style={styles.rescanText}>Tap to scan again</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={styles.closeBtn}
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="close" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

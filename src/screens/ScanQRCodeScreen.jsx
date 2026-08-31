import { useTranslation } from 'react-i18next';
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getCustomerByRef, getPartnersByIds } from '../services/customer.service';
import { getCachedCustomers, getCachedOrders, getPickingsBySaleIdsFromDB, getUserSession } from '../services/sync.service';
import { getCheckoutResumeMap } from '../services/checkoutResume.service';
import { isSaleOrderDeliveredInUi } from '../utils/completedOrderUi';

const CUSTOMER_PREFIX = 'CUSTOMER:';

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeScanText(value) {
  const s = String(value ?? '').trim();
  return s;
}

function normalizeRef(value) {
  return normalizeScanText(value).toLowerCase();
}

/** Today's orders for this customer from local cache (same date rules as the Orders tab). */
async function getTodayOrdersForCustomer(customerId, syncDateField) {
  const user = await getUserSession();
  const vehicleId = user?.isAdmin === false ? user.vehicleId : null;
  const data = await getCachedOrders(vehicleId);
  const all = Array.isArray(data) ? data : [];
  const todayStr = formatDate(new Date());
  return all.filter((o) => {
    if (o.partner_id?.[0] !== customerId) return false;
    if (String(o.state || '') === 'cancel') return false;
    const selectedDateValue =
      syncDateField === 'delivery_date'
        ? (o.commitment_date || o.date_order)
        : (o.date_order || o.commitment_date);
    if (String(selectedDateValue || '').startsWith(todayStr)) return true;
    if (
      syncDateField === 'delivery_date' &&
      !o.commitment_date &&
      String(o?.invoice_status || '').toLowerCase() !== 'invoiced'
    ) {
      return true;
    }
    return false;
  });
}

function pickingStateBySaleId(pickings) {
  const map = {};
  (pickings || []).forEach((p) => {
    const saleId = Array.isArray(p.sale_id) ? p.sale_id[0] : p.sale_id;
    if (saleId == null) return;
    if (p.state === 'done') map[saleId] = 'done';
    else if (map[saleId] !== 'done') map[saleId] = p.state;
  });
  return map;
}

function isOrderVisibleOnOrdersTab(order, pickingState, resumeEntry) {
  if (isSaleOrderDeliveredInUi(Number(order?.id))) return false;
  if (String(order?.state || '') === 'cancel') return false;
  if (resumeEntry?.invoiceParams || resumeEntry?.phase === 'payment') return true;
  const inv = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
  const st = String(pickingState || '').toLowerCase();
  return !(inv || st === 'done' || st === 'cancel');
}

/**
 * Orders-tab scan: only open an order that is still on the Orders tab.
 * Already delivered → already_delivered. None for today → not_available.
 */
async function resolveOrdersTabScanForCustomer(customerId, syncDateField) {
  const list = await getTodayOrdersForCustomer(customerId, syncDateField);
  if (!list.length) return { status: 'not_available', customerName: null };

  const [resumeMap, pickings] = await Promise.all([
    getCheckoutResumeMap().catch(() => ({})),
    getPickingsBySaleIdsFromDB(list.map((o) => o.id)),
  ]);
  const saleIdToPickingState = pickingStateBySaleId(pickings);
  const resume = resumeMap && typeof resumeMap === 'object' ? resumeMap : {};

  const available = [];
  const delivered = [];
  for (const o of list) {
    const resumeEntry = resume[String(o.id)];
    if (isOrderVisibleOnOrdersTab(o, saleIdToPickingState[o.id], resumeEntry)) {
      available.push(o);
    } else {
      delivered.push(o);
    }
  }
  const customerName =
    list.find((o) => o?.partner_id?.[1])?.partner_id?.[1] || null;
  if (available.length) {
    return { status: 'available', order: available[0], customerName };
  }
  if (delivered.length) {
    return { status: 'already_delivered', order: delivered[0], customerName };
  }
  return { status: 'not_available', customerName };
}

async function getLocalCustomerById(customerId) {
  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const partners = await getCachedCustomers();
    const row = (Array.isArray(partners) ? partners : []).find((p) => Number(p?.id) === id);
    return row || null;
  } catch (_) {
    return null;
  }
}

async function getLocalCustomerByRef(refCode) {
  const wanted = normalizeRef(refCode);
  if (!wanted) return null;
  try {
    const partners = await getCachedCustomers();
    const row = (Array.isArray(partners) ? partners : []).find(
      (p) => normalizeRef(p?.ref) === wanted
    );
    return row || null;
  } catch (_) {
    return null;
  }
}

export default function ScanQRCodeScreen({ navigation, route }) {
  const { t } = useTranslation();
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
        const result = await resolveOrdersTabScanForCustomer(customerId, syncDateField);
        if (result.status === 'available' && result.order?.id) {
          navigateToOrderDetails(result.order.id);
          return;
        }
        if (result.status === 'already_delivered') {
          navigateToScanResult({
            type: 'already_delivered',
            customerName: customerName || result.customerName || '',
          });
          return;
        }
        navigateToScanResult({
          type: 'order_not_available',
          customerName: customerName || result.customerName || '',
        });
      } catch (err) {
        console.warn('ScanQR: resolveOrdersTabScanForCustomer failed', err);
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
      const trimmed = normalizeScanText(data);
      // Format 1: CUSTOMER:<partner_id>
      if (trimmed.startsWith(CUSTOMER_PREFIX)) {
        const idStr = trimmed.slice(CUSTOMER_PREFIX.length).trim();
        const customerId = parseInt(idStr, 10);
        if (!Number.isNaN(customerId)) {
          setResolving(true);
          try {
            // Local-first so scan works fully offline.
            let customerName = (await getLocalCustomerById(customerId))?.name ?? null;
            if (!customerName) {
              const scanLookup = await resolveOrdersTabScanForCustomer(customerId, syncDateField);
              customerName = scanLookup.customerName ?? null;
            }
            if (!customerName) {
              // Best-effort online enrich for message quality; navigation itself stays cache-driven.
              try {
                const partners = await getPartnersByIds([customerId]);
                const partner = partners?.find((p) => Number(p?.id) === Number(customerId));
                customerName = partner?.name ?? null;
              } catch (_) {
                // ignore: offline or transient network issue
              }
            }
            await resolveAndNavigate(customerId, customerName);
          } catch (err) {
            console.warn('ScanQR: getPartnersByIds failed', err);
            navigateToScanResult({
              type: 'error',
              message: 'Could not look up customer from local data.',
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
        const localCustomer = await getLocalCustomerByRef(trimmed);
        if (localCustomer?.id) {
          await resolveAndNavigate(localCustomer.id, localCustomer.name ?? null);
          return;
        }
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
          message: 'Customer code is not in local cache. Please sync once when online.',
        });
      } finally {
        setResolving(false);
        setScanned(false);
      }
    },
    [scanned, resolving, resolveAndNavigate, navigateToScanResult, syncDateField]
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('scanqrcode.checkingCamera', 'Checking camera…')}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('scanqrcode.cameraPermissionIsRequiredToScanCustomerQRCodes', 'Camera permission is required to scan customer QR codes.')}</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>{t('scanqrcode.grantPermission', 'Grant permission')}</Text>
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
            <Text style={styles.hint}>{t('scanqrcode.lookingUpCustomer', 'Looking up customer…')}</Text>
          </View>
        )}
        {scanned && !resolving && (
          <TouchableOpacity
            style={styles.rescanBtn}
            onPress={() => setScanned(false)}
          >
            <Ionicons name="scan-outline" size={24} color="#fff" />
            <Text style={styles.rescanText}>{t('scanqrcode.tapToScanAgain', 'Tap to scan again')}</Text>
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

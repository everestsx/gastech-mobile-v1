import React, { useEffect, useRef } from 'react';
import { AppState, View, StyleSheet, DeviceEventEmitter } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../constants/theme';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DailyVisitScreen from '../screens/DailyVisitScreen';
import SaleOrderListScreen from '../screens/SaleOrderListScreen';
import DeliveredOrdersScreen from '../screens/DeliveredOrdersScreen';
import SaleOrderDetailsScreen from '../screens/SaleOrderDetailsScreen';
import ProceedPaymentScreen from '../screens/ProceedPaymentScreen';
import EmptyCylinderCollectionScreen from '../screens/EmptyCylinderCollectionScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import PaymentProofScreen from '../screens/PaymentProofScreen';
import QrGenerateScreen from '../screens/QrGenerateScreen';
import ScanQRCodeScreen from '../screens/ScanQRCodeScreen';
import ScanResultScreen from '../screens/ScanResultScreen';
import MenuScreen from '../screens/MenuScreen';
import CustomersScreen from '../screens/CustomersScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PlaceholderScreen from '../screens/PlaceholderScreen';
import MyCommissionScreen from '../screens/MyCommissionScreen';
import VehicleStockScreen from '../screens/VehicleStockScreen';
import SyncHistoryScreen from '../screens/SyncHistoryScreen';
import LocalInvoicesScreen from '../screens/LocalInvoicesScreen';
import CancelOrdersScreen from '../screens/CancelOrdersScreen';
import InvoicedCustomersScreen from '../screens/InvoicedCustomersScreen';
import BluetoothPrinterScreen from '../screens/BluetoothPrinterScreen';
import MySalesScreen from '../screens/MySalesScreen';
import SyncHeaderBadge from '../components/SyncHeaderBadge';

import { useTheme } from '../context/ThemeContext';
import {
  runSync,
  getSyncIntervalMs,
  getUserSession,
  logout,
  isSessionExpired,
  flushPendingUploadsNow,
  hasPendingUploadWork,
  hasDashboardUploadIndicators,
  hasActiveUploadWork,
  hasActionablePendingUploadWork,
  hasDashboardUploadQueueWork,
  shouldRunPendingUploadRetryLoop,
  wakePendingUploadSyncNow,
  PENDING_QUEUE_FAST_RETRY_MS,
  PENDING_QUEUE_FAST_RETRY_WINDOW_MS,
  PENDING_QUEUE_IDLE_POLL_MS,
} from '../services/sync.service';
import * as syncQueueDb from '../database/syncQueue.js';
import {
  subscribeNetworkStatus,
  getPendingRetryDelayMsForQuality,
  getPendingRetryDelayMsForAppState,
  NetworkQuality,
} from '../services/networkStatus.service';

export const rootNavigationRef = createNavigationContainerRef();

async function enforceSessionNotExpired() {
  const user = await getUserSession();
  if (!user || !isSessionExpired(user)) return;
  await logout();
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
  }
}

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MainStack = createNativeStackNavigator();

function MainTabs() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [preCheckDone, setPreCheckDone] = React.useState(true);

  React.useEffect(() => {
    const sub = DeviceEventEmitter.addListener('preCheckStatusChanged', (status) => {
      setPreCheckDone(status);
    });
    return () => sub.remove();
  }, []);

  const tabBarHeight = 60;
  const tabBarPaddingBottom = Math.max(6, insets.bottom);
  return (
    <Tab.Navigator
      screenListeners={{
        tabPress: (e) => {
          if (!preCheckDone) {
            e.preventDefault();
          }
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
          height: tabBarHeight + insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          opacity: preCheckDone ? 1 : 0.4,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: t('navigation.home', 'Home'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Orders"
        component={SaleOrderListScreen}
        options={{
          tabBarLabel: t('navigation.orders', 'Orders'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="DeliveredOrders"
        component={DeliveredOrdersScreen}
        options={{
          tabBarLabel: t('navigation.delivered', 'Delivered'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-done-outline" size={size} color={color} />
          ),
        }}
      />
      {/* <Tab.Screen
        name="Customers"
        component={CustomersScreen}
        options={{
          tabBarLabel: 'Customers',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      /> */}
      <Tab.Screen
        name="Menu"
        component={MenuScreen}
        options={{
          tabBarLabel: t('navigation.menu', 'Menu'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function MainStackScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const headerOrange = colors.primary ?? '#6366f1';
  const headerScreenOptions = {
    headerShown: true,
    headerStyle: {
      backgroundColor: headerOrange,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
    },
    headerTintColor: '#fff',
    headerTitleStyle: { fontWeight: '700', fontSize: 18 },
    headerBackTitle: t('navigation.back', 'Back'),
    headerShadowVisible: true,
    headerRight: () => <SyncHeaderBadge variant="header" />,
  };
  return (
    <MainStack.Navigator
      screenOptions={{
        headerShown: false,
        ...headerScreenOptions,
      }}
    >
      <MainStack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Customers"
        component={CustomersScreen}
        options={{ ...headerScreenOptions, title: t('navigation.myCustomers', 'My Customers') }}
      />
      <MainStack.Screen
        name="DailyVisit"
        component={DailyVisitScreen}
        options={{ ...headerScreenOptions, title: t('navigation.dailyVisit', 'Daily Visit') }}
      />
      <MainStack.Screen
        name="MyStocks"
        component={VehicleStockScreen}
        options={{ ...headerScreenOptions, title: t('navigation.myStocks', 'My Stocks') }}
      />
      <MainStack.Screen
        name="MyCommissions"
        component={MyCommissionScreen}
        options={{ ...headerScreenOptions, title: t('navigation.myCommissions', 'My Commissions') }}
      />
      <MainStack.Screen
        name="SyncHistory"
        component={SyncHistoryScreen}
        options={{ ...headerScreenOptions, title: t('navigation.syncHistory', 'Sync History') }}
      />
      <MainStack.Screen
        name="LocalInvoices"
        component={LocalInvoicesScreen}
        options={{ ...headerScreenOptions, title: t('navigation.myInvoices', 'My Invoices') }}
      />
      <MainStack.Screen
        name="CancelOrders"
        component={CancelOrdersScreen}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="InvoicedCustomers"
        component={InvoicedCustomersScreen}
        options={{ ...headerScreenOptions, title: t('navigation.invoicedCustomers', 'Invoiced Customers') }}
      />
      <MainStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...headerScreenOptions, title: t('navigation.settings', 'Settings') }}
      />
      <MainStack.Screen
        name="MySales"
        component={MySalesScreen}
        options={{ ...headerScreenOptions }}
      />
      <MainStack.Screen
        name="BluetoothPrinter"
        component={BluetoothPrinterScreen}
        options={{ ...headerScreenOptions, title: t('navigation.bluetoothPrinter', 'Bluetooth printer') }}
      />
      <MainStack.Screen
        name="SaleOrderDetails"
        component={SaleOrderDetailsScreen}
        options={{ ...headerScreenOptions, title: t('navigation.orderDetails', 'Order Details') }}
      />
      <MainStack.Screen
        name="ProceedPayment"
        component={ProceedPaymentScreen}
        options={{ ...headerScreenOptions, title: t('navigation.payment', 'Payment') }}
      />
      <MainStack.Screen
        name="EmptyCylinderCollection"
        component={EmptyCylinderCollectionScreen}
        options={{ ...headerScreenOptions, title: t('navigation.emptyCylinders', 'Empty Cylinders') }}
      />
      <MainStack.Screen
        name="InvoiceScreen"
        component={InvoiceScreen}
        options={{ ...headerScreenOptions, title: t('navigation.invoice', 'Invoice') }}
      />
      <MainStack.Screen
        name="PaymentProof"
        component={PaymentProofScreen}
        options={{ ...headerScreenOptions, title: t('navigation.paymentProof', 'Payment proof'), headerBackVisible: false }}
      />
      <MainStack.Screen
        name="ScanQRCode"
        component={ScanQRCodeScreen}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ScanResult"
        component={ScanResultScreen}
        options={{ ...headerScreenOptions, title: t('navigation.scanResult', 'Scan result') }}
      />
      <MainStack.Screen
        name="QRGenerator"
        component={QrGenerateScreen}
        options={{ ...headerScreenOptions, title: t('navigation.customerQRGenerator', 'Customer QR Generator') }}
      />
    </MainStack.Navigator>
  );
}

export default function AppNavigator() {
  const syncIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const networkQualityRef = useRef(NetworkQuality.OFFLINE);
  const { syncInterval } = useTheme();

  useEffect(() => {
    const unsubNet = subscribeNetworkStatus((snap) => {
      networkQualityRef.current = snap.quality;
    });
    return () => unsubNet?.();
  }, []);

  useEffect(() => {
    const intervalMs = getSyncIntervalMs(syncInterval);
    const runScheduledSyncIfNeeded = async () => {
      if (networkQualityRef.current === NetworkQuality.OFFLINE) return;
      try {
        if (!(await hasActionablePendingUploadWork())) return;
      } catch (_) {
        return;
      }
      runSync().catch(() => {});
    };

    const runFastPending = async () => {
      if (networkQualityRef.current === NetworkQuality.OFFLINE) return;
      try {
        if (!(await shouldRunPendingUploadRetryLoop())) return;
        const ageMs = await syncQueueDb.getOldestPendingQueueAgeMs();
        const passes = ageMs <= PENDING_QUEUE_FAST_RETRY_WINDOW_MS ? 18 : 10;
        await flushPendingUploadsNow({
          includeAttachments: true,
          queuePasses: passes,
          aggressive: true,
        });
        const stillPending = await hasPendingUploadWork();
        const stillIndicators = hasDashboardUploadQueueWork();
        if (!stillPending && !stillIndicators) return;
        if (networkQualityRef.current === NetworkQuality.GOOD && stillPending) {
          await flushPendingUploadsNow({
            includeAttachments: true,
            queuePasses: 22,
            aggressive: true,
          });
          if (!(await hasPendingUploadWork()) && !hasDashboardUploadQueueWork()) return;
        }
      } catch (_) {
        /* ignore */
      }
    };

    const sub = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      const isActive = nextState === 'active';
      if (isActive && !wasActive) {
        void enforceSessionNotExpired();
        void runScheduledSyncIfNeeded();
        syncIntervalRef.current = setInterval(() => {
          void runScheduledSyncIfNeeded();
        }, intervalMs);
        void runFastPending();
      } else if (!isActive && wasActive) {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
        wakePendingUploadSyncNow({ queuePasses: 24, includeAttachments: true });
        void runFastPending();
      }
      appStateRef.current = nextState;
    });

    if (AppState.currentState === 'active') {
      void enforceSessionNotExpired();
      void runScheduledSyncIfNeeded();
      syncIntervalRef.current = setInterval(() => {
        void runScheduledSyncIfNeeded();
      }, intervalMs);
    }

    let fastPendingTimer = null;
    let fastPendingCancelled = false;
    const scheduleFastPendingLoop = (delayMs = PENDING_QUEUE_FAST_RETRY_MS) => {
      if (fastPendingCancelled) return;
      fastPendingTimer = setTimeout(async () => {
        if (fastPendingCancelled) return;
        let hasWork = false;
        try {
          hasWork = await shouldRunPendingUploadRetryLoop();
        } catch (_) {
          hasWork = false;
        }
        if (hasWork) {
          try {
            await runFastPending();
          } catch (_) {
            /* ignore */
          }
        }
        let nextMs = PENDING_QUEUE_IDLE_POLL_MS;
        if (hasWork) {
          const q =
            networkQualityRef.current === NetworkQuality.OFFLINE
              ? NetworkQuality.WEAK
              : networkQualityRef.current;
          nextMs = getPendingRetryDelayMsForAppState(AppState.currentState, q);
        }
        scheduleFastPendingLoop(nextMs);
      }, delayMs);
    };
    /** Let login/dashboard paint from SQLite before competing with heavy queue drain. */
    const startupPendingDelayMs = 2800;
    setTimeout(() => {
      void (async () => {
        try {
          if (await shouldRunPendingUploadRetryLoop()) await runFastPending();
        } catch (_) {
          /* ignore */
        }
      })();
      scheduleFastPendingLoop(PENDING_QUEUE_FAST_RETRY_MS);
    }, startupPendingDelayMs);

    return () => {
      sub?.remove?.();
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      fastPendingCancelled = true;
      if (fastPendingTimer) clearTimeout(fastPendingTimer);
    };
  }, [syncInterval]);

  useEffect(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void enforceSessionNotExpired();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <NavigationContainer ref={rootNavigationRef}>
      <View style={styles.navWrap}>
        <View style={styles.navContent}>
          <RootStack.Navigator
            initialRouteName="Splash"
            screenOptions={{ headerShown: false }}
          >
            <RootStack.Screen name="Splash" component={SplashScreen} />
            <RootStack.Screen name="Login" component={LoginScreen} />
            <RootStack.Screen
              name="Main"
              component={MainStackScreen}
              options={{ headerShown: false }}
            />
          </RootStack.Navigator>
        </View>
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  navWrap: { flex: 1 },
  navContent: { flex: 1 },
});

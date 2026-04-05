import React, { useEffect, useRef } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '../context/SyncContext';
import { colors } from '../constants/theme';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DailyVisitScreen from '../screens/DailyVisitScreen';
import SaleOrderListScreen from '../screens/SaleOrderListScreen';
import DeliveredOrdersScreen from '../screens/DeliveredOrdersScreen';
import SaleOrderDetailsScreen from '../screens/SaleOrderDetailsScreen';
import ProceedPaymentScreen from '../screens/ProceedPaymentScreen';
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
import BluetoothPrinterScreen from '../screens/BluetoothPrinterScreen';
import SyncHeaderBadge from '../components/SyncHeaderBadge';

import { useTheme } from '../context/ThemeContext';
import { runSync, getSyncIntervalMs } from '../services/sync.service';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MainStack = createNativeStackNavigator();

function MainTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60;
  const tabBarPaddingBottom = Math.max(6, insets.bottom);
  return (
    <Tab.Navigator
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
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Orders"
        component={SaleOrderListScreen}
        options={{
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="DeliveredOrders"
        component={DeliveredOrdersScreen}
        options={{
          tabBarLabel: 'Delivered',
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
          tabBarLabel: 'Menu',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function MainStackScreen() {
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
    headerBackTitle: 'Back',
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
        options={{ ...headerScreenOptions, title: 'My Customers' }}
      />
      <MainStack.Screen
        name="DailyVisit"
        component={DailyVisitScreen}
        options={{ ...headerScreenOptions, title: 'Daily Visit' }}
      />
      <MainStack.Screen
        name="MyStocks"
        component={VehicleStockScreen}
        options={{ ...headerScreenOptions, title: 'My Stocks' }}
      />
      <MainStack.Screen
        name="MyCommissions"
        component={MyCommissionScreen}
        options={{ ...headerScreenOptions, title: 'My Commissions' }}
      />
      <MainStack.Screen
        name="SyncHistory"
        component={SyncHistoryScreen}
        options={{ ...headerScreenOptions, title: 'Sync History' }}
      />
      <MainStack.Screen
        name="LocalInvoices"
        component={LocalInvoicesScreen}
        options={{ ...headerScreenOptions, title: 'My Invoices' }}
      />
      <MainStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...headerScreenOptions, title: 'Settings' }}
      />
      <MainStack.Screen
        name="BluetoothPrinter"
        component={BluetoothPrinterScreen}
        options={{ ...headerScreenOptions, title: 'Bluetooth printer' }}
      />
      <MainStack.Screen
        name="SaleOrderDetails"
        component={SaleOrderDetailsScreen}
        options={{ ...headerScreenOptions, title: 'Order Details' }}
      />
      <MainStack.Screen
        name="ProceedPayment"
        component={ProceedPaymentScreen}
        options={{ ...headerScreenOptions, title: 'Payment' }}
      />
      <MainStack.Screen
        name="InvoiceScreen"
        component={InvoiceScreen}
        options={{ ...headerScreenOptions, title: 'Invoice' }}
      />
      <MainStack.Screen
        name="PaymentProof"
        component={PaymentProofScreen}
        options={{ ...headerScreenOptions, title: 'Payment proof', headerBackVisible: false }}
      />
      <MainStack.Screen
        name="ScanQRCode"
        component={ScanQRCodeScreen}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ScanResult"
        component={ScanResultScreen}
        options={{ ...headerScreenOptions, title: 'Scan result' }}
      />
      <MainStack.Screen
        name="QRGenerator"
        component={QrGenerateScreen}
        options={{ ...headerScreenOptions, title: 'Customer QR Generator' }}
      />
    </MainStack.Navigator>
  );
}

export default function AppNavigator() {
  const syncIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const { hideSyncIndicator } = useSync();
  const { syncInterval } = useTheme();
  const hideSyncRef = useRef(hideSyncIndicator);
  hideSyncRef.current = hideSyncIndicator;

  useEffect(() => {
    const intervalMs = getSyncIntervalMs(syncInterval);
    const run = () => {
      if (hideSyncRef.current) return;
      runSync().catch(() => {});
    };

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && appStateRef.current !== 'active') {
        run();
        syncIntervalRef.current = setInterval(run, intervalMs);
      } else if (nextState !== 'active') {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
      }
      appStateRef.current = nextState;
    });

    if (AppState.currentState === 'active') {
      run();
      syncIntervalRef.current = setInterval(run, intervalMs);
    }

    return () => {
      sub?.remove?.();
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [syncInterval]);

  return (
    <NavigationContainer>
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

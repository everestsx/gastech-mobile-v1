import React, { useEffect, useRef, useState } from 'react';
import { AppState, TouchableOpacity, View, Text, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DailyVisitScreen from '../screens/DailyVisitScreen';
import SaleOrderListScreen from '../screens/SaleOrderListScreen';
import SaleOrderDetailsScreen from '../screens/SaleOrderDetailsScreen';
import ProceedPaymentScreen from '../screens/ProceedPaymentScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import QrGenerateScreen from '../screens/QrGenarateScreen';
import ScanQRCodeScreen from '../screens/ScanQRCodeScreen';
import MenuScreen from '../screens/MenuScreen';
import CustomersScreen from '../screens/CustomersScreen';
import SettingsScreen from '../screens/SettingsScreen';

import { useTheme } from '../context/ThemeContext';
import { useNetwork } from '../context/NetworkContext';
import { runSync, runProcessOfflineQueue, getSyncIntervalMs, getUserSession } from '../services/sync.service';
import NetworkStatusIndicator from '../components/NetworkStatusIndicator';

/** Modern header avatar: image or empty user icon. Tapping opens Menu. */
function HeaderAvatar({ onPress }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    getUserSession().then(setUser);
  }, []);
  const avatarUri = user?.avatarUri ?? user?.avatar ?? null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 2,
        elevation: 2,
      }}
    >
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{ width: 36, height: 36, borderRadius: 18 }}
          resizeMode="cover"
        />
      ) : (
        <Ionicons name="person-outline" size={22} color="rgba(255,255,255,0.9)" />
      )}
    </TouchableOpacity>
  );
}

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MainStack = createNativeStackNavigator();

const TAB_BAR_TOP_PADDING = 8;
const TAB_BAR_INNER_HEIGHT = 52;
const TAB_BAR_MIN_BOTTOM = 4;

function MainTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(TAB_BAR_MIN_BOTTOM, insets.bottom);
  const tabBarHeight = TAB_BAR_INNER_HEIGHT + TAB_BAR_TOP_PADDING + bottomInset;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          paddingTop: TAB_BAR_TOP_PADDING,
          paddingBottom: bottomInset,
          height: tabBarHeight,
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
        name="DailyVisit"
        component={DailyVisitScreen}
        options={{
          tabBarLabel: 'Daily Visit',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
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
        name="Customers"
        component={CustomersScreen}
        options={{
          tabBarLabel: 'Customers',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function MainStackScreen() {
  const { colors } = useTheme();
  const headerScreenOptions = {
    headerShown: true,
    headerStyle: {
      backgroundColor: colors.primary,
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
        options={({ navigation }) => ({
          headerShown: true,
          ...headerScreenOptions,
          headerLeft: () => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: 16,
                marginRight: 16,
              }}
            >
              <HeaderAvatar onPress={() => navigation.navigate('Menu')} />
            </View>
          ),
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 18, color: '#fff', fontWeight: '700' }} numberOfLines={1}>
                GasTech
              </Text>
              <NetworkStatusIndicator />
            </View>
          ),
        })}
      />
      <MainStack.Screen
        name="Menu"
        component={MenuScreen}
        options={{ ...headerScreenOptions, title: 'Menu' }}
      />
      <MainStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...headerScreenOptions, title: 'Settings' }}
      />
      <MainStack.Screen
        name="SaleOrderDetails"
        component={SaleOrderDetailsScreen}
        options={{ ...headerScreenOptions, title: 'Order details' }}
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
        name="ScanQRCode"
        component={ScanQRCodeScreen}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="QRGenerator"
        component={QrGenerateScreen}
        options={{ ...headerScreenOptions, title: 'Customer QR Generator' }}
      />
    </MainStack.Navigator>
  );
}

/** When network reconnects, push queued offline changes then sync; then app goes online. */
function ReconnectionSync() {
  const { onReconnect } = useNetwork();
  useEffect(() => {
    const unregister = onReconnect(() =>
      runProcessOfflineQueue()
        .then(() => runSync())
        .catch(() => {})
    );
    return () => (typeof unregister === 'function' ? unregister() : unregister?.());
  }, [onReconnect]);
  return null;
}

export default function AppNavigator() {
  const { isOnline } = useNetwork();
  const syncIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    const intervalMs = getSyncIntervalMs();
    const run = () => {
      if (isOnline !== true) return;
      runSync(true).catch(() => {});
    };

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && appStateRef.current !== 'active') {
        run();
        if (isOnline === true) syncIntervalRef.current = setInterval(run, intervalMs);
      } else if (nextState !== 'active') {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
      }
      appStateRef.current = nextState;
    });

    if (AppState.currentState === 'active' && isOnline === true) {
      run();
      syncIntervalRef.current = setInterval(run, intervalMs);
    }

    return () => {
      sub?.remove?.();
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [isOnline]);

  return (
    <NavigationContainer>
      <ReconnectionSync />
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
    </NavigationContainer>
  );
}

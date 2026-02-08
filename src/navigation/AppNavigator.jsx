import React, { useEffect, useRef, useState } from 'react';
import { AppState, TouchableOpacity, View, Text, Image } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import DailyVisitScreen from '../screens/DailyVisitScreen';
import SaleOrderListScreen from '../screens/SaleOrderListScreen';
import SaleOrderDetailsScreen from '../screens/SaleOrderDetailsScreen';
import ProceedPaymentScreen from '../screens/ProceedPaymentScreen';
import InvoiceScreen from '../screens/InvoiceScreen';
import QrGenerateScreen from '../screens/QrGenerateScreen';
import ScanQRCodeScreen from '../screens/ScanQRCodeScreen';
import MenuScreen from '../screens/MenuScreen';
import CustomersScreen from '../screens/CustomersScreen';
import SettingsScreen from '../screens/SettingsScreen';

import { useTheme } from '../context/ThemeContext';
import { runSync, getSyncIntervalMs, getUserSession } from '../services/sync.service';

/** Profile circle: improved modern circle (image or empty user icon). */
function ProfileCircle({ avatarUri, size = 48 }) {
  const s = size;
  const inner = s - 4;
  return (
    <View
      style={{
        width: s,
        height: s,
        borderRadius: s / 2,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderWidth: 3,
        borderColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
      }}
    >
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          resizeMode="cover"
        />
      ) : (
        <Ionicons name="person-outline" size={s * 0.5} color="rgba(255,255,255,0.95)" />
      )}
    </View>
  );
}

/** Header left: profile circle + driver name. Tapping opens Profile. */
function HeaderProfileWithName({ onPress }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    getUserSession().then(setUser);
  }, []);
  const avatarUri = user?.avatarUri ?? user?.avatar ?? null;
  const driverName = user?.name || user?.username || 'Driver';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        marginRight: 16,
        gap: 12,
      }}
    >
      <ProfileCircle avatarUri={avatarUri} size={48} />
      <Text
        style={{
          fontSize: 18,
          fontWeight: '700',
          color: '#fff',
          maxWidth: 160,
        }}
        numberOfLines={1}
      >
        {driverName}
      </Text>
    </TouchableOpacity>
  );
}

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
      backgroundColor: colors.warning ?? '#d97706',
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
            <HeaderProfileWithName onPress={() => navigation.navigate('Menu')} />
          ),
          headerTitle: () => null,
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

export default function AppNavigator() {
  const syncIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    const intervalMs = getSyncIntervalMs();
    const run = () => runSync().catch(() => {});

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
  }, []);

  return (
    <NavigationContainer>
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

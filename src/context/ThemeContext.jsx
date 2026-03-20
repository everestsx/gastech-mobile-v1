import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getThemeColors } from '../constants/theme';

const STORAGE_KEYS = {
  THEME: '@gastech_theme',
  SHOW_CREATE_SALES_ORDER: '@gastech_show_create_sales_order',
  SHOW_RETURN_ORDER: '@gastech_show_return_order',
  SYNC_PERIOD: '@gastech_sync_period',
};

const ThemeContext = createContext(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('light');
  const [showCreateSalesOrder, setShowCreateSalesOrderState] = useState(true);
  const [showReturnOrder, setShowReturnOrderState] = useState(true);
  const [syncPeriod, setSyncPeriodState] = useState('7days');
  const [ready, setReady] = useState(false);

  const colors = getThemeColors(theme);
  const isDark = theme === 'dark';

  const loadSettings = useCallback(async () => {
    try {
      const [savedTheme, createOrder, returnOrder, savedSyncPeriod] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.THEME),
        AsyncStorage.getItem(STORAGE_KEYS.SHOW_CREATE_SALES_ORDER),
        AsyncStorage.getItem(STORAGE_KEYS.SHOW_RETURN_ORDER),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC_PERIOD),
      ]);
      if (savedTheme === 'dark' || savedTheme === 'light') setThemeState(savedTheme);
      if (createOrder !== null) setShowCreateSalesOrderState(createOrder === 'true');
      if (returnOrder !== null) setShowReturnOrderState(returnOrder === 'true');
      if (savedSyncPeriod && ['7days', '30days', '90days', '1year', 'all'].includes(savedSyncPeriod)) setSyncPeriodState(savedSyncPeriod);
    } catch (_) {}
    setReady(true);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const setTheme = useCallback(async (value) => {
    const next = value === 'dark' ? 'dark' : 'light';
    setThemeState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.THEME, next);
    } catch (_) {}
  }, []);

  const setShowCreateSalesOrder = useCallback(async (value) => {
    setShowCreateSalesOrderState(!!value);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SHOW_CREATE_SALES_ORDER, String(!!value));
    } catch (_) {}
  }, []);

  const setShowReturnOrder = useCallback(async (value) => {
    setShowReturnOrderState(!!value);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SHOW_RETURN_ORDER, String(!!value));
    } catch (_) {}
  }, []);

  const setSyncPeriod = useCallback(async (value) => {
    setSyncPeriodState(value);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_PERIOD, String(value));
    } catch (_) {}
  }, []);

  const value = {
    theme,
    setTheme,
    isDark,
    colors,
    showCreateSalesOrder,
    showReturnOrder,
    setShowCreateSalesOrder,
    setShowReturnOrder,
    syncPeriod,
    setSyncPeriod,
    ready,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

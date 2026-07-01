import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getThemeColors } from '../constants/theme';
import i18n, { initI18n, reloadI18nResources } from '../i18n';


const STORAGE_KEYS = {
  THEME: '@gastech_theme',
  SHOW_CREATE_SALES_ORDER: '@gastech_show_create_sales_order',
  SHOW_RETURN_ORDER: '@gastech_show_return_order',
  SYNC_PERIOD: '@gastech_sync_period',
  SYNC_DATE_FIELD: '@gastech_sync_date_field',
  SYNC_INTERVAL: '@gastech_sync_interval',
  APP_LANGUAGE: '@gastech_app_language',
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
  const [syncDateField, setSyncDateFieldState] = useState('delivery_date');
  const [syncInterval, setSyncIntervalState] = useState('5min');
  const [appLanguage, setAppLanguageState] = useState('en');
  const [ready, setReady] = useState(false);

  const colors = getThemeColors(theme);
  const isDark = theme === 'dark';

  const loadSettings = useCallback(async () => {
    try {
      const [savedTheme, createOrder, returnOrder, savedSyncPeriod, savedSyncDateField, savedSyncInterval, savedLang] =
        await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.THEME),
        AsyncStorage.getItem(STORAGE_KEYS.SHOW_CREATE_SALES_ORDER),
        AsyncStorage.getItem(STORAGE_KEYS.SHOW_RETURN_ORDER),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC_PERIOD),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC_DATE_FIELD),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC_INTERVAL),
        AsyncStorage.getItem(STORAGE_KEYS.APP_LANGUAGE),
      ]);
      if (savedTheme === 'dark' || savedTheme === 'light') setThemeState(savedTheme);
      if (createOrder !== null) setShowCreateSalesOrderState(createOrder === 'true');
      if (returnOrder !== null) setShowReturnOrderState(returnOrder === 'true');
      if (savedSyncPeriod) {
        const normalizedSyncPeriod = savedSyncPeriod === '3days' ? '7days' : savedSyncPeriod;
        if (['7days', '30days', '90days', '1year', 'all'].includes(normalizedSyncPeriod)) {
          setSyncPeriodState(normalizedSyncPeriod);
        }
      }
      if (savedSyncDateField && ['creation_date', 'delivery_date'].includes(savedSyncDateField)) {
        setSyncDateFieldState(savedSyncDateField);
      }
      if (savedSyncInterval && ['1min', '5min', '10min', '30min', '1hour', '2hour'].includes(savedSyncInterval)) {
        setSyncIntervalState(savedSyncInterval);
      }
      if (savedLang && ['en', 'ta', 'si'].includes(savedLang)) {
        setAppLanguageState(savedLang);
      }
      // Initialize i18n with saved language or default
      await initI18n(savedLang || 'en');
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
    const next = ['7days', '30days', '90days', '1year', 'all'].includes(value) ? value : '7days';
    setSyncPeriodState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_PERIOD, String(next));
    } catch (_) {}
  }, []);

  const setSyncDateField = useCallback(async (value) => {
    const next = value === 'delivery_date' ? 'delivery_date' : 'creation_date';
    setSyncDateFieldState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_DATE_FIELD, next);
    } catch (_) {}
  }, []);

  const setSyncInterval = useCallback(async (value) => {
    const next = ['1min', '5min', '10min', '30min', '1hour', '2hour'].includes(value) ? value : '5min';
    setSyncIntervalState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_INTERVAL, next);
    } catch (_) {}
  }, []);

  const setAppLanguage = useCallback(async (value) => {
    const next = ['en', 'ta', 'si'].includes(value) ? value : 'en';
    await reloadI18nResources();
    setAppLanguageState(next);
    await i18n.changeLanguage(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, next);
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
    syncDateField,
    setSyncDateField,
    syncInterval,
    setSyncInterval,
    appLanguage,
    setAppLanguage,
    ready,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

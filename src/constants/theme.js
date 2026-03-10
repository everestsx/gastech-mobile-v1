/**
 * Gas Cylinder Delivery App - Light & Dark Theme
 * Vibrant blue-purple theme (matching reference).
 */

export const lightColors = {
  primary: '#6366f1',
  primaryDark: '#312e81',
  primaryLight: '#a5b4fc',
  primarySurface: '#e0e7ff',
  secondary: '#4338ca',
  background: '#f4f6f9',
  surface: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
  success: '#22c55e',
  successDark: '#059669',
  warning: '#d97706',
  warningDark: '#b45309',
  warningLight: '#ED5D1A',
  error: '#dc2626',
  cash: '#059669',
  cheque: '#d97706',
  credit: '#6366f1',
};

export const darkColors = {
  primary: '#6366f1',
  primaryDark: '#6366f1',
  primaryLight: '#312e81',
  primarySurface: '#1f2937',
  secondary: '#4338ca',
  background: '#111827',
  surface: '#273549',
  text: '#f9fafb',
  textSecondary: '#9ca3af',
  border: '#4b5563',
  success: '#10b981',
  warning: '#f59e0b',
  warningDark: '#b45309',
  warningLight: '#f59e0b',
  error: '#ef4444',
};

export function getThemeColors(theme) {
  return theme === 'dark' ? darkColors : lightColors;
}

export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

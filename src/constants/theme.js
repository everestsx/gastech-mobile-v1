/**
 * Gas Cylinder Delivery App - Light & Dark Theme
 * Replace primary/secondary hex values to adjust branding.
 */

export const lightColors = {
  primary: '#1e5aa8',
  primaryDark: '#154a82',
  primaryLight: '#2d7dd2',
  secondary: '#0d3b66',
  background: '#f4f6f9',
  surface: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  cash: '#059669',
  credit: '#2563eb',
};

export const darkColors = {
  primary: '#3b82d6',
  primaryDark: '#2563eb',
  primaryLight: '#60a5fa',
  secondary: '#1e3a5f',
  background: '#111827',
  surface: '#1f2937',
  text: '#f9fafb',
  textSecondary: '#9ca3af',
  border: '#374151',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  cash: '#10b981',
  credit: '#60a5fa',
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

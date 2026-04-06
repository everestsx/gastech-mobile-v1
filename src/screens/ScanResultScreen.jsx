import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';

/**
 * Shown after QR scan when we need to show a message instead of order details:
 * - No order for that customer today
 * - Customer not found (invalid ref)
 * - Network/API error
 * Rich, centered layout with icon and primary action.
 */
export default function ScanResultScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { type = 'error', customerName = '', message: customMessage = '', ref: refCode = '' } = route?.params ?? {};

  const { icon, iconColor, title, message } = useMemo(() => {
    if (type === 'no_order') {
      return {
        icon: 'cube-outline',
        iconColor: colors.warning ?? colors.textSecondary,
        title: 'No order for this date',
        message: customerName
          ? `No order on file for ${customerName} for this date.`
          : 'No order on file for this customer for this date.',
      };
    }
    if (type === 'customer_not_found') {
      return {
        icon: 'person-remove-outline',
        iconColor: colors.error,
        title: 'Customer not found',
        message:
          customMessage ||
          (refCode
            ? `No customer for code "${refCode}". Check and try again.`
            : 'That code does not match a customer.'),
      };
    }
    return {
      icon: 'cloud-offline-outline',
      iconColor: colors.error,
      title: 'Something went wrong',
      message: customMessage || 'Could not look up customer. Check connection.',
    };
  }, [type, customerName, customMessage, refCode, colors]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: spacing.lg,
          justifyContent: 'center',
          alignItems: 'center',
        },
        card: {
          width: '100%',
          maxWidth: 340,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          padding: spacing.xl,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 4,
        },
        iconWrap: {
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: (iconColor || colors.textSecondary) + '20',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: spacing.lg,
        },
        title: {
          fontSize: 20,
          fontWeight: '700',
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        message: {
          fontSize: 16,
          lineHeight: 24,
          color: colors.textSecondary,
          textAlign: 'center',
          marginBottom: spacing.xl,
        },
        btn: {
          backgroundColor: colors.primary,
          paddingVertical: 14,
          paddingHorizontal: 28,
          borderRadius: borderRadius.md,
          minWidth: 200,
          alignItems: 'center',
        },
        btnText: {
          color: '#fff',
          fontSize: 16,
          fontWeight: '600',
        },
      }),
    [colors, insets, iconColor]
  );

  const onBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={40} color={iconColor} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <TouchableOpacity style={styles.btn} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.btnText}>Back to Orders</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

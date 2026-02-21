import React from 'react';
import { View, Image, StyleSheet, Text } from 'react-native';
import { colors } from '../constants/theme';

/**
 * Replaceable logo for Gas Cylinder Delivery app.
 * To use your own logo: add your image to assets/logo.png and uncomment
 * the Image block below (and remove the placeholder View).
 */
const LOGO_SOURCE = require('../../assets/images/AppLogo.png');

export default function AppLogo({ size = 120,useImage = false }) {
  if (useImage) {
    try {
      const logo = require('../../assets/images/AppLogo.png');
      return (
        <View style={styles.wrapper}>
          <Image
            source={logo}
            style={[styles.image, { width: size, height: size * 0.5 }]}
            resizeMode="contain"
          />
        </View>
      );
    } catch (_) {}
  }
  return (
    <View style={[styles.placeholder, { width: size, height: size * 0.5 }]}>
      <Text style={styles.placeholderText}>GasTech</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  label: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  placeholder: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

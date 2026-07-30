import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppLogo from '../components/AppLogo';
import { getUserSession, logout, isSessionExpired } from '../services/sync.service';
import { getDb } from '../database/db';

const { width: W } = Dimensions.get('window');

const SPLASH = {
  glow: '#a5b4fc',
  frost: 'rgba(255,255,255,0.14)',
  frostBorder: 'rgba(255,255,255,0.28)',
};

/** Same indigo stops as before (no expo-linear-gradient — uses react-native-svg only). */
const GRADIENT_STOPS = [
  { offset: '0', color: '#6366f1' },
  { offset: '0.32', color: '#4f46e5' },
  { offset: '0.72', color: '#312e81' },
  { offset: '1', color: '#1e1b4b' },
];

function SplashGradientBg() {
  const { width, height } = Dimensions.get('window');
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id="splashGrad" x1="5%" y1="0%" x2="95%" y2="100%">
          {GRADIENT_STOPS.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill="url(#splashGrad)" />
    </Svg>
  );
}

export default function SplashScreenComponent({ navigation }) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        // Race getDb() against a 5-second timeout.
        // On native devices, SQLite opens in <100ms — this changes nothing.
        // On web (Playwright tests), ExpoSQLite.openDatabaseAsync() hangs
        // forever because the native module is unavailable. The timeout
        // ensures the splash screen always proceeds to Login/Main.
        await Promise.race([
          getDb(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB init timeout (web?)')), 2500)
          ),
        ]);
      } catch (_) {
        /* continue — DB not available (web) or timed out */
      }
      let user = await getUserSession();
      if (user && isSessionExpired(user)) {
        await logout();
        user = null;
      }
      setReady(true);
      if (user) {
        navigation.replace('Main');
      } else {
        navigation.replace('Login');
      }
    })();
  }, [navigation]);

  if (!ready) {
    return (
      <View style={styles.root}>
        <SplashGradientBg />
        <View
          pointerEvents="none"
          style={[
            styles.lightOrb,
            { top: W * 0.08 + insets.top, right: -W * 0.15 },
          ]}
        />
        <View style={[styles.ring, { top: '24%' }]} />

        <View
          style={[
            styles.content,
            { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 24) + 20 },
          ]}
        >
          <View style={styles.logoCard}>
            <AppLogo size={200} useImage />
          </View>
          <Text style={styles.brand}>{t('splash.gasTech', 'GasTech')}</Text>
          <Text style={styles.tagline}>{t('splash.smartCylinderDelivery', 'Smart cylinder delivery')}</Text>
          <ActivityIndicator size="large" color={SPLASH.glow} style={styles.spinner} />
        </View>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1e1b4b',
  },
  lightOrb: {
    position: 'absolute',
    width: W * 0.75,
    height: W * 0.75,
    borderRadius: W * 0.375,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  ring: {
    position: 'absolute',
    alignSelf: 'center',
    width: W * 0.7,
    height: W * 0.7,
    borderRadius: W * 0.35,
    borderWidth: 1.5,
    borderColor: SPLASH.frostBorder,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoCard: {
    paddingVertical: 28,
    paddingHorizontal: 32,
    borderRadius: 28,
    backgroundColor: SPLASH.frost,
    borderWidth: 1,
    borderColor: SPLASH.frostBorder,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 14,
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '600',
    color: SPLASH.glow,
    letterSpacing: 0.35,
    opacity: 0.96,
  },
  spinner: {
    marginTop: 36,
  },
});

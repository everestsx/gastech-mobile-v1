import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppLogo from '../components/AppLogo';
import { getUserSession } from '../services/sync.service';
import { getDb } from '../database/db';

const { width: W } = Dimensions.get('window');

const SPLASH = {
  glow: '#a5b4fc',
  frost: 'rgba(255,255,255,0.14)',
  frostBorder: 'rgba(255,255,255,0.28)',
};

/** Gradient stops aligned with Android `ic_launcher_background` + GasTech theme (indigo). */
const GRADIENT_COLORS = ['#6366f1', '#4f46e5', '#312e81', '#1e1b4b'];

export default function SplashScreenComponent({ navigation }) {
  const [ready, setReady] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        await getDb();
      } catch (_) {
        /* continue */
      }
      const user = await getUserSession();
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
      <LinearGradient
        colors={GRADIENT_COLORS}
        locations={[0, 0.32, 0.72, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={styles.gradient}
      >
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
          <Text style={styles.brand}>GasTech</Text>
          <Text style={styles.tagline}>Smart cylinder delivery</Text>
          <ActivityIndicator size="large" color={SPLASH.glow} style={styles.spinner} />
        </View>
      </LinearGradient>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
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

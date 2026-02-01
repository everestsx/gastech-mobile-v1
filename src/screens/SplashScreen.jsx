import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import AppLogo from '../components/AppLogo';
import { colors } from '../constants/theme';
import { getUserSession } from '../services/sync.service';

export default function SplashScreenComponent({ navigation }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
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
      <View style={styles.container}>
        <AppLogo size={140} showLabel={true} />
        <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
        <Text style={styles.text}>Loading...</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: { marginTop: 24 },
  text: { color: '#fff', marginTop: 8, fontSize: 16 },
});

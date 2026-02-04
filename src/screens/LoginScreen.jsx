import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppLogo from '../components/AppLogo';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { spacing, borderRadius } from '../constants/theme';
import { validateLogin } from '../constants/authConfig';
import { saveUserSession } from '../services/sync.service';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.surface },
        keyboard: { flex: 1 },
        content: {
          flex: 1,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xl,
          alignItems: 'center',
        },
        title: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: spacing.xl },
        subtitle: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
        label: { fontSize: 14, fontWeight: '600', color: colors.text, alignSelf: 'stretch', marginBottom: spacing.sm, marginTop: spacing.sm },
        input: {
          alignSelf: 'stretch',
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          paddingVertical: 14,
          paddingHorizontal: 16,
          marginBottom: spacing.md,
        },
        passwordWrap: {
          flexDirection: 'row',
          alignSelf: 'stretch',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: borderRadius.md,
          backgroundColor: colors.surface,
        },
        passwordInput: { flex: 1, borderWidth: 0, marginTop: 0 },
        eyeBtn: { padding: spacing.md },
        loginBtn: {
          alignSelf: 'stretch',
          backgroundColor: colors.primary,
          paddingVertical: 16,
          borderRadius: borderRadius.md,
          alignItems: 'center',
          marginTop: spacing.xl,
        },
        loginBtnDisabled: { opacity: 0.7 },
        loginBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
      }),
    [colors]
  );

  const { setUser } = useAuth();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required', 'Please enter username and password.');
      return;
    }
    setLoading(true);
    try {
      const session = validateLogin(username.trim(), password);
      if (!session) {
        Alert.alert('Login failed', 'Invalid username or password.');
        return;
      }
      await saveUserSession(session);
      setUser(session);
      navigation.replace('Main');
    } catch (err) {
      Alert.alert('Login failed', err?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.content}>
          <AppLogo size={140} showLabel={true} />

          <Text style={styles.title}>Log In</Text>
          <Text style={styles.subtitle}>Hey there! Let's dive back in!</Text>

          <Text style={styles.label}>Enter your username</Text>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Enter your password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((p) => !p)}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={colors.primary}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Log In</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

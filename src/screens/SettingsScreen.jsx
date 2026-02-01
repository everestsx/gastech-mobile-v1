import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getUserSession } from '../services/sync.service';
import { spacing, borderRadius } from '../constants/theme';

export default function SettingsScreen({ navigation }) {
  const { colors, theme, setTheme, showCreateSalesOrder, showReturnOrder, setShowCreateSalesOrder, setShowReturnOrder } = useTheme();
  const [user, setUser] = useState(null);

  useEffect(() => {
    getUserSession().then(setUser);
  }, []);

  const sectionTitle = (label) => (
    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{label}</Text>
  );

  const row = (icon, label, right) => (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={22} color={colors.primary} />
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      </View>
      {right}
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile */}
      <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>
            {(user?.username || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {user?.username || 'User'}
          </Text>
          <Text style={[styles.profileEmail, { color: colors.textSecondary }]} numberOfLines={1}>
            {user?.email || user?.username ? `@${user.username}` : '—'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
      </View>

      {/* Theme */}
      {sectionTitle('Appearance')}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons
            name={theme === 'dark' ? 'moon' : 'sunny-outline'}
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Dark mode</Text>
        </View>
        <Switch
          value={theme === 'dark'}
          onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={theme === 'dark' ? colors.primary : colors.surface}
        />
      </View>

      {/* Dashboard cards */}
      {sectionTitle('Dashboard')}
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons name="cart-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Show Create Sales Order card</Text>
        </View>
        <Switch
          value={showCreateSalesOrder}
          onValueChange={setShowCreateSalesOrder}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={showCreateSalesOrder ? colors.primary : colors.surface}
        />
      </View>
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <Ionicons name="return-down-back-outline" size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>Show Return Order card</Text>
        </View>
        <Switch
          value={showReturnOrder}
          onValueChange={setShowReturnOrder}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={showReturnOrder ? colors.primary : colors.surface}
        />
      </View>

      {/* Common app features (placeholders) */}
      {sectionTitle('App')}
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Notifications', 'Notification settings coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Notifications</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('About', 'GasTech Delivery v1.0')}
        activeOpacity={0.8}
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>About</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Help', 'Help & support coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Help & Support</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.menuRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => Alert.alert('Privacy', 'Privacy policy coming soon.')}
        activeOpacity={0.8}
      >
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
        <Text style={[styles.menuRowText, { color: colors.text }]}>Privacy</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl + 60 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '700' },
  profileEmail: { fontSize: 13, marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: '500', flex: 1 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  menuRowText: { fontSize: 16, fontWeight: '500', flex: 1 },
  bottomSpacer: { height: 40 },
});

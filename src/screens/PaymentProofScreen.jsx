import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import { empty } from '../database/dbHelpers.js';
import { runSync } from '../services/sync.service';

const MAX_PHOTOS = 3;

export default function PaymentProofScreen({ route, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { saleOrderId, creditProofRequired = false, orderName } = route.params || {};
  const soId = Number(saleOrderId);
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  const canComplete = !creditProofRequired || photos.length > 0;

  const persistPhotos = useCallback(async () => {
    if (!photos.length) return;
    const timestamp = Date.now();
    for (let i = 0; i < photos.length; i++) {
      const uri = photos[i];
      if (!uri || typeof uri !== 'string') continue;
      try {
        const ext = (uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `proof_${soId}_${timestamp}_${i}.${ext}`;
        const source = new FileSystem.File(uri);
        if (!source.exists) continue;
        const dest = new FileSystem.File(FileSystem.Paths.document, fileName);
        source.copy(dest);
        const info = dest.info();
        const destPath = dest.uri;
        if (!info?.exists || (info.size ?? 0) < 100) continue;
        await offlineAttachmentsDb.insert({
          sale_order_id: soId,
          local_file_path: destPath,
          file_name: fileName,
          mime_type: ext === 'png' ? 'image/png' : 'image/jpeg',
        });
      } catch (e) {
        console.warn('[PaymentProof] save failed', { index: i, message: e?.message });
      }
    }
  }, [photos, soId]);

  const handleComplete = useCallback(async () => {
    if (!Number.isFinite(soId) || soId <= 0) {
      Alert.alert('Error', 'Invalid order.');
      return;
    }
    if (creditProofRequired && photos.length === 0) {
      Alert.alert('Photo required', 'Add at least one payment proof photo for credit payment.');
      return;
    }
    setSaving(true);
    try {
      await persistPhotos();
      runSync().catch((e) => console.warn('[PaymentProof] sync', e?.message ?? e));
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen: 'Dashboard' } }],
      });
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not finish. Try again.');
    } finally {
      setSaving(false);
    }
  }, [soId, creditProofRequired, photos.length, persistPhotos, navigation]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        scroll: { padding: spacing.lg, paddingBottom: 120 + insets.bottom },
        hero: {
          alignItems: 'center',
          paddingVertical: spacing.xl,
          marginBottom: spacing.md,
        },
        heroIconWrap: {
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: (colors.primary || '#6366f1') + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        title: {
          fontSize: 22,
          fontWeight: '800',
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        subtitle: {
          fontSize: 15,
          color: colors.textSecondary,
          textAlign: 'center',
          lineHeight: 22,
          paddingHorizontal: spacing.md,
        },
        badge: {
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 8,
          borderRadius: borderRadius.lg,
          backgroundColor: creditProofRequired ? (colors.warning || '#d97706') + '22' : colors.surface,
          borderWidth: 1,
          borderColor: creditProofRequired ? (colors.warning || '#d97706') + '55' : colors.border,
        },
        badgeText: {
          fontSize: 13,
          fontWeight: '700',
          color: creditProofRequired ? colors.warning ?? '#b45309' : colors.textSecondary,
          textAlign: 'center',
        },
        card: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          padding: spacing.lg,
          marginBottom: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
        rowBtns: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
        pickBtn: {
          flex: 1,
          minHeight: 108,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: (colors.primary || '#6366f1') + '44',
          borderStyle: 'dashed',
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        pickBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
        thumbWrap: { width: 88, height: 88, borderRadius: borderRadius.md, overflow: 'hidden', position: 'relative' },
        thumb: { width: '100%', height: '100%', backgroundColor: colors.background },
        remove: {
          position: 'absolute',
          top: 4,
          right: 4,
          backgroundColor: 'rgba(255,255,255,0.95)',
          borderRadius: 14,
        },
        footer: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.md) + 8,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        primaryBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          backgroundColor: colors.primary,
          paddingVertical: 16,
          borderRadius: borderRadius.lg,
        },
        primaryBtnDisabled: { opacity: 0.45 },
        primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
        meta: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
      }),
    [colors, insets.bottom, creditProofRequired]
  );

  if (!Number.isFinite(soId) || soId <= 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>Missing order.</Text>
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: spacing.lg }]} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="camera" size={40} color={colors.primary} />
          </View>
          <Text style={styles.title}>Payment proof</Text>
          <Text style={styles.subtitle}>
            {creditProofRequired
              ? 'Credit is part of this payment. Add at least one clear photo of the proof (receipt, agreement, or handover) before completing.'
              : 'Optional: add photos for your records. You can finish without attaching any.'}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {creditProofRequired ? 'Credit payment — photo required' : 'Cash / cheque — photos optional'}
            </Text>
          </View>
          {orderName ? (
            <Text style={styles.meta}>{empty(orderName)}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add photos ({photos.length} / {MAX_PHOTOS})</Text>
          <View style={styles.rowBtns}>
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={async () => {
                if (photos.length >= MAX_PHOTOS) return;
                const { status } = await ImagePicker.requestCameraPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission', 'Camera access is required.');
                  return;
                }
                const result = await ImagePicker.launchCameraAsync({
                  mediaTypes: ['images'],
                  allowsEditing: false,
                  quality: 0.85,
                });
                if (!result.canceled && result.assets?.[0]?.uri) {
                  setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, result.assets[0].uri] : p));
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={32} color={colors.primary} />
              <Text style={styles.pickBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={async () => {
                if (photos.length >= MAX_PHOTOS) return;
                const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (status !== 'granted') {
                  Alert.alert('Permission', 'Gallery access is required.');
                  return;
                }
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  allowsEditing: false,
                  quality: 0.85,
                });
                if (!result.canceled && result.assets?.[0]?.uri) {
                  setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, result.assets[0].uri] : p));
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="images-outline" size={32} color={colors.primary} />
              <Text style={styles.pickBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 ? (
            <View style={styles.thumbs}>
              {photos.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.remove}
                    onPress={() => setPhotos((p) => p.filter((_, i) => i !== index))}
                    hitSlop={10}
                  >
                    <Ionicons name="close-circle" size={24} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canComplete && styles.primaryBtnDisabled]}
          onPress={() => void handleComplete()}
          disabled={saving || !canComplete}
          activeOpacity={0.88}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-done-circle" size={24} color="#fff" />
              <Text style={styles.primaryBtnText}>Complete payment</Text>
            </>
          )}
        </TouchableOpacity>
        {!creditProofRequired ? (
          <Text style={[styles.meta, { marginTop: spacing.sm }]}>
            No credit in this payment — you can complete without photos.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import {
  getAllPostCheckSubmissions,
  deletePostCheckSubmission,
} from '../database/postcheckSubmissions.js';

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `Rs. ${num.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

function SubmissionCard({ item, colors, cardStyles, onDelete }) {
  const dropoffLabel = item.dropoff_location === 'headoffice' ? 'Head Office' : 'Showroom';
  const dropoffIcon =
    item.dropoff_location === 'headoffice' ? 'business-outline' : 'storefront-outline';
  const totalHandover = (item.cash_total || 0) + (item.cheque_total || 0);

  return (
    <View style={[cardStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Date + Status + Delete */}
      <View style={cardStyles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={[cardStyles.cardDate, { color: colors.textSecondary }]}>
            {formatDateTime(item.submitted_at)}
          </Text>
        </View>
        <View style={cardStyles.cardHeaderRight}>
          <View
            style={[
              cardStyles.statusBadge,
              { backgroundColor: colors.primary + '18', borderColor: colors.primary + '30' },
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={11} color={colors.primary} />
            <Text style={[cardStyles.statusText, { color: colors.primary }]}>Pending Odoo Sync</Text>
          </View>
          <TouchableOpacity
            onPress={onDelete}
            activeOpacity={0.7}
            style={[cardStyles.deleteBtn, { backgroundColor: '#ef444414', borderColor: '#ef444430' }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={14} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Drop-off location */}
      <View
        style={[cardStyles.dropoffRow, { backgroundColor: colors.background, borderColor: colors.border }]}
      >
        <Ionicons name={dropoffIcon} size={15} color={colors.primary} />
        <Text style={[cardStyles.dropoffLabel, { color: colors.text }]}>{dropoffLabel}</Text>
      </View>

      {/* Amounts — Cash + Cheque + Credit */}
      <View style={cardStyles.amountsRow}>
        <View
          style={[cardStyles.amountBox, { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.2)' }]}
        >
          <View style={cardStyles.amountIconWrap}>
            <Ionicons name="cash-outline" size={13} color="#22c55e" />
            <Text style={[cardStyles.amountLabel, { color: colors.textSecondary }]}>Cash</Text>
          </View>
          <Text style={[cardStyles.amountValue, { color: '#22c55e' }]}>{formatCurrency(item.cash_total)}</Text>
        </View>

        <View
          style={[cardStyles.amountBox, { backgroundColor: colors.primary + '0d', borderColor: colors.primary + '25' }]}
        >
          <View style={cardStyles.amountIconWrap}>
            <Ionicons name="document-text-outline" size={13} color={colors.primary} />
            <Text style={[cardStyles.amountLabel, { color: colors.textSecondary }]}>Cheque</Text>
          </View>
          <Text style={[cardStyles.amountValue, { color: colors.primary }]}>{formatCurrency(item.cheque_total)}</Text>
        </View>

        <View
          style={[cardStyles.amountBox, { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }]}
        >
          <View style={cardStyles.amountIconWrap}>
            <Ionicons name="card-outline" size={13} color="#f59e0b" />
            <Text style={[cardStyles.amountLabel, { color: colors.textSecondary }]}>Credit</Text>
          </View>
          <Text style={[cardStyles.amountValue, { color: '#f59e0b' }]}>{formatCurrency(item.credit_total)}</Text>
        </View>
      </View>

      {/* Total */}
      <View style={[cardStyles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[cardStyles.totalLabel, { color: colors.textSecondary }]}>Total Handover</Text>
        <Text style={[cardStyles.totalValue, { color: colors.text }]}>{formatCurrency(totalHandover)}</Text>
      </View>

      {/* Orders summary */}
      <View style={cardStyles.ordersRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="checkmark-circle-outline" size={13} color="#22c55e" />
          <Text style={[cardStyles.ordersText, { color: colors.textSecondary }]}>
            {item.orders_synced ?? 0} synced
          </Text>
        </View>
        {(item.orders_pending ?? 0) > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="warning-outline" size={13} color="#f59e0b" />
            <Text style={[cardStyles.ordersText, { color: '#f59e0b' }]}>
              {item.orders_pending} pending
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function MySalesScreen({ navigation }) {
  const { colors } = useTheme();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        setLoading(true);
        try {
          const rows = await getAllPostCheckSubmissions();
          if (!cancelled) setSubmissions(rows || []);
        } catch (e) {
          console.warn('[MySalesScreen] load failed:', e);
          if (!cancelled) setSubmissions([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      load();
      return () => { cancelled = true; };
    }, [])
  );

  const cardStyles = useMemo(() => makeStyles(), []);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      'Remove Record',
      `Remove the handover record from ${formatDateTime(item.submitted_at)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePostCheckSubmission(item.id);
              setSubmissions((prev) => prev.filter((s) => s.id !== item.id));
            } catch (e) {
              console.warn('[MySalesScreen] delete failed:', e);
            }
          },
        },
      ]
    );
  }, []);

  const renderItem = useCallback(
    ({ item }) => (
      <SubmissionCard
        item={item}
        colors={colors}
        cardStyles={cardStyles}
        onDelete={() => handleDelete(item)}
      />
    ),
    [colors, cardStyles, handleDelete]
  );

  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: colors.background }]}
      edges={['left', 'right', 'bottom']}
    >
      {/* Header */}
      <View style={[cardStyles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={cardStyles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.headerTitle}>My Sales</Text>
          <Text style={cardStyles.headerSubtitle}>Post Check Handover History</Text>
        </View>
        <View style={[cardStyles.countBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
          <Text style={cardStyles.countText}>{submissions.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={cardStyles.loaderWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={submissions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={cardStyles.emptyWrap}>
              <View style={[cardStyles.emptyIconWrap, { backgroundColor: colors.primary + '14' }]}>
                <Ionicons name="receipt-outline" size={38} color={colors.primary} />
              </View>
              <Text style={[cardStyles.emptyTitle, { color: colors.text }]}>No Submissions Yet</Text>
              <Text style={[cardStyles.emptySubtitle, { color: colors.textSecondary }]}>
                Handover summaries submitted via Post Check will appear here.
              </Text>
            </View>
          }
          contentContainerStyle={[
            cardStyles.listContent,
            submissions.length === 0 && { flex: 1 },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      gap: 10,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
    headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
    countBadge: {
      minWidth: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    countText: { fontSize: 15, fontWeight: '800', color: '#fff' },
    loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: spacing.md, paddingBottom: spacing.xl },
    card: { borderRadius: borderRadius.lg, borderWidth: 1, marginBottom: spacing.md, overflow: 'hidden' },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: 12,
      paddingBottom: 8,
      gap: 8,
    },
    cardHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardDate: { fontSize: 12, fontWeight: '500' },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
      borderWidth: 1,
    },
    statusText: { fontSize: 10, fontWeight: '700' },
    deleteBtn: {
      width: 28,
      height: 28,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dropoffRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginHorizontal: spacing.md,
      marginBottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: borderRadius.md,
      borderWidth: 1,
    },
    dropoffLabel: { fontSize: 13, fontWeight: '600' },
    // Three columns now (cash + cheque + credit)
    amountsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md, marginBottom: 10 },
    amountBox: { flex: 1, borderRadius: borderRadius.md, borderWidth: 1, padding: 8 },
    amountIconWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
    amountLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
    amountValue: { fontSize: 13, fontWeight: '800' },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginHorizontal: spacing.md,
      paddingTop: 10,
      paddingBottom: 10,
      borderTopWidth: 1,
    },
    totalLabel: { fontSize: 13, fontWeight: '600' },
    totalValue: { fontSize: 16, fontWeight: '800' },
    ordersRow: { flexDirection: 'row', gap: 14, paddingHorizontal: spacing.md, paddingBottom: 12 },
    ordersText: { fontSize: 12, fontWeight: '500' },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    emptyTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
    emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });
}

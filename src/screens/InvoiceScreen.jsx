import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB } from '../services/sync.service';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

function buildInvoiceHtml(order, lines, paymentType, selectedBankName) {
  const date = order?.date_order
    ? new Date(order.date_order).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const customerName = order?.partner_id?.[1] ?? '—';
  const orderNo = order?.name ?? '—';
  const paymentLabel =
    paymentType === 'bank' && selectedBankName
      ? `Bank: ${selectedBankName}`
      : 'Cash';

  const rows =
    (lines || [])
      .map(
        (l) =>
          `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${(l.product_id?.[1] ?? '—').replace(/</g, '&lt;')}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${Number(l.product_uom_qty ?? 0)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(l.price_unit ?? 0)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(l.price_total ?? 0)}</td>
          </tr>`
      )
      .join('') || '<tr><td colspan="4" style="padding:12px;text-align:center">No line items</td></tr>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; padding: 16px; max-width: 320px; margin: 0 auto; }
    h1 { font-size: 18px; margin: 0 0 8px 0; color: #1e5aa8; }
    .meta { color: #666; margin-bottom: 12px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #1e5aa8; font-size: 10px; text-transform: uppercase; color: #666; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
    .totals { margin-top: 12px; border-top: 1px solid #ddd; padding-top: 8px; }
    .row { display: flex; justify-content: space-between; margin: 4px 0; }
    .total-row { font-weight: bold; font-size: 14px; margin-top: 8px; }
    .payment { margin-top: 12px; padding: 8px; background: #f4f6f9; border-radius: 8px; font-size: 11px; }
    .footer { margin-top: 16px; font-size: 10px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <h1>GasTech</h1>
  <div class="meta">INVOICE</div>
  <div class="meta">Order: ${orderNo} &nbsp;|&nbsp; Date: ${date}</div>
  <div class="meta">Customer: ${customerName.replace(/</g, '&lt;')}</div>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatCurrency(order?.amount_untaxed ?? 0)}</span></div>
    <div class="row"><span>Tax</span><span>${formatCurrency(order?.amount_tax ?? 0)}</span></div>
    <div class="row total-row"><span>Total</span><span>${formatCurrency(order?.amount_total ?? 0)}</span></div>
  </div>
  <div class="payment">Payment: ${paymentLabel}</div>
  <div class="footer">Thank you for your business</div>
</body>
</html>`;
}

export default function InvoiceScreen({ route, navigation }) {
  const { colors } = useTheme();
  const {
    saleOrderId,
    total,
    paymentType,
    selectedBankName,
  } = route.params ?? {};

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.xl + 60 },
        center: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        previewCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginBottom: spacing.lg,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        companyName: { fontSize: 20, fontWeight: '800', color: colors.primary, marginBottom: 4 },
        invoiceTitle: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.md },
        metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
        metaLabel: { fontSize: 12, color: colors.textSecondary },
        metaValue: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1, marginLeft: 8 },
        tableHeader: {
          flexDirection: 'row',
          borderBottomWidth: 2,
          borderBottomColor: colors.primary,
          paddingVertical: 6,
          marginTop: spacing.sm,
          marginBottom: 4,
        },
        th: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
        thProduct: { flex: 1 },
        thNum: { width: 56, textAlign: 'right' },
        tableRow: {
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          paddingVertical: 6,
        },
        td: { fontSize: 13, color: colors.text },
        tdProduct: { flex: 1 },
        tdNum: { width: 56, textAlign: 'right' },
        totalsSection: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
        totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
        totalsRowMain: { marginTop: 4 },
        totalsLabel: { fontSize: 13, color: colors.textSecondary },
        totalsValue: { fontSize: 13, fontWeight: '600', color: colors.text },
        totalsLabelMain: { fontSize: 16, fontWeight: '700', color: colors.text },
        totalsValueMain: { fontSize: 16, fontWeight: '800', color: colors.text },
        paymentBadge: {
          marginTop: spacing.sm,
          padding: spacing.sm,
          backgroundColor: colors.background,
          borderRadius: borderRadius.sm,
        },
        paymentText: { fontSize: 13, fontWeight: '600', color: colors.text },
        printBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 4,
        },
        printBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
        printerNote: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
          backgroundColor: colors.surface,
          padding: spacing.md,
          borderRadius: borderRadius.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        printerNoteTextWrap: { flex: 1 },
        printerNoteTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
        printerNoteText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
        doneBtn: { paddingVertical: 14, alignItems: 'center' },
        doneBtnText: { fontSize: 16, fontWeight: '700', color: colors.primary },
      }),
    [colors]
  );

  const loadInvoice = useCallback(async () => {
    if (!saleOrderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      setOrder(data.order);
      setLines(data.lines ?? []);
    } catch (_) {
      setOrder(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [saleOrderId]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  const handlePrint = async () => {
    if (!order) return;
    setPrinting(true);
    try {
      const html = buildInvoiceHtml(order, lines, paymentType, selectedBankName);
      await Print.printAsync({
        html,
      });
    } catch (err) {
      console.error(err);
      Alert.alert(
        'Print',
        err.message || 'Could not open print dialog. Ensure a printer is available (Bluetooth, USB, or Network).'
      );
    } finally {
      setPrinting(false);
    }
  };

  const paymentLabel =
    paymentType === 'bank' && selectedBankName
      ? `Bank: ${selectedBankName}`
      : 'Cash';

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const invoiceDate = order?.date_order
    ? new Date(order.date_order).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Invoice preview */}
      <View style={styles.previewCard}>
        <Text style={styles.companyName}>GasTech</Text>
        <Text style={styles.invoiceTitle}>INVOICE</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Order</Text>
          <Text style={styles.metaValue}>{order?.name ?? '—'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Date</Text>
          <Text style={styles.metaValue}>{invoiceDate}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Customer</Text>
          <Text style={styles.metaValue} numberOfLines={2}>
            {order?.partner_id?.[1] ?? '—'}
          </Text>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.thProduct]}>Product</Text>
          <Text style={[styles.th, styles.thNum]}>Qty</Text>
          <Text style={[styles.th, styles.thNum]}>Total</Text>
        </View>
        {(lines || []).map((line) => (
          <View key={line.id} style={styles.tableRow}>
            <Text style={[styles.td, styles.tdProduct]} numberOfLines={1}>
              {line.product_id?.[1] ?? '—'}
            </Text>
            <Text style={[styles.td, styles.tdNum]}>{line.product_uom_qty}</Text>
            <Text style={[styles.td, styles.tdNum]}>
              {formatCurrency(line.price_total)}
            </Text>
          </View>
        ))}

        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>
              {formatCurrency(order?.amount_untaxed)}
            </Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Tax</Text>
            <Text style={styles.totalsValue}>
              {formatCurrency(order?.amount_tax)}
            </Text>
          </View>
          <View style={[styles.totalsRow, styles.totalsRowMain]}>
            <Text style={styles.totalsLabelMain}>Total</Text>
            <Text style={styles.totalsValueMain}>
              {formatCurrency(order?.amount_total ?? total)}
            </Text>
          </View>
        </View>
        <View style={styles.paymentBadge}>
          <Text style={styles.paymentText}>Payment: {paymentLabel}</Text>
        </View>
      </View>

      {/* Print invoice button */}
      <TouchableOpacity
        style={styles.printBtn}
        onPress={handlePrint}
        disabled={printing}
        activeOpacity={0.8}
      >
        {printing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="print-outline" size={24} color="#fff" />
            <Text style={styles.printBtnText}>Print invoice</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Printer connection note */}
      <View style={styles.printerNote}>
        <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
        <View style={styles.printerNoteTextWrap}>
          <Text style={styles.printerNoteTitle}>Connect to printer</Text>
          <Text style={styles.printerNoteText}>
            To use a Zebra or other thermal printer: connect it via Bluetooth, USB, or
            Wi‑Fi. It will appear in your device's printers when you tap "Print invoice".
            {Platform.OS === 'android'
              ? ' Add printers in Settings → Connected devices → Connection preferences → Printing.'
              : ' On iOS use AirPrint-compatible printers.'}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.doneBtn}
        onPress={() =>
          navigation.reset({
            index: 0,
            routes: [{ name: 'Main', params: { screen: 'Dashboard' } }],
          })
        }
        activeOpacity={0.8}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

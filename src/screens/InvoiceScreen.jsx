import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB, runSync } from '../services/sync.service';

function formatCurrency(amount) {
  return `LKR ${Number(amount).toFixed(2)}`;
}

/** Simple amount in words for LKR (whole part only). */
function amountInWords(num) {
  const n = Math.floor(Number(num));
  if (n === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  if (n < 10) return ones[n];
  if (n < 20) return teens[n - 10];
  if (n < 100) return (tens[Math.floor(n / 10)] + ' ' + ones[n % 10]).trim();
  if (n < 1000) return (ones[Math.floor(n / 100)] + ' Hundred ' + amountInWords(n % 100)).trim();
  if (n < 100000) return (amountInWords(Math.floor(n / 1000)) + ' Thousand ' + amountInWords(n % 1000)).trim();
  if (n < 10000000) return (amountInWords(Math.floor(n / 100000)) + ' Lakh ' + amountInWords(n % 100000)).trim();
  return (amountInWords(Math.floor(n / 10000000)) + ' Crore ' + amountInWords(n % 10000000)).trim();
}

function buildInvoiceHtml(order, lines, paymentType, selectedBankName, paymentSplit, logoUri) {
  const date = order?.date_order
    ? new Date(order.date_order).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const customerName = (order?.partner_id?.[1] ?? '—').replace(/</g, '&lt;');
  const orderNo = order?.name ?? '—';
  const paymentLabel =
    paymentType === 'split' && paymentSplit
      ? [
          paymentSplit.cash > 0 && `Cash ${formatCurrency(paymentSplit.cash)}`,
          paymentSplit.check > 0 && `Check ${formatCurrency(paymentSplit.check)}`,
          paymentSplit.credit > 0 && `Credit ${formatCurrency(paymentSplit.credit)}`,
        ].filter(Boolean).join(' • ') || 'Payment'
      : (paymentType === 'bank' || paymentType === 'check') && selectedBankName
        ? `Check: ${selectedBankName}`
        : paymentType === 'credit' && selectedBankName
          ? `Credit: ${selectedBankName}`
          : (!paymentType && !selectedBankName && !paymentSplit) ? 'Invoiced' : 'Cash';

  const rows =
    (lines || [])
      .map(
        (l, i) =>
          `<tr>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;font-size:9px">${i + 1}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;font-size:9px">${(l.product_id?.[1] ?? '—').replace(/</g, '&lt;').substring(0, 28)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:center;font-size:9px">${Number(l.product_uom_qty ?? 0)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatCurrency(l.price_unit ?? 0)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatCurrency((l.price_subtotal ?? l.price_total) ?? 0)}</td>
          </tr>`
      )
      .join('') || '<tr><td colspan="5" style="padding:8px;text-align:center;font-size:9px">No line items</td></tr>';

  const amountUntaxed = order?.amount_untaxed ?? 0;
  const amountTax = order?.amount_tax ?? 0;
  const amountTotal = order?.amount_total ?? 0;
  const words = amountInWords(amountTotal) + ' Rupees only';

  const logoImg = logoUri
    ? `<img src="${logoUri}" alt="GasTech" style="max-width:56mm;height:auto;display:block;margin:0 auto 6px;" />`
    : '<h1 style="margin:0 0 6px 0;font-size:14px;color:#1e5aa8">GasTech</h1>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=80mm">
  <style>
    body { font-family: system-ui, sans-serif; font-size: 9px; color: #111; padding: 6px 8px; max-width: 80mm; margin: 0 auto; }
    .title { font-size: 11px; font-weight: bold; text-align: center; margin: 4px 0 8px; border: 1px solid #333; padding: 4px; }
    .two-col { display: flex; gap: 8px; margin-bottom: 6px; }
    .col { flex: 1; }
    .field { margin-bottom: 2px; }
    .label { font-weight: 600; color: #444; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 8px; }
    th { text-align: left; padding: 2px 4px; border-bottom: 1px solid #333; }
    th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
    td { padding: 2px 4px; border-bottom: 1px solid #eee; }
    .totals { margin-top: 6px; border-top: 1px solid #333; padding-top: 4px; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .total-row { font-weight: bold; font-size: 10px; margin-top: 4px; }
    .payment { margin-top: 6px; padding: 4px; background: #f4f6f9; font-size: 9px; }
    .footer { margin-top: 8px; font-size: 8px; color: #666; text-align: center; }
  </style>
</head>
<body>
  ${logoImg}
  <div class="title">Tax Invoice</div>
  <div class="two-col">
    <div class="col">
      <div class="field"><span class="label">Date of Invoice:</span> ${date}</div>
      <div class="field"><span class="label">Supplier's TIN:</span> —</div>
      <div class="field"><span class="label">Supplier's Name:</span> GasTech</div>
      <div class="field"><span class="label">Address:</span> —</div>
      <div class="field"><span class="label">Telephone No:</span> —</div>
      <div class="field"><span class="label">Date of Delivery:</span> ${date}</div>
    </div>
    <div class="col">
      <div class="field"><span class="label">Tax Invoice No.:</span> ${orderNo}</div>
      <div class="field"><span class="label">Purchaser's TIN:</span> —</div>
      <div class="field"><span class="label">Purchaser's Name:</span> ${customerName}</div>
      <div class="field"><span class="label">Address:</span> —</div>
      <div class="field"><span class="label">Telephone No:</span> —</div>
      <div class="field"><span class="label">Place of Supply:</span> —</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Ref</th>
        <th>Description of Goods or Services</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount Excl. VAT (Rs.)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Total Value of Supply:</span><span>${formatCurrency(amountUntaxed)}</span></div>
    <div class="row"><span>VAT Amount (18%):</span><span>${formatCurrency(amountTax)}</span></div>
    <div class="row total-row"><span>Total Amount including VAT:</span><span>${formatCurrency(amountTotal)}</span></div>
    <div class="row" style="margin-top:4px"><span>Total Amount in words:</span></div>
    <div class="row" style="font-size:8px;margin-left:0">${words}</div>
    <div class="row" style="margin-top:4px"><span>Mode of Payment:</span><span>${paymentLabel.replace(/</g, '&lt;')}</span></div>
  </div>
  <div class="payment">Thank you for your business</div>
  <div class="footer">GasTech – Your Trusted Business Partner</div>
</body>
</html>`;
}

const LOGO_SOURCE = require('../../assets/images/AppLogo.png');

export default function InvoiceScreen({ route, navigation }) {
  const { colors } = useTheme();
  const logoUri = useMemo(
    () => Image.resolveAssetSource(LOGO_SOURCE)?.uri ?? null,
    []
  );
  const {
    saleOrderId,
    total,
    paymentType,
    selectedBankName,
    paymentSplit,
  } = route.params ?? {};

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [doneState, setDoneState] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

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
        logo: { width: 180, height: 56, marginBottom: 8, alignSelf: 'center' },
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
        syncOverlay: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.xl,
        },
        syncCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.xl,
          padding: spacing.xl * 1.5,
          alignItems: 'center',
          minWidth: 280,
          maxWidth: 320,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        syncIconWrap: {
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: spacing.lg,
        },
        syncTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
        syncSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
        creditStepsCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.lg,
          marginBottom: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        creditStepsTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
        creditStepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
        creditStepCheck: { fontSize: 16 },
        creditStepText: { fontSize: 13, color: colors.text, flex: 1 },
        creditStepNote: { fontSize: 12, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
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

  useEffect(() => {
    if (!saleOrderId) return;
    runSync().catch((err) => console.warn('InvoiceScreen background sync', err?.message ?? err));
  }, [saleOrderId]);

  const handleDone = useCallback(async () => {
    setDoneState('syncing');
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }),
    ]).start();
    try {
      await runSync();
      setDoneState('success');
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Main', params: { screen: 'Dashboard' } }],
        });
      }, 1200);
    } catch (err) {
      setDoneState('offline');
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Main', params: { screen: 'Dashboard' } }],
        });
      }, 1800);
    }
  }, [fadeAnim, scaleAnim, navigation]);

  const handlePrint = async () => {
    if (!order) return;
    setPrinting(true);
    try {
      const html = buildInvoiceHtml(order, lines, paymentType, selectedBankName, paymentSplit, logoUri);
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
    paymentType === 'split' && paymentSplit
      ? [
          paymentSplit.cash > 0 && `Cash ${formatCurrency(paymentSplit.cash)}`,
          paymentSplit.check > 0 && `Check ${formatCurrency(paymentSplit.check)}`,
          paymentSplit.credit > 0 && `Credit ${formatCurrency(paymentSplit.credit)}`,
        ].filter(Boolean).join(' • ') || 'Payment'
      : (paymentType === 'bank' || paymentType === 'check') && selectedBankName
        ? `Check: ${selectedBankName}`
        : paymentType === 'credit' && selectedBankName
          ? `Credit: ${selectedBankName}`
          : (paymentType != null || selectedBankName != null || paymentSplit != null) ? 'Cash' : 'Invoiced';

  const hasCreditPayment = (paymentSplit?.credit ?? 0) > 0 || paymentType === 'credit';

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
        <Image source={LOGO_SOURCE} style={styles.logo} resizeMode="contain" />
        <Text style={styles.invoiceTitle}>Tax Invoice</Text>
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

      {/* Credit payment: Create invoice → Post invoice → Customer account */}
      {hasCreditPayment && (
        <View style={styles.creditStepsCard}>
          <Text style={styles.creditStepsTitle}>Credit payment flow</Text>
          <View style={styles.creditStepRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={styles.creditStepCheck} />
            <Text style={styles.creditStepText}>Create invoice</Text>
          </View>
          <View style={styles.creditStepRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={styles.creditStepCheck} />
            <Text style={styles.creditStepText}>Post invoice</Text>
          </View>
          <Text style={styles.creditStepNote}>
            Then it automatically appears in the customer account (receivable). When the customer pays later, record the payment against this invoice in Odoo.
          </Text>
        </View>
      )}

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
        onPress={handleDone}
        disabled={!!doneState}
        activeOpacity={0.8}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>

      {doneState && (
        <Animated.View
          style={[
            styles.syncOverlay,
            {
              opacity: fadeAnim,
            },
          ]}
          pointerEvents="box-only"
        >
          <Animated.View style={[styles.syncCard, { transform: [{ scale: scaleAnim }] }]}>
            <View style={styles.syncIconWrap}>
              {doneState === 'syncing' && (
                <ActivityIndicator size="large" color={colors.primary} />
              )}
              {doneState === 'success' && (
                <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
              )}
              {doneState === 'offline' && (
                <Ionicons name="cloud-offline-outline" size={48} color={colors.textSecondary} />
              )}
            </View>
            <Text style={styles.syncTitle}>
              {doneState === 'syncing' && 'Syncing your payment'}
              {doneState === 'success' && 'All synced!'}
              {doneState === 'offline' && 'Saved locally'}
            </Text>
            <Text style={styles.syncSub}>
              {doneState === 'syncing' && 'Pushing to server…'}
              {doneState === 'success' && 'Taking you to dashboard…'}
              {doneState === 'offline' && 'Will sync when you\'re back online.'}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </ScrollView>
  );
}

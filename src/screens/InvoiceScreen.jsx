import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB, runSync } from '../services/sync.service';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';
import { getProductDisplayName } from '../utils/productDisplay';
import { formatAmount } from '../utils/format';

/** Currency in invoice section: "Rs" (e.g. "Rs 944.00"). */
function formatInvoiceCurrency(amount) {
  return `Rs ${formatAmount(amount)}`;
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

function buildInvoiceHtml(order, lines, paymentType, selectedBankName, paymentSplit, logoUri, customerSignatureDataUrl, chequeBankName, checkNumber, invoiceNumber) {
  const date = order?.date_order
    ? new Date(order.date_order).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const customerName = (order?.partner_id?.[1] ?? '—').replace(/</g, '&lt;');
  const customerAddress = [order?.city, order?.partner_phone].filter(Boolean).join(', ').replace(/</g, '&lt;') || '—';
  const customerPhone = (order?.partner_phone ?? '—').replace(/</g, '&lt;');
  const invNo = invoiceNumber ?? order?.name ?? '—';
  const paymentLabel =
    paymentType === 'split' && paymentSplit
      ? [
          paymentSplit.cash > 0 && `Cash ${formatInvoiceCurrency(paymentSplit.cash)}`,
          paymentSplit.check > 0 && `Check ${formatInvoiceCurrency(paymentSplit.check)}`,
          paymentSplit.credit > 0 && `Credit ${formatInvoiceCurrency(paymentSplit.credit)}`,
        ].filter(Boolean).join(' • ') || 'Payment'
      : (paymentType === 'bank' || paymentType === 'check') && selectedBankName
        ? `Check: ${selectedBankName}`
        : paymentType === 'credit' && selectedBankName
          ? `Credit: ${selectedBankName}`
          : (!paymentType && !selectedBankName && !paymentSplit) ? 'Invoiced' : 'Cash';

  const lineAmounts = (lines || []).map((l) => {
    const sub = Number(l.price_subtotal) || 0;
    const total = Number(l.price_total) || 0;
    return { sub, total, tax: total - sub };
  });
  const computedUntaxed = lineAmounts.reduce((s, a) => s + a.sub, 0);
  const computedTax = lineAmounts.reduce((s, a) => s + a.tax, 0);

  const rows =
    (lines || [])
      .map(
        (l, i) => {
          const productName = getProductDisplayName(l.product_id?.[1] ?? '—').replace(/</g, '&lt;').substring(0, 42);
          const lineSub = Number(l.price_subtotal) || 0;
          const lineTotal = Number(l.price_total) || 0;
          const lineTax = lineTotal - lineSub;
          return `<tr>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;font-size:9px">${i + 1}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;font-size:9px">${productName}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:center;font-size:9px">${Number(l.product_uom_qty ?? 0)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatAmount(l.price_unit ?? 0)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatAmount(lineSub)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatAmount(lineTax)}</td>
            <td style="padding:2px 4px;border-bottom:1px solid #eee;text-align:right;font-size:9px">${formatAmount(lineTotal)}</td>
          </tr>`;
        }
      )
      .join('') || '<tr><td colspan="7" style="padding:8px;text-align:center;font-size:9px">No line items</td></tr>';

  const amountUntaxed = (order?.amount_untaxed != null && order.amount_untaxed !== 0) ? order.amount_untaxed : computedUntaxed;
  const amountTax = (order?.amount_tax != null && order.amount_tax !== 0) ? order.amount_tax : computedTax;
  const amountTotal = order?.amount_total ?? (amountUntaxed + amountTax);
  const words = amountInWords(amountTotal) + ' Rupees only';

  const logoImg = logoUri
    ? `<img src="${logoUri}" alt="GasTech" style="max-width:56mm;height:auto;display:block;margin:0 0 6px 0;" />`
    : '<h1 style="margin:0 0 6px 0;font-size:14px;color:#1e5aa8;text-align:left">GasTech</h1>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=80mm">
  <style>
    body { font-family: system-ui, sans-serif; font-size: 9px; color: #111; padding: 6px 6px; max-width: 80mm; margin: 0; }
    .title { font-size: 11px; font-weight: bold; text-align: center; margin: 4px 0 8px; border: 1px solid #333; padding: 4px; }
    .two-col { display: flex; gap: 6px; margin-bottom: 6px; }
    .col { flex: 1; }
    .field { margin-bottom: 2px; }
    .label { font-weight: 600; color: #444; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 8px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; table-layout: auto; }
    th { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ddd; background: #eef2ff; font-weight: 700; color: #374151; }
    th:nth-child(1) { width: 22px; text-align: center; padding-right: 8px; }
    th:nth-child(2) { min-width: 45%; padding-right: 10px; }
    th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(6), th:nth-child(7) { text-align: right; min-width: 36px; padding-left: 10px; }
    td { padding: 8px 6px; border-bottom: 1px solid #eee; }
    td:nth-child(1) { padding-right: 8px; }
    td:nth-child(2) { min-width: 45%; padding-right: 10px; }
    td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7) { text-align: right; padding-left: 10px; }
    tr:last-child td { border-bottom: none; }
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
      <div class="field"><span class="label">Tax Invoice No.:</span> ${invNo}</div>
      <div class="field"><span class="label">Purchaser's TIN:</span> —</div>
      <div class="field"><span class="label">Purchaser's Name:</span> ${customerName}</div>
      <div class="field"><span class="label">Address:</span> ${customerAddress}</div>
      <div class="field"><span class="label">Telephone No:</span> ${customerPhone}</div>
      <div class="field"><span class="label">Place of Supply:</span> —</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Description of Goods or Services</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount Excl. VAT (Rs.)</th>
        <th>VAT (Rs.)</th>
        <th>Total (Rs.)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Total Value of Supply:</span><span>${formatInvoiceCurrency(amountUntaxed)}</span></div>
    <div class="row"><span>VAT Amount (18%):</span><span>${formatInvoiceCurrency(amountTax)}</span></div>
    <div class="row total-row"><span>Total Amount including VAT:</span><span>${formatInvoiceCurrency(amountTotal)}</span></div>
    <div class="row" style="margin-top:4px"><span>Total Amount in words:</span></div>
    <div class="row" style="font-size:8px;margin-left:0">${words}</div>
    <div class="row" style="margin-top:4px"><span>Mode of Payment:</span><span>${paymentLabel.replace(/</g, '&lt;')}</span></div>
    ${(chequeBankName || checkNumber) ? `
    <div class="row" style="margin-top:2px"><span>Bank (Cheque):</span><span>${(chequeBankName || '—').replace(/</g, '&lt;')}</span></div>
    <div class="row" style="margin-top:2px"><span>Cheque No.:</span><span>${(checkNumber || '—').replace(/</g, '&lt;')}</span></div>
    ` : ''}
  </div>
  <div class="payment">Thank you for your business</div>
  ${customerSignatureDataUrl ? `
  <div class="signature-section" style="margin-top:8px;padding-top:6px;border-top:1px solid #ddd;">
    <div class="label" style="font-size:9px;font-weight:600;color:#444;margin-bottom:4px;">Customer signature</div>
    <img src="${customerSignatureDataUrl}" alt="Customer signature" style="max-width:50mm;height:auto;max-height:25mm;display:block;" />
  </div>
  ` : ''}
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
    chequeBankName,
    checkNumber,
    paymentSplit,
    customerSignatureDataUrl,
  } = route.params ?? {};

  const { setHideSyncIndicator } = useSync();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [invoiceNumber, setInvoiceNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState(null);
  const [printError, setPrintError] = useState(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl + 60 },
        center: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        },
        previewCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.sm,
          marginBottom: spacing.lg,
          elevation: 2,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          alignSelf: 'stretch',
        },
        logo: { width: 80, height: 56, marginBottom: 6, alignSelf: 'flex-start' },
        invoiceTitle: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
        metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, alignItems: 'flex-start' },
        metaLabel: { fontSize: 12, color: colors.textSecondary, minWidth: 72 },
        metaValue: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1, marginLeft: 4 },
        tableWrapper: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          marginTop: spacing.sm,
          overflow: 'hidden',
        },
        tableHeader: {
          flexDirection: 'row',
          backgroundColor: colors.primarySurface || '#eef2ff',
          paddingVertical: 10,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        th: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
        thNo: { width: 26, textAlign: 'center', marginRight: 8 },
        thProduct: { flex: 2.5, paddingRight: 12, minWidth: 100 },
        thQty: { flex: 0.7, minWidth: 36, textAlign: 'right', marginLeft: 4 },
        thTax: { flex: 0.9, minWidth: 44, textAlign: 'right', marginLeft: 4 },
        thTotal: { flex: 1, minWidth: 52, textAlign: 'right', marginLeft: 8 },
        tableRow: {
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          paddingVertical: 10,
          paddingHorizontal: 8,
          alignItems: 'center',
        },
        tableRowLast: { borderBottomWidth: 0 },
        td: { fontSize: 13, color: colors.text },
        tdNo: { width: 26, textAlign: 'center', fontSize: 13, color: colors.text, marginRight: 8 },
        tdProduct: { flex: 2.5, paddingRight: 12, minWidth: 100 },
        tdQty: { flex: 0.7, minWidth: 36, textAlign: 'right', marginLeft: 4 },
        tdTax: { flex: 0.9, minWidth: 44, textAlign: 'right', marginLeft: 4 },
        tdTotal: { flex: 1, minWidth: 52, textAlign: 'right', marginLeft: 8 },
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
        printOverlay: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 20,
        },
        printOverlayText: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: spacing.md },
        resultModalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        },
        resultModalCard: {
          backgroundColor: '#fff',
          borderRadius: 20,
          paddingVertical: 28,
          paddingHorizontal: 32,
          alignItems: 'center',
          minWidth: 280,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.15,
          shadowRadius: 24,
          elevation: 12,
        },
        resultModalIconWrap: { marginBottom: 16 },
        resultModalTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 8, textAlign: 'center' },
        resultModalSub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
        resultModalBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
        resultModalBtn: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 14,
          borderRadius: 12,
        },
        resultModalBtnPrimary: { backgroundColor: colors.primary },
        resultModalBtnSecondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
        resultModalBtnTextPrimary: { fontSize: 16, fontWeight: '700', color: '#fff' },
        resultModalBtnTextSecondary: { fontSize: 16, fontWeight: '700', color: colors.primary },
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
      const invNo = route.params?.invoiceNumber ?? await getOrAssignInvoiceNumber(saleOrderId);
      setInvoiceNumber(invNo);
      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      setOrder(data.order);
      setLines(data.lines ?? []);
    } catch (_) {
      setOrder(null);
      setLines([]);
      setInvoiceNumber(null);
    } finally {
      setLoading(false);
    }
  }, [saleOrderId, route.params?.invoiceNumber]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  useEffect(() => {
    setHideSyncIndicator(true);
    return () => setHideSyncIndicator(false);
  }, [setHideSyncIndicator]);

  const handlePrint = useCallback(async () => {
    if (!order) return;
    setPrinting(true);
    setPrintResult(null);
    setPrintError(null);
    try {
      const html = buildInvoiceHtml(order, lines, paymentType, selectedBankName, paymentSplit, logoUri, customerSignatureDataUrl, chequeBankName, checkNumber, invoiceNumber);
      await Print.printAsync({ html });
      setPrintResult('success');
    } catch (err) {
      console.error(err);
      setPrintResult('failed');
      setPrintError(err?.message || 'Could not print. Ensure a printer is available (Bluetooth, USB, or Network).');
    } finally {
      setPrinting(false);
      setHideSyncIndicator(false);
      runSync().catch((e) => console.warn('[InvoiceScreen] sync after print', e?.message ?? e));
    }
  }, [order, lines, invoiceNumber, paymentType, selectedBankName, paymentSplit, logoUri, customerSignatureDataUrl, chequeBankName, checkNumber]);

  const goToHome = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Dashboard' });
  }, [navigation]);

  /** Subtotal from lines: sum of price_subtotal */
  const computedSubtotal = useMemo(() => {
    if (!lines?.length) return 0;
    return lines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
  }, [lines]);

  /** Tax from lines: sum of (price_total - price_subtotal) per line */
  const computedTax = useMemo(() => {
    if (!lines?.length) return 0;
    return lines.reduce(
      (sum, l) => sum + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)),
      0
    );
  }, [lines]);

  const displaySubtotal = (order?.amount_untaxed != null && order.amount_untaxed !== 0)
    ? order.amount_untaxed
    : computedSubtotal;
  const displayTax = (order?.amount_tax != null && order.amount_tax !== 0)
    ? order.amount_tax
    : computedTax;
  const displayTotal = order?.amount_total ?? total ?? (displaySubtotal + displayTax);

  const paymentLabel =
    paymentType === 'split' && paymentSplit
      ? [
          paymentSplit.cash > 0 && `Cash ${formatInvoiceCurrency(paymentSplit.cash)}`,
          paymentSplit.check > 0 && `Check ${formatInvoiceCurrency(paymentSplit.check)}`,
          paymentSplit.credit > 0 && `Credit ${formatInvoiceCurrency(paymentSplit.credit)}`,
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
          <Text style={styles.metaLabel}>Invoice No.</Text>
          <Text style={styles.metaValue}>{invoiceNumber ?? '—'}</Text>
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
        {(order?.city || order?.partner_phone) ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Address</Text>
            <Text style={styles.metaValue} numberOfLines={2}>
              {[order?.city, order?.partner_phone].filter(Boolean).join(', ')}
            </Text>
          </View>
        ) : null}

        <View style={styles.tableWrapper}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.thNo]}>No</Text>
            <Text style={[styles.th, styles.thProduct]}>Product</Text>
            <Text style={[styles.th, styles.thQty]}>Qty</Text>
            <Text style={[styles.th, styles.thTax]}>Tax</Text>
            <Text style={[styles.th, styles.thTotal]}>Total</Text>
          </View>
          {(lines || []).map((line, index) => {
            const lineSubtotal = Number(line.price_subtotal) || 0;
            const lineTotal = Number(line.price_total) || 0;
            const lineTax = lineTotal - lineSubtotal;
            return (
              <View
                key={line.id}
                style={[styles.tableRow, index === (lines?.length ?? 0) - 1 && styles.tableRowLast]}
              >
                <Text style={[styles.td, styles.tdNo]}>{index + 1}</Text>
                <Text style={[styles.td, styles.tdProduct]} numberOfLines={2}>
                  {getProductDisplayName(line.product_id?.[1] ?? '—')}
                </Text>
                <Text style={[styles.td, styles.tdQty]}>{line.product_uom_qty}</Text>
                <Text style={[styles.td, styles.tdTax]}>{formatAmount(lineTax)}</Text>
                <Text style={[styles.td, styles.tdTotal]}>
                  {formatAmount(lineTotal)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>
              {formatInvoiceCurrency(displaySubtotal)}
            </Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Tax</Text>
            <Text style={styles.totalsValue}>
              {formatInvoiceCurrency(displayTax)}
            </Text>
          </View>
          <View style={[styles.totalsRow, styles.totalsRowMain]}>
            <Text style={styles.totalsLabelMain}>Total</Text>
            <Text style={styles.totalsValueMain}>
              {formatInvoiceCurrency(displayTotal)}
            </Text>
          </View>
        </View>
        <View style={styles.paymentBadge}>
          <Text style={styles.paymentText}>Payment: {paymentLabel}</Text>
        </View>
        {customerSignatureDataUrl ? (
          <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.totalsLabel, { marginBottom: 4 }]}>Customer signature</Text>
            <Image source={{ uri: customerSignatureDataUrl }} style={{ width: '100%', maxWidth: 180, height: 70, resizeMode: 'contain' }} />
          </View>
        ) : null}
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

      {/* Print invoice button - hidden after print so modal offers Re-print */}
      {printResult == null && (
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
      )}

      {/* Printing overlay - full screen until print request completes */}
      {printing && (
        <View style={styles.printOverlay} pointerEvents="box-only">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.printOverlayText}>Printing…</Text>
        </View>
      )}

      {/* After print: modal with Re-print or Go to home */}
      <Modal
        visible={printResult != null && !printing}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPrintResult(null)}
      >
        <View style={styles.resultModalBackdrop}>
          <View style={styles.resultModalCard}>
            <View style={styles.resultModalIconWrap}>
              {printResult === 'success' && (
                <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
              )}
              {printResult === 'failed' && (
                <Ionicons name="alert-circle" size={56} color="#ef4444" />
              )}
            </View>
            <Text style={styles.resultModalTitle}>
              {printResult === 'success' ? 'Print sent' : 'Print failed'}
            </Text>
            <Text style={styles.resultModalSub}>
              {printResult === 'success'
                ? 'Invoice sent to printer.'
                : (printError || 'Could not print.')}
            </Text>
            <View style={styles.resultModalBtnRow}>
              <TouchableOpacity
                style={[styles.resultModalBtn, styles.resultModalBtnPrimary]}
                onPress={() => {
                  setPrintResult(null);
                  setPrintError(null);
                  handlePrint();
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="print-outline" size={22} color="#fff" />
                <Text style={styles.resultModalBtnTextPrimary}>Re-print</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultModalBtn, styles.resultModalBtnSecondary]}
                onPress={goToHome}
                activeOpacity={0.8}
              >
                <Ionicons name="home-outline" size={22} color={colors.primary} />
                <Text style={styles.resultModalBtnTextSecondary}>Go to home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

    </ScrollView>
  );
}

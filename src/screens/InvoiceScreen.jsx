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
  PermissionsAndroid,
  NativeModules,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB, runSync } from '../services/sync.service';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';
import { getProductDisplayName } from '../utils/productDisplay';
import { formatAmount } from '../utils/format';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as localPaymentsDb from '../database/localPayments.js';
import { callOdoo } from '../services/index.service';

/** Currency in invoice section: "Rs" (e.g. "Rs 944.00"). */
function formatInvoiceCurrency(amount) {
  return `Rs ${formatAmount(amount)}`;
}

/** Avoid rendering boolean false or empty as "false"; return safe string or — for print. */
function safeDisplay(val) {
  if (val === undefined || val === null || val === false) return '—';
  const s = String(val).trim();
  return s === '' || s.toLowerCase() === 'false' ? '—' : s;
}

function buildInvoiceHtml(
  order,
  lines,
  paymentType,
  selectedBankName,
  paymentSplit,
  logoUri,
  customerSignatureDataUrl,
  chequeBankName,
  checkNumber,
  invoiceNumber,
  supplierTin = '—',
  purchaserTin = '—',
  partyInfo = {}
) {
  const date = order?.date_order
    ? new Date(order.date_order).toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const customerName = safeDisplay(partyInfo?.customerName || order?.partner_id?.[1]).replace(/</g, '&lt;');
  const streetPart = safeDisplay(order?.street || order?.partner_street || order?.partner_address);
  const cityPart = safeDisplay(partyInfo?.customerCity || order?.city);
  const phonePart = safeDisplay(partyInfo?.customerPhone || order?.partner_phone);
  const customerAddress = [safeDisplay(partyInfo?.customerStreet || streetPart), cityPart]
    .filter((s) => s !== '—')
    .join(', ')
    .replace(/</g, '&lt;') || '—';
  const customerPhone = (phonePart !== '—' ? phonePart : '—').replace(/</g, '&lt;');
  const supplierTinResolved = partyInfo?.supplierTin || supplierTin;
  const purchaserTinResolved = partyInfo?.customerTin || purchaserTin;
  const supplierTinSafe = (supplierTinResolved != null && String(supplierTinResolved).trim()) ? String(supplierTinResolved).trim().replace(/</g, '&lt;') : '';
  const purchaserTinSafe = (purchaserTinResolved != null && String(purchaserTinResolved).trim()) ? String(purchaserTinResolved).trim().replace(/</g, '&lt;') : '';
  const hasSupplierTin = supplierTinSafe !== '';
  const hasPurchaserTin = purchaserTinSafe !== '';
  const supplierName = safeDisplay(partyInfo?.supplierName || 'GasTech').replace(/</g, '&lt;');
  const supplierPhone = safeDisplay(partyInfo?.supplierPhone || '—').replace(/</g, '&lt;');
  const supplierAddress = safeDisplay(partyInfo?.supplierAddress || '—').replace(/</g, '&lt;');
  const chequeAmount = Number(paymentSplit?.check ?? paymentSplit?.cheque ?? 0);
  const invNo = invoiceNumber ?? order?.name ?? '—';
  const paymentLabel =
    paymentType === 'split' && paymentSplit
      ? [
          paymentSplit.cash > 0 && `Cash ${formatInvoiceCurrency(paymentSplit.cash)}`,
          chequeAmount > 0 && `Check ${formatInvoiceCurrency(chequeAmount)}`,
          paymentSplit.credit > 0 && `Amount Due ${formatInvoiceCurrency(paymentSplit.credit)}`,
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
          return `<tr>
            <td style="padding:2px;border-bottom:1px solid #ccc;font-size:8px;font-weight:700">${i + 1}</td>
            <td style="padding:2px;border-bottom:1px solid #ccc;font-size:8px;font-weight:700">${productName}</td>
            <td style="padding:2px 4px 2px 2px;border-bottom:1px solid #ccc;text-align:right;font-size:8px;font-weight:700">${Number(l.product_uom_qty ?? 0)}</td>
            <td style="padding:2px 2px 2px 4px;border-bottom:1px solid #ccc;text-align:right;font-size:8px;font-weight:700">${formatAmount(l.price_unit ?? 0)}</td>
            <td style="padding:2px;border-bottom:1px solid #ccc;text-align:right;font-size:8px;font-weight:700">${formatAmount(lineSub)}</td>
            <td style="padding:2px;border-bottom:1px solid #ccc;text-align:right;font-size:8px;font-weight:700">${formatAmount(lineTotal)}</td>
          </tr>`;
        }
      )
      .join('') || '<tr><td colspan="6" style="padding:4px;text-align:center;font-size:8px;font-weight:700">No line items</td></tr>';

  const amountUntaxed = (order?.amount_untaxed != null && order.amount_untaxed !== 0) ? order.amount_untaxed : computedUntaxed;
  const amountTax = (order?.amount_tax != null && order.amount_tax !== 0) ? order.amount_tax : computedTax;
  const amountTotal = order?.amount_total ?? (amountUntaxed + amountTax);

  const logoImg = logoUri
    ? `<img src="${logoUri}" alt="GasTech" style="max-width:40mm;height:auto;display:block;margin:0 auto 2px auto;" />`
    : '<h1 style="margin:0 0 2px 0;font-size:12px;font-weight:700;color:#1e5aa8;text-align:center">GasTech</h1>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=80mm, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    @page { size: 80mm auto; margin: 3mm; }
    @media print {
      body, .page { width: 80mm !important; max-width: 80mm !important; }
      body { padding: 0 3mm !important; }
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 9px;
      font-weight: 700;
      color: #000;
      margin: 0;
      padding: 4px 6px;
      width: 80mm;
      max-width: 80mm;
      overflow-x: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 74mm; max-width: 100%; margin: 0 auto; }
    .title {
      font-size: 11px;
      font-weight: 700;
      text-align: center;
      margin: 2px 0 4px;
      border: 1px solid #000;
      padding: 3px 6px;
    }
    .two-col { display: flex; gap: 6px; margin-bottom: 4px; line-height: 1.2; }
    .col { flex: 1; min-width: 0; overflow: hidden; }
    .field { margin-bottom: 2px; font-size: 8px; font-weight: 700; word-break: break-word; }
    .label { font-weight: 700; color: #000; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0;
      font-size: 8px;
      font-weight: 700;
      border: 1px solid #000;
      table-layout: fixed;
    }
    th {
      text-align: left;
      padding: 3px 2px;
      border-bottom: 1px solid #000;
      background: #e8e8e8;
      font-weight: 700;
      font-size: 7px;
    }
    th:nth-child(1) { width: 6%; text-align: center; }
    th:nth-child(2) { width: 27%; }
    th:nth-child(3) { width: 9%; text-align: right; padding-right: 4px; }
    th:nth-child(4) { width: 13%; text-align: right; padding-left: 4px; }
    th:nth-child(5) { width: 14%; text-align: right; }
    th:nth-child(6) { width: 14%; text-align: right; }
    th:nth-child(7) { width: 17%; text-align: right; }
    td {
      padding: 3px 2px;
      border-bottom: 1px solid #ccc;
      font-size: 8px;
      font-weight: 700;
      word-break: break-word;
    }
    td:nth-child(1) { text-align: center; }
    td:nth-child(2) { overflow: hidden; text-overflow: ellipsis; }
    td:nth-child(3) { padding-right: 4px; }
    td:nth-child(4) { padding-left: 4px; }
    td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7) { text-align: right; }
    tr:last-child td { border-bottom: none; }
    .totals { margin-top: 3px; border-top: 1px solid #000; padding-top: 3px; font-size: 7px; font-weight: 700; }
    .row { display: flex; justify-content: space-between; margin: 1px 0; align-items: flex-start; gap: 4px; }
    .total-row { font-weight: 700; font-size: 8px; margin-top: 1px; }
    .payment { margin-top: 4px; padding: 4px; background: #e8e8e8; font-size: 8px; font-weight: 700; text-align: center; }
    .footer { margin-top: 6px; font-size: 8px; font-weight: 700; color: #333; text-align: center; }
    .powered { margin-top: 2px; font-size: 8px; font-weight: 700; font-style: italic; color: #111; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
  ${logoImg}
  <div class="title">Tax Invoice</div>
  <div class="two-col">
    <div class="col">
      <div class="field"><span class="label">Invoice No.:</span>  ${invNo}</div>
      ${hasSupplierTin ? `<div class="field"><span class="label">Suppliers TIN:</span> ${supplierTinSafe}</div>` : ''}
      <div class="field"><span class="label">Supplier Name:</span> ${supplierName}</div>
      <div class="field"><span class="label">Address:</span> ${supplierAddress}</div>
      <div class="field"><span class="label">Telephone No:</span> ${supplierPhone}</div>
      <div class="field"><span class="label">Date of Delivery:</span> ${date}</div>
    </div>
    <div class="col">
      <div class="field"><span class="label">Date of Invoice :</span> ${date}</div>
      ${hasPurchaserTin ? `<div class="field"><span class="label">Customer TIN:</span> ${purchaserTinSafe}</div>` : ''}
      <div class="field"><span class="label">Customer Name:</span> ${customerName}</div>
      <div class="field"><span class="label">Address:</span> ${customerAddress}</div>
      <div class="field"><span class="label">Telephone No:</span> ${customerPhone}</div>
      <div class="field"><span class="label">Place of Supply:</span> ${cityPart !== '—' ? cityPart.replace(/</g, '&lt;') : '—'}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount </th>
        <th>Total </th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Gross Amount:</span><span>${formatInvoiceCurrency(amountUntaxed)}</span></div>
    <div class="row"><span>VAT (18%):</span><span>${formatInvoiceCurrency(amountTax)}</span></div>
    <div class="row total-row"><span>Net Amount:</span><span>${formatInvoiceCurrency(amountTotal)}</span></div>
    <div class="row" style="margin-top:2px"><span>Mode of Payment:</span><span>${paymentLabel.replace(/</g, '&lt;')}</span></div>
    ${(chequeBankName || checkNumber) ? `
    <div class="row" style="margin-top:1px"><span>Bank (Cheque):</span><span>${(chequeBankName || '—').replace(/</g, '&lt;')}</span></div>
    <div class="row" style="margin-top:1px"><span>Cheque No.:</span><span>${(checkNumber || '—').replace(/</g, '&lt;')}</span></div>
    ` : ''}
  </div>
  <div class="payment">Thank you for your business</div>
  ${customerSignatureDataUrl ? `
  <div class="signature-section" style="margin-top:4px;padding-top:4px;border-top:1px solid #000;">
    <div class="label" style="font-size:8px;font-weight:700;color:#000;margin-bottom:2px;">Customer signature</div>
    <img src="${customerSignatureDataUrl}" alt="Signature" style="max-width:45mm;height:auto;max-height:20mm;display:block;" />
  </div>
  ` : ''}
  <div class="footer">GasTech – Your Trusted Business Partner</div>
  <div class="powered">Powered by everestx.com</div>
  </div>
</body>
</html>`;
}

const LOGO_SOURCE = require('../../assets/images/AppLogo.png');
const LAST_USED_PRINTER_ADDRESS_KEY = 'last_printer_address';

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
    supplierTin,
    purchaserTin,
  } = route.params ?? {};

  const { setHideSyncIndicator } = useSync();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [invoiceNumber, setInvoiceNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState(null);
  const [printError, setPrintError] = useState(null);
  const [localPaymentSplit, setLocalPaymentSplit] = useState(null);
  const [localChequeMeta, setLocalChequeMeta] = useState({ bankName: null, checkNumber: null });
  const [partyInfo, setPartyInfo] = useState({});
  const [localInvoice, setLocalInvoice] = useState(null);
  const [printerAddress, setPrinterAddress] = useState(null);

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
      const split = await localPaymentsDb.getPaymentSplitBySaleOrderId(saleOrderId);
      setLocalPaymentSplit(split || { cash: 0, cheque: 0, credit: 0 });
      const paymentRows = await localPaymentsDb.getLocalPaymentsBySaleOrderId(saleOrderId);
      const chequeRow = [...(paymentRows || [])].reverse().find((p) => String(p.payment_type || '').toLowerCase() === 'cheque');
      setLocalChequeMeta({
        bankName: chequeRow?.bank_name || null,
        checkNumber: chequeRow?.check_number || null,
      });

      // Load locally saved invoice metadata for offline preview/printing.
      try {
        const localInv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(saleOrderId);
        setLocalInvoice(localInv);
      } catch (e) {
        setLocalInvoice(null);
      }

      // Fetch supplier(company) and customer details for printed invoice.
      let nextPartyInfo = {};
      try {
        const companyRows = await callOdoo('res.company', 'read', [[1]], {
          fields: ['name', 'phone', 'vat', 'partner_id'],
        });
        const company = Array.isArray(companyRows) ? companyRows[0] : null;
        const companyPartnerId = Array.isArray(company?.partner_id) ? company.partner_id[0] : null;
        let companyStreet = '';
        let companyCity = '';
        if (companyPartnerId != null) {
          const companyPartnerRows = await callOdoo('res.partner', 'read', [[companyPartnerId]], {
            fields: ['street', 'street2', 'city'],
          });
          const cp = Array.isArray(companyPartnerRows) ? companyPartnerRows[0] : null;
          companyStreet = [cp?.street, cp?.street2].filter(Boolean).join(', ');
          companyCity = cp?.city || '';
        }

        const customerPartnerId = Array.isArray(data?.order?.partner_id) ? data.order.partner_id[0] : null;
        let customerRows = [];
        if (customerPartnerId != null) {
          customerRows = await callOdoo('res.partner', 'read', [[customerPartnerId]], {
            fields: ['name', 'phone', 'street', 'street2', 'city', 'vat'],
          });
        }
        const customer = Array.isArray(customerRows) ? customerRows[0] : null;

        nextPartyInfo = {
          supplierName: company?.name || null,
          supplierPhone: company?.phone || null,
          supplierTin: company?.vat || null,
          supplierAddress: [companyStreet, companyCity].filter(Boolean).join(', ') || null,
          customerName: customer?.name || null,
          customerPhone: customer?.phone || null,
          customerTin: customer?.vat || null,
          customerStreet: [customer?.street, customer?.street2].filter(Boolean).join(', ') || null,
          customerCity: customer?.city || null,
        };
      } catch (_) {
        nextPartyInfo = {};
      }
      setPartyInfo(nextPartyInfo);
    } catch (_) {
      setOrder(null);
      setLines([]);
      setInvoiceNumber(null);
      setLocalPaymentSplit(null);
      setLocalChequeMeta({ bankName: null, checkNumber: null });
      setPartyInfo({});
      setLocalInvoice(null);
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
      const effectiveSplitForPrint =
        paymentType === 'split' && paymentSplit ? paymentSplit : (localPaymentSplit || paymentSplit);

      const resolvedChequeBankName = chequeBankName || selectedBankName || localChequeMeta.bankName || null;
      const resolvedChequeNumber = checkNumber || localChequeMeta.checkNumber || null;

      const rnfsManager = NativeModules?.RNFSManager;
      const thermalAvailable = !!rnfsManager;
      console.log('[InvoiceScreen] RNFSManager:', rnfsManager ? 'present' : 'null');
      if (!thermalAvailable) {
        // If user runs Expo Go (or an APK that wasn't rebuilt with native modules),
        // RNFSManager will be null and Bluetooth thermal printing can't work.
        throw new Error(
          'Thermal Bluetooth printing requires a Development Build (native modules). Please install/run from expo dev-client / development build (not Expo Go).'
        );
      }

      // Thermal printing (native modules present)
      const thermalModule = await import('@finan-me/react-native-thermal-printer');
      const { ThermalPrinter } = thermalModule;

      const supplierTinResolved = localInvoice?.supplier_tin ?? partyInfo?.supplierTin ?? supplierTin ?? '—';
      const purchaserTinResolved = localInvoice?.purchaser_tin ?? partyInfo?.customerTin ?? purchaserTin ?? '—';

      // Use stored signature file first; otherwise persist dataUrl (for invoices created before this schema change).
      let signatureFilePath = localInvoice?.customer_signature_file_path ?? null;
      if (!signatureFilePath && customerSignatureDataUrl && typeof customerSignatureDataUrl === 'string') {
        const match = customerSignatureDataUrl.match(/^data:([^;]+);base64,(.*)$/);
        const mimeType = match?.[1] || 'image/png';
        const base64 = match?.[2];
        if (base64) {
          const ext = mimeType.includes('jpg') ? 'jpg' : 'png';
          const fileName = `customer_signature_${saleOrderId}_${Date.now()}.${ext}`;
          const fileUri = `${FileSystem.documentDirectory}${fileName}`;
          await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
          signatureFilePath = fileUri;
        }
      }

      // Resolve printer address: saved last printer, else scan and pick first paired/found device.
      let address = printerAddress || (await AsyncStorage.getItem(LAST_USED_PRINTER_ADDRESS_KEY));
      if (!address) {
        if (Platform.OS === 'android') {
          if (Platform.Version >= 31) {
            await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            ]);
          } else {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          }
        }

        const scanResult = await ThermalPrinter.scanDevices();
        const pick = scanResult?.paired?.[0] || scanResult?.found?.[0];
        if (!pick?.address) throw new Error('No Bluetooth printer found. Turn on the printer and try again.');

        address = pick.address;
        setPrinterAddress(address);
        await AsyncStorage.setItem(LAST_USED_PRINTER_ADDRESS_KEY, address);
      }

      const test = await ThermalPrinter.testConnection(address);
      if (!test?.success) {
        throw new Error(test?.error?.message || 'Printer connection test failed.');
      }

      const invoiceDate = order?.date_order
        ? new Date(order.date_order).toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: 'numeric' })
        : new Date().toLocaleDateString('en-LK');

      const computedUntaxed = (lines || []).reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
      const computedTax = (lines || []).reduce(
        (sum, l) => sum + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)),
        0
      );
      const amountUntaxed = order?.amount_untaxed != null && order.amount_untaxed !== 0 ? Number(order.amount_untaxed) : computedUntaxed;
      const amountTax = order?.amount_tax != null && order.amount_tax !== 0 ? Number(order.amount_tax) : computedTax;
      const amountTotal = order?.amount_total ?? (amountUntaxed + amountTax);

      const paymentLabel =
        paymentType === 'split' && effectiveSplitForPrint
          ? [
              effectiveSplitForPrint.cash > 0 && `Cash ${formatInvoiceCurrency(effectiveSplitForPrint.cash)}`,
              (effectiveSplitForPrint.check > 0 || effectiveSplitForPrint.cheque > 0) &&
                `Cheque ${formatInvoiceCurrency(effectiveSplitForPrint.check || effectiveSplitForPrint.cheque || 0)}`,
              effectiveSplitForPrint.credit > 0 && `Credit ${formatInvoiceCurrency(effectiveSplitForPrint.credit)}`,
            ]
              .filter(Boolean)
              .join(' • ') || 'Payment'
          : paymentType === 'bank' && selectedBankName
            ? `Check: ${selectedBankName}`
            : paymentType === 'credit' && selectedBankName
              ? `Credit: ${selectedBankName}`
              : (paymentType != null || selectedBankName != null || paymentSplit != null) ? 'Cash' : 'Invoiced';

      const lineRows = (lines || []).map((l) => {
        const productName = getProductDisplayName(l.product_id?.[1] ?? '—');
        const qty = String(Number(l.product_uom_qty ?? 0));
        const total = formatAmount(Number(l.price_total) || 0);
        return [{ text: productName, style: { wrap: true } }, qty, total];
      });

      const receiptNodes = [];
      receiptNodes.push({ type: 'text', content: 'GasTech', style: { align: 'center', bold: true, size: 2 } });
      receiptNodes.push({ type: 'text', content: 'TAX INVOICE', style: { align: 'center', bold: true } });
      receiptNodes.push({ type: 'line' });
      receiptNodes.push({
        type: 'columns',
        columns: [
          { content: `Inv: ${invoiceNumber ?? '—'}`, width: 20, align: 'left' },
          { content: invoiceDate, width: 34, align: 'right' },
        ],
      });
      receiptNodes.push({ type: 'line' });
      receiptNodes.push({ type: 'text', content: `Customer: ${order?.partner_id?.[1] ?? '—'}`, style: { bold: true } });
      if (purchaserTinResolved && purchaserTinResolved !== '—') {
        receiptNodes.push({ type: 'text', content: `Customer TIN: ${purchaserTinResolved}`, style: { bold: true } });
      }
      if (supplierTinResolved && supplierTinResolved !== '—') {
        receiptNodes.push({ type: 'text', content: `Supplier TIN: ${supplierTinResolved}`, style: { bold: true } });
      }
      receiptNodes.push({ type: 'line' });
      receiptNodes.push({
        type: 'table',
        headers: ['Item', 'Qty', 'Total'],
        rows: lineRows,
        columnWidths: [28, 8, 12],
        alignments: ['left', 'right', 'right'],
        wrapCells: true,
      });
      receiptNodes.push({ type: 'line' });
      receiptNodes.push({ type: 'text', content: `Gross: Rs ${formatAmount(amountUntaxed)}`, style: { align: 'right', bold: true } });
      receiptNodes.push({ type: 'text', content: `VAT: Rs ${formatAmount(amountTax)}`, style: { align: 'right', bold: true } });
      receiptNodes.push({ type: 'text', content: `NET: Rs ${formatAmount(amountTotal)}`, style: { align: 'right', bold: true, size: 2 } });
      receiptNodes.push({ type: 'line' });
      receiptNodes.push({ type: 'text', content: `Payment: ${paymentLabel}`, style: { align: 'center', bold: true } });
      if (resolvedChequeBankName) receiptNodes.push({ type: 'text', content: `Bank: ${resolvedChequeBankName}` });
      if (resolvedChequeNumber) receiptNodes.push({ type: 'text', content: `Cheque No: ${resolvedChequeNumber}` });

      if (signatureFilePath) {
        receiptNodes.push({ type: 'line' });
        receiptNodes.push({ type: 'text', content: 'Customer Signature', style: { align: 'center', bold: true } });
        receiptNodes.push({ type: 'image', imagePath: signatureFilePath, options: { align: 'center', marginMm: 2 } });
      }

      receiptNodes.push({ type: 'feed', lines: 2 });
      receiptNodes.push({ type: 'cut' });

      const job = {
        printers: [
          {
            address,
            copies: 1,
            options: { paperWidthMm: 58, encoding: 'CP1258', marginMm: 1 },
          },
        ],
        documents: [receiptNodes],
        options: { concurrent: false, continueOnError: false },
      };

      const result = await ThermalPrinter.printReceipt(job);
      const addrResult = result?.results?.get ? result.results.get(address) : null;
      const ok = !!(result?.success || addrResult?.success);
      if (!ok) {
        const msg = addrResult?.error?.message || 'Thermal printing failed.';
        throw new Error(msg);
      }

      setPrintResult('success');
    } catch (err) {
      console.error(err);
      setPrintResult('failed');
      setPrintError(err?.message || 'Could not print. Ensure Bluetooth printer is connected and permissions are granted.');
    } finally {
      setPrinting(false);
      setHideSyncIndicator(false);
      runSync().catch((e) => console.warn('[InvoiceScreen] sync after print', e?.message ?? e));
    }
  }, [
    order,
    lines,
    saleOrderId,
    invoiceNumber,
    paymentType,
    selectedBankName,
    paymentSplit,
    localPaymentSplit,
    customerSignatureDataUrl,
    chequeBankName,
    checkNumber,
    localChequeMeta.bankName,
    localChequeMeta.checkNumber,
    supplierTin,
    purchaserTin,
    partyInfo,
    localInvoice,
    printerAddress,
  ]);

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

  const effectivePaymentSplit = (paymentType === 'split' && paymentSplit)
    ? paymentSplit
    : localPaymentSplit;

  const paymentLabel =
    (paymentType === 'split' && effectivePaymentSplit)
      ? [
          effectivePaymentSplit.cash > 0 && `Cash ${formatInvoiceCurrency(effectivePaymentSplit.cash)}`,
          (effectivePaymentSplit.check > 0 || effectivePaymentSplit.cheque > 0) &&
            `Cheque ${formatInvoiceCurrency(effectivePaymentSplit.check || effectivePaymentSplit.cheque || 0)}`,
          effectivePaymentSplit.credit > 0 && `Credit ${formatInvoiceCurrency(effectivePaymentSplit.credit)}`,
        ].filter(Boolean).join(' • ') || 'Payment'
      : (paymentType === 'bank' || paymentType === 'check') && selectedBankName
        ? `Check: ${selectedBankName}`
        : paymentType === 'credit' && selectedBankName
          ? `Credit: ${selectedBankName}`
          : (paymentType != null || selectedBankName != null || paymentSplit != null) ? 'Cash' : 'Invoiced';

  const hasCreditPayment = (effectivePaymentSplit?.credit ?? 0) > 0 || paymentType === 'credit';

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
        {(safeDisplay(order?.city) !== '—' || safeDisplay(order?.partner_phone) !== '—') ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Address</Text>
            <Text style={styles.metaValue} numberOfLines={2}>
              {[safeDisplay(order?.city), safeDisplay(order?.partner_phone)].filter((s) => s !== '—').join(', ') || '—'}
            </Text>
          </View>
        ) : null}

        <View style={styles.tableWrapper}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.thNo]}>No</Text>
            <Text style={[styles.th, styles.thProduct]}>Product</Text>
            <Text style={[styles.th, styles.thQty]}>Qty</Text>
            <Text style={[styles.th, styles.thTax]}>Unit Price</Text>
            <Text style={[styles.th, styles.thTotal]}>Total</Text>
          </View>
          {(lines || []).map((line, index) => {
            const lineTotal = Number(line.price_total) || 0;
            const lineUnitPrice = Number(line.price_unit) || 0;
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
                <Text style={[styles.td, styles.tdTax]}>{formatAmount(lineUnitPrice)}</Text>
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
            <Text style={styles.totalsLabel}>VAT</Text>
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
        {(localInvoice?.customer_signature_file_path || customerSignatureDataUrl) ? (
          <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.totalsLabel, { marginBottom: 4 }]}>Customer signature</Text>
            <Image
              source={{ uri: localInvoice?.customer_signature_file_path || customerSignatureDataUrl }}
              style={{ width: '100%', maxWidth: 180, height: 70, resizeMode: 'contain' }}
            />
          </View>
        ) : null}
      </View>

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
          <Text style={styles.printerNoteTitle}>Thermal printer</Text>
          <Text style={styles.printerNoteText}>
            This screen uses Bluetooth thermal printing. Keep your printer turned on (and in range), then tap
            "Print invoice". The app will scan for paired printers and connect automatically.
          </Text>
        </View>
      </View>

    </ScrollView>
  );
}

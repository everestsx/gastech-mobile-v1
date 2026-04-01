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
  Alert,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { spacing, borderRadius } from '../constants/theme';
import { getSaleOrderDetailsFromDB, runSync } from '../services/sync.service';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';
import { getProductDisplayName } from '../utils/productDisplay';
import { formatAmount } from '../utils/format';
import * as localPaymentsDb from '../database/localPayments.js';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import { callOdoo } from '../services/index.service';
import {
  isRongtaNativeAvailable,
  DEFAULT_THERMAL_WIDTH_DOTS,
  getStoredBluetoothPrinter,
  setStoredBluetoothPrinter,
  findBluetoothPrinters,
  printTextToRongta,
  printPdfFileToRongta,
  connectToRongtaPrinter,
  disconnectRongtaPrinter,
} from '../services/printerService';

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

function formatPrintedDateTime(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toLocaleString('en-LK');
  return d.toLocaleString('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildInvoiceHtml(
  order,
  lines,
  paymentType,
  selectedBankName,
  paymentSplit,
  logoUri,
  customerSignatureDataUrl,
  driverSignatureDataUrl,
  chequeBankName,
  checkNumber,
  invoiceNumber,
  supplierTin = '—',
  purchaserTin = '—',
  partyInfo = {}
) {
  const orderDateRaw = order?.date_order || order?.create_date || order?.date;
  const orderDateParsed = orderDateRaw ? new Date(orderDateRaw) : null;
  const date = orderDateParsed && !Number.isNaN(orderDateParsed.getTime())
    ? orderDateParsed.toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const printedAt = formatPrintedDateTime();
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
      <div class="field"><span class="label">Printed At:</span> ${printedAt}</div>
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
  ${driverSignatureDataUrl ? `
  <div class="signature-section" style="margin-top:4px;padding-top:4px;border-top:1px solid #000;">
    <div class="label" style="font-size:8px;font-weight:700;color:#000;margin-bottom:2px;">Driver signature</div>
    <img src="${driverSignatureDataUrl}" alt="Signature" style="max-width:45mm;height:auto;max-height:20mm;display:block;" />
  </div>
  ` : ''}
  <div class="footer">GasTech – Your Trusted Business Partner</div>
  <div class="powered">Powered by everestx.com</div>
  </div>
</body>
</html>`;
}

/** Typical 80mm thermal line width. */
const PLAIN_WIDTH = 48;

function thermalMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}

function dashLine() {
  return '-'.repeat(PLAIN_WIDTH);
}

function centerPlainLine(text, w = PLAIN_WIDTH) {
  const t = String(text).replace(/\r?\n/g, ' ').trim().slice(0, w);
  const pad = Math.max(0, w - t.length);
  const left = Math.floor(pad / 2);
  return `${' '.repeat(left)}${t}${' '.repeat(pad - left)}`;
}

function lineLR(left, right, w = PLAIN_WIDTH) {
  const L = String(left);
  const R = String(right);
  const gap = w - L.length - R.length;
  if (gap >= 1) return `${L}${' '.repeat(gap)}${R}`;
  return `${L.slice(0, w)}\n${R.padStart(w)}`;
}

function wrapPlainLines(text, w = PLAIN_WIDTH) {
  const s = String(text || '').replace(/\s+/g, ' ').trim() || '—';
  if (s.length <= w) return [s];
  const out = [];
  let rest = s;
  while (rest.length > w) {
    let cut = rest.lastIndexOf(' ', w);
    if (cut < 8) cut = w;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function formatPlainISODate(order) {
  const d = order?.date_order ? new Date(order.date_order) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildInvoicePlainText(
  order,
  lines,
  paymentType,
  selectedBankName,
  paymentSplit,
  _logoUri,
  _customerSignatureDataUrl,
  _driverSignatureDataUrl,
  chequeBankName,
  checkNumber,
  invoiceNumber,
  supplierTin = '—',
  purchaserTin = '—',
  partyInfo = {}
) {
  const isoDate = formatPlainISODate(order);
  const printedAt = formatPrintedDateTime();
  const customerName = safeDisplay(partyInfo?.customerName || order?.partner_id?.[1]);
  const streetPart = safeDisplay(order?.street || order?.partner_street || order?.partner_address);
  const cityPart = safeDisplay(partyInfo?.customerCity || order?.city);
  const phonePart = safeDisplay(partyInfo?.customerPhone || order?.partner_phone);
  const custStreet = safeDisplay(partyInfo?.customerStreet || streetPart);
  const customerPhone = phonePart !== '—' ? phonePart : '—';
  const supplierTinResolved = partyInfo?.supplierTin || supplierTin;
  const purchaserTinResolved = partyInfo?.customerTin || purchaserTin;
  const supplierTinSafe =
    supplierTinResolved != null && String(supplierTinResolved).trim()
      ? String(supplierTinResolved).trim()
      : '';
  const purchaserTinSafe =
    purchaserTinResolved != null && String(purchaserTinResolved).trim()
      ? String(purchaserTinResolved).trim()
      : '';
  const supplierName = safeDisplay(partyInfo?.supplierName || 'GasTech');
  const supplierPhone = safeDisplay(partyInfo?.supplierPhone || '—');
  const supplierAddress = safeDisplay(partyInfo?.supplierAddress || '—');
  const invNo = invoiceNumber ?? order?.name ?? '—';

  const lineAmounts = (lines || []).map((l) => {
    const sub = Number(l.price_subtotal) || 0;
    const total = Number(l.price_total) || 0;
    return { sub, total, tax: total - sub };
  });
  const computedUntaxed = lineAmounts.reduce((s, a) => s + a.sub, 0);
  const computedTax = lineAmounts.reduce((s, a) => s + a.tax, 0);
  const amountUntaxed =
    order?.amount_untaxed != null && order.amount_untaxed !== 0 ? order.amount_untaxed : computedUntaxed;
  const amountTax =
    order?.amount_tax != null && order.amount_tax !== 0 ? order.amount_tax : computedTax;
  const amountTotal = order?.amount_total ?? (amountUntaxed + amountTax);

  const w = PLAIN_WIDTH;
  const parts = [
    centerPlainLine('GasTech', w),
    centerPlainLine('TAX INVOICE', w),
    dashLine(),
    lineLR('Invoice No.', invNo, w),
    lineLR('Date of Invoice', isoDate, w),
    dashLine(),
    lineLR('Supplier Name', supplierName, w),
    supplierTinSafe ? lineLR('Supplier TIN', supplierTinSafe, w) : null,
    ...wrapPlainLines(`Address: ${supplierAddress}`, w),
    lineLR('Telephone No.', supplierPhone, w),
    lineLR('Date of Delivery', isoDate, w),
    dashLine(),
    lineLR('Customer Name', customerName, w),
    purchaserTinSafe ? lineLR('Customer TIN', purchaserTinSafe, w) : null,
    ...wrapPlainLines(`Address: ${[custStreet, cityPart].filter((s) => s && s !== '—').join(', ') || '—'}`, w),
    lineLR('Telephone No.', customerPhone, w),
    lineLR('Place of Supply', cityPart !== '—' ? cityPart : '—', w),
    dashLine(),
    // 48-column table header (matches invoice structure better).
    'No Description                  Qty   Unit      Total',
    dashLine(),
  ];

  (lines || []).forEach((l, i) => {
    const idx = String(i + 1).padStart(2, ' ');
    const desc = String(getProductDisplayName(l.product_id?.[1] ?? '—')).slice(0, 24).padEnd(24, ' ');
    const qty = String(Number(l.product_uom_qty ?? 0)).padStart(4, ' ');
    const unit = thermalMoney(l.price_unit ?? 0).padStart(8, ' ');
    const total = thermalMoney(l.price_total ?? 0).padStart(9, ' ');
    parts.push(`${idx} ${desc}${qty} ${unit} ${total}`.slice(0, w));
  });
  if (!lines?.length) parts.push('(No line items)'.slice(0, w));

  parts.push(dashLine());
  parts.push(lineLR('Gross Amount', thermalMoney(amountUntaxed), w));
  parts.push(lineLR('VAT (18%)', thermalMoney(amountTax), w));
  parts.push(lineLR('Net Amount', thermalMoney(amountTotal), w));
  parts.push(dashLine());

  const split = paymentSplit;
  if (paymentType === 'split' && split) {
    const chq = Number(split.check ?? split.cheque ?? 0);
    parts.push(lineLR('Cash', thermalMoney(split.cash ?? 0), w));
    parts.push(lineLR('Cheque', thermalMoney(chq), w));
    parts.push(lineLR('Credit', thermalMoney(split.credit ?? 0), w));
  } else {
    const label =
      (paymentType === 'bank' || paymentType === 'check') && selectedBankName
        ? `Check: ${selectedBankName}`
        : paymentType === 'credit' && selectedBankName
          ? `Credit: ${selectedBankName}`
          : !paymentType && !selectedBankName && !paymentSplit
            ? 'Invoiced'
            : 'Cash';
    parts.push(lineLR('Mode', label.slice(0, 24), w));
  }

  if (chequeBankName) {
    parts.push(`Bank: ${String(chequeBankName).slice(0, w - 6)}`.slice(0, w));
  }
  if (checkNumber) {
    parts.push(`Cheque No: ${String(checkNumber).slice(0, w - 11)}`.slice(0, w));
  }

  parts.push(dashLine());
  parts.push(lineLR('Printed At', printedAt, w));
  parts.push(centerPlainLine('Thank you for your business', w));

  return `${parts.filter(Boolean).join('\r\n')}\r\n\r\n`;
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
    driverSignatureDataUrl,
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
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [deliveryPhotos, setDeliveryPhotos] = useState([]);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [thermalPrinter, setThermalPrinter] = useState(null);
  const [printerModalVisible, setPrinterModalVisible] = useState(false);
  const [loadingPairedPrinters, setLoadingPairedPrinters] = useState(false);
  const [pairedPrinterRows, setPairedPrinterRows] = useState([]);
  const [thermalConnected, setThermalConnected] = useState(false);
  const [connectingThermal, setConnectingThermal] = useState(false);
  const [connectThermalError, setConnectThermalError] = useState(null);
  const MAX_PHOTOS = 3;
  const rongtaReady = Platform.OS === 'android' && isRongtaNativeAvailable();
  const rongtaPrintBlocked =
    rongtaReady && (!thermalPrinter?.address || !thermalConnected);

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
        printBtnDisabled: { opacity: 0.45 },
        printBlockedHint: {
          fontSize: 13,
          color: colors.textSecondary,
          textAlign: 'center',
          marginBottom: spacing.md,
          lineHeight: 20,
          paddingHorizontal: spacing.sm,
        },
        thermalConnectBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: borderRadius.lg,
          marginTop: spacing.sm,
        },
        thermalConnectBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
        thermalStatusOk: { fontSize: 13, fontWeight: '600', color: '#16a34a', marginTop: 8 },
        thermalStatusErr: { fontSize: 13, color: '#dc2626', marginTop: 8 },
        thermalPrinterCard: {
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        thermalPrinterTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 },
        thermalPrinterSub: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
        thermalPrinterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        thermalPrinterBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: borderRadius.md,
          backgroundColor: colors.primarySurface || '#eef2ff',
        },
        thermalPrinterBtnDanger: {
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
        },
        thermalPrinterBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        thermalPrinterBtnTextMuted: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
        printerPickBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'flex-end',
        },
        printerPickSheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: spacing.lg,
          maxHeight: '70%',
        },
        printerPickHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
        printerPickTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
        printerPickRow: {
          paddingVertical: 14,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        printerPickName: { fontSize: 15, fontWeight: '600', color: colors.text },
        printerPickAddr: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
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
        evidenceModalOverlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'flex-end',
        },
        evidenceModalContent: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: borderRadius.lg,
          borderTopRightRadius: borderRadius.lg,
          padding: spacing.lg,
          maxHeight: '80%',
        },
        evidenceModalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
        evidenceModalHint: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
        evidencePhotoButtonsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
        evidencePhotoBtn: {
          flex: 1,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: spacing.md,
          backgroundColor: colors.surface,
          borderRadius: borderRadius.lg,
          borderWidth: 2,
          borderColor: colors.border,
          borderStyle: 'dashed',
        },
        evidencePhotoBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        evidencePhotoList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
        evidencePhotoPreviewWrap: {
          width: 75,
          height: 75,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          backgroundColor: colors.surface,
        },
        evidencePhotoPreview: { width: '100%', height: '100%', backgroundColor: colors.background },
        evidencePhotoRemoveBtn: {
          position: 'absolute',
          top: 4,
          right: 4,
          padding: 2,
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderRadius: 14,
        },
        evidenceSaveBtn: {
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          marginTop: spacing.md,
        },
        evidenceSaveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
        evidenceSkipBtn: {
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: spacing.sm,
          marginBottom: spacing.xl,
        },
        evidenceSkipBtnText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rongtaReady) return;
      const stored = await getStoredBluetoothPrinter();
      if (!cancelled && stored) {
        setThermalPrinter({
          ...stored,
          limitWidthDots: stored.limitWidthDots || DEFAULT_THERMAL_WIDTH_DOTS,
          textAlign: stored.textAlign || 'left',
        });
        setThermalConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rongtaReady]);

  useEffect(() => {
    return () => {
      if (Platform.OS === 'android' && isRongtaNativeAvailable()) {
        disconnectRongtaPrinter();
      }
    };
  }, []);

  const handleConnectToRongta = useCallback(async () => {
    if (!thermalPrinter?.address) {
      Alert.alert('Printer', 'Choose a paired printer first.');
      return;
    }
    setConnectingThermal(true);
    setConnectThermalError(null);
    try {
      await connectToRongtaPrinter(thermalPrinter);
      setThermalConnected(true);
    } catch (e) {
      setThermalConnected(false);
      const msg = e?.message || 'Could not connect. Check Bluetooth is on and the printer is paired.';
      setConnectThermalError(msg);
      Alert.alert('Bluetooth connection failed', msg);
    } finally {
      setConnectingThermal(false);
    }
  }, [thermalPrinter]);

  const openThermalPrinterPicker = useCallback(async () => {
    if (!rongtaReady) return;
    setPrinterModalVisible(true);
    setLoadingPairedPrinters(true);
    setPairedPrinterRows([]);
    try {
      const list = await findBluetoothPrinters();
      setPairedPrinterRows(list);
    } catch (e) {
      Alert.alert('Bluetooth', e?.message || 'Could not list paired printers.');
    } finally {
      setLoadingPairedPrinters(false);
    }
  }, [rongtaReady]);

  const handlePrint = useCallback(async () => {
    if (!order) return;
    setPrinting(true);
    setPrintResult(null);
    setPrintError(null);
    try {
      const effectiveSplitForPrint =
        paymentType === 'split' && paymentSplit ? paymentSplit : localPaymentSplit || paymentSplit;
      const resolvedChequeBankName = chequeBankName || selectedBankName || localChequeMeta.bankName || null;
      const resolvedChequeNumber = checkNumber || localChequeMeta.checkNumber || null;
      const html = buildInvoiceHtml(
        order,
        lines,
        paymentType,
        selectedBankName,
        effectiveSplitForPrint,
        logoUri,
        customerSignatureDataUrl,
        driverSignatureDataUrl,
        resolvedChequeBankName,
        resolvedChequeNumber,
        invoiceNumber,
        supplierTin,
        purchaserTin,
        partyInfo
      );

      if (rongtaReady && thermalConnected && thermalPrinter?.address) {
        // Avoid PDF raster on Rongta; some units print full-black pages.
        const plain = buildInvoicePlainText(
          order,
          lines,
          paymentType,
          selectedBankName,
          effectiveSplitForPrint,
          logoUri,
          customerSignatureDataUrl,
          driverSignatureDataUrl,
          resolvedChequeBankName,
          resolvedChequeNumber,
          invoiceNumber,
          supplierTin,
          purchaserTin,
          partyInfo
        );
        await printTextToRongta(plain, thermalPrinter);
        setShowEvidenceModal(true);
        setPrintResult(null);
        return;
      }

      await Print.printAsync({ html });
      setShowEvidenceModal(true);
      setPrintResult(null);
    } catch (err) {
      console.error(err);
      setPrintResult('failed');
      setPrintError(
        err?.message || 'Could not print. Pair a Bluetooth printer below or use the system print dialog.'
      );
    } finally {
      setPrinting(false);
      setHideSyncIndicator(false);
    }
  }, [
    order,
    lines,
    invoiceNumber,
    paymentType,
    selectedBankName,
    paymentSplit,
    localPaymentSplit,
    logoUri,
    customerSignatureDataUrl,
    driverSignatureDataUrl,
    chequeBankName,
    checkNumber,
    localChequeMeta.bankName,
    localChequeMeta.checkNumber,
    supplierTin,
    purchaserTin,
    partyInfo,
    rongtaReady,
    thermalPrinter,
    thermalConnected,
  ]);

  const goToHome = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Dashboard' });
  }, [navigation]);

  const handleSaveEvidence = useCallback(async () => {
    if (deliveryPhotos.length === 0) {
      runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence skip', e?.message ?? e));
      goToHome();
      return;
    }

    setSavingEvidence(true);
    try {
      const soId = Number(saleOrderId);
      const timestamp = Date.now();
      for (let i = 0; i < deliveryPhotos.length; i++) {
        const uri = deliveryPhotos[i];
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
          console.warn('[InvoiceScreen] save evidence photo failed', { index: i, uri, message: e?.message });
        }
      }

      setShowEvidenceModal(false);
      setDeliveryPhotos([]);
      runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence save', e?.message ?? e));
      goToHome();
    } catch (err) {
      console.error('[InvoiceScreen] save evidence failed', err);
      Alert.alert('Error', 'Failed to save evidence photos. Please try again.');
    } finally {
      setSavingEvidence(false);
    }
  }, [deliveryPhotos, saleOrderId, goToHome]);

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
        {(customerSignatureDataUrl || driverSignatureDataUrl) ? (
          <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            {customerSignatureDataUrl ? (
              <>
                <Text style={[styles.totalsLabel, { marginBottom: 4 }]}>Customer signature</Text>
                <Image source={{ uri: customerSignatureDataUrl }} style={{ width: '100%', maxWidth: 180, height: 70, resizeMode: 'contain' }} />
              </>
            ) : null}
            {driverSignatureDataUrl ? (
              <>
                <Text style={[styles.totalsLabel, { marginTop: customerSignatureDataUrl ? spacing.sm : 0, marginBottom: 4 }]}>Driver signature</Text>
                <Image source={{ uri: driverSignatureDataUrl }} style={{ width: '100%', maxWidth: 180, height: 70, resizeMode: 'contain' }} />
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {rongtaReady ? (
        <View style={styles.thermalPrinterCard}>
          <Text style={styles.thermalPrinterTitle}>Bluetooth Rongta printer</Text>
          <Text style={styles.thermalPrinterSub}>
            {thermalPrinter
              ? `${thermalPrinter.name}\n${thermalPrinter.address}`
              : 'Step 1: Pair the printer in Android Settings → Bluetooth. Step 2: Choose it here.'}
          </Text>
          <View style={styles.thermalPrinterActions}>
            <TouchableOpacity style={styles.thermalPrinterBtn} onPress={openThermalPrinterPicker} activeOpacity={0.8}>
              <Ionicons name="bluetooth" size={20} color={colors.primary} />
              <Text style={styles.thermalPrinterBtnText}>
                {thermalPrinter ? 'Change printer' : 'Choose printer'}
              </Text>
            </TouchableOpacity>
            {thermalPrinter ? (
              <TouchableOpacity
                style={[styles.thermalPrinterBtn, styles.thermalPrinterBtnDanger]}
                onPress={async () => {
                  await disconnectRongtaPrinter();
                  setThermalPrinter(null);
                  setThermalConnected(false);
                  setConnectThermalError(null);
                  await setStoredBluetoothPrinter(null);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.thermalPrinterBtnTextMuted}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.thermalConnectBtn, (!thermalPrinter?.address || connectingThermal) && { opacity: 0.5 }]}
            onPress={handleConnectToRongta}
            disabled={!thermalPrinter?.address || connectingThermal}
            activeOpacity={0.85}
          >
            {connectingThermal ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="link" size={22} color="#fff" />
            )}
            <Text style={styles.thermalConnectBtnText}>
              {connectingThermal ? 'Connecting…' : 'Connect to Bluetooth Rongta printer'}
            </Text>
          </TouchableOpacity>
          {thermalConnected ? (
            <Text style={styles.thermalStatusOk}>Connected — you can print the invoice.</Text>
          ) : null}
          {connectThermalError && !thermalConnected ? (
            <Text style={styles.thermalStatusErr}>{connectThermalError}</Text>
          ) : null}
        </View>
      ) : null}

      <Modal
        visible={printerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPrinterModalVisible(false)}
      >
        <View style={styles.printerPickBackdrop}>
          <View style={styles.printerPickSheet}>
            <View style={styles.printerPickHeader}>
              <Text style={styles.printerPickTitle}>Paired Bluetooth printers</Text>
              <TouchableOpacity
                onPress={() => setPrinterModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={26} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.thermalPrinterBtn, { alignSelf: 'flex-start', marginBottom: spacing.sm }]}
              onPress={openThermalPrinterPicker}
              disabled={loadingPairedPrinters}
            >
              {loadingPairedPrinters ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={20} color={colors.primary} />
              )}
              <Text style={styles.thermalPrinterBtnText}>Refresh list</Text>
            </TouchableOpacity>
            <FlatList
              data={pairedPrinterRows}
              keyExtractor={(item) => item.address}
              style={{ flexGrow: 0 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.printerPickRow}
                  onPress={async () => {
                    const next = {
                      name: item.name,
                      address: item.address,
                      mac: item.mac || item.address,
                      limitWidthDots: DEFAULT_THERMAL_WIDTH_DOTS,
                      textAlign: 'left',
                    };
                    await disconnectRongtaPrinter();
                    setThermalPrinter(next);
                    setThermalConnected(false);
                    setConnectThermalError(null);
                    await setStoredBluetoothPrinter(next);
                    setPrinterModalVisible(false);
                  }}
                >
                  <Text style={styles.printerPickName}>{item.name}</Text>
                  <Text style={styles.printerPickAddr}>{item.address}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                loadingPairedPrinters ? null : (
                  <Text style={{ color: colors.textSecondary, paddingVertical: 16 }}>
                    No paired devices. Pair the printer in system Settings, then Refresh.
                  </Text>
                )
              }
            />
          </View>
        </View>
      </Modal>

      {rongtaPrintBlocked ? (
        <Text style={styles.printBlockedHint}>
          Choose a paired printer, tap &quot;Connect to Bluetooth Rongta printer&quot;, then Print invoice unlocks.
        </Text>
      ) : null}

      {/* Print invoice button - hidden after print so modal offers Re-print */}
      {printResult == null && (
        <TouchableOpacity
          style={[styles.printBtn, (printing || rongtaPrintBlocked) && styles.printBtnDisabled]}
          onPress={handlePrint}
          disabled={printing || rongtaPrintBlocked}
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
        visible={printResult === 'failed' && !printing}
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

      <Modal
        visible={showEvidenceModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowEvidenceModal(false);
          setDeliveryPhotos([]);
          runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence close', e?.message ?? e));
          goToHome();
        }}
      >
        <View style={styles.evidenceModalOverlay}>
          <ScrollView style={styles.evidenceModalContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            <Text style={styles.evidenceModalTitle}>Delivery Evidence Photos</Text>
            <Text style={styles.evidenceModalHint}>Optionally attach photos as evidence of delivery</Text>

            {deliveryPhotos.length < MAX_PHOTOS && (
              <View style={styles.evidencePhotoButtonsRow}>
                <TouchableOpacity
                  style={styles.evidencePhotoBtn}
                  onPress={async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission', 'Camera access is required to take a photo.');
                      return;
                    }
                    const result = await ImagePicker.launchCameraAsync({
                      mediaTypes: ['images'],
                      allowsEditing: false,
                      quality: 0.8,
                    });
                    if (!result.canceled && result.assets?.[0]?.uri) {
                      setDeliveryPhotos((prev) => (prev.length < MAX_PHOTOS ? [...prev, result.assets[0].uri] : prev));
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="camera" size={28} color={colors.primary} />
                  <Text style={styles.evidencePhotoBtnText}>Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.evidencePhotoBtn}
                  onPress={async () => {
                    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission', 'Gallery access is required to choose a photo.');
                      return;
                    }
                    const result = await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ['images'],
                      allowsEditing: false,
                      quality: 0.8,
                    });
                    if (!result.canceled && result.assets?.[0]?.uri) {
                      setDeliveryPhotos((prev) => (prev.length < MAX_PHOTOS ? [...prev, result.assets[0].uri] : prev));
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="images-outline" size={28} color={colors.primary} />
                  <Text style={styles.evidencePhotoBtnText}>Choose photo</Text>
                </TouchableOpacity>
              </View>
            )}

            {deliveryPhotos.length > 0 && (
              <>
                <Text style={[styles.evidenceModalHint, { marginBottom: spacing.lg, marginTop: spacing.md }]}>
                  {deliveryPhotos.length} of {MAX_PHOTOS} photos
                </Text>
                <View style={styles.evidencePhotoList}>
                  {deliveryPhotos.map((uri, index) => (
                    <View key={`${uri}-${index}`} style={styles.evidencePhotoPreviewWrap}>
                      <Image source={{ uri }} style={styles.evidencePhotoPreview} resizeMode="cover" />
                      <TouchableOpacity
                        style={styles.evidencePhotoRemoveBtn}
                        onPress={() => setDeliveryPhotos((prev) => prev.filter((_, i) => i !== index))}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close-circle" size={28} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity
              style={styles.evidenceSaveBtn}
              onPress={handleSaveEvidence}
              disabled={savingEvidence}
              activeOpacity={0.8}
            >
              {savingEvidence ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
                  <Text style={styles.evidenceSaveBtnText}>{deliveryPhotos.length > 0 ? 'Save & Continue' : 'Skip'}</Text>
                </>
              )}
            </TouchableOpacity>

            {deliveryPhotos.length > 0 && (
              <TouchableOpacity
                style={styles.evidenceSkipBtn}
                onPress={() => {
                  setShowEvidenceModal(false);
                  setDeliveryPhotos([]);
                  runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence skip', e?.message ?? e));
                  goToHome();
                }}
                disabled={savingEvidence}
                activeOpacity={0.8}
              >
                <Text style={styles.evidenceSkipBtnText}>Skip</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Printer connection note */}
      <View style={styles.printerNote}>
        <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
        <View style={styles.printerNoteTextWrap}>
          <Text style={styles.printerNoteTitle}>Connect to printer</Text>
          <Text style={styles.printerNoteText}>
            {Platform.OS === 'android' && rongtaReady
              ? 'This build includes a Rongta Bluetooth driver: pair the printer in Settings → Bluetooth, choose it above, then Print invoice (PDF raster to the printer; plain-text fallback if needed). Without a selected printer, Android opens the normal print dialog. Custom native code does not run in Expo Go — use a dev build (expo run:android) or your APK.'
              : 'To print from the system dialog, connect a printer via Bluetooth, USB, or Wi‑Fi where your device supports it.'}
            {Platform.OS === 'android' && !rongtaReady
              ? ' Add printers in Settings → Connected devices → Printing if available.'
              : null}
            {Platform.OS === 'ios' ? ' On iOS use AirPrint-compatible printers.' : null}
          </Text>
        </View>
      </View>

    </ScrollView>
  );
}

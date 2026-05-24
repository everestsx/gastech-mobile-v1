import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useTheme } from '../context/ThemeContext';
import { useSync } from '../context/SyncContext';
import { usePrinterConnection } from '../context/PrinterConnectionContext';
import { spacing, borderRadius } from '../constants/theme';
import { INVOICE_LOGO_PNG_BASE64 } from '../constants/invoiceLogoBase64';
import { getSaleOrderDetailsFromDB, getUserSession, runSync } from '../services/sync.service';
import { getOrAssignInvoiceNumber } from '../utils/invoiceNumber';
import { getProductDisplayName, sortInvoiceLinesByGasKgAsc } from '../utils/productDisplay';
import { formatAmount } from '../utils/format';
import * as localPaymentsDb from '../database/localPayments.js';
import * as localInvoicesDb from '../database/localInvoices.js';
import * as offlineAttachmentsDb from '../database/offlineAttachments.js';
import { callOdoo } from '../services/index.service';
import { findBluetoothPrinters, printPdfFileToRongta } from '../services/printerService';
import SyncHeaderBadge from '../components/SyncHeaderBadge';
import SignatureCanvas from 'react-native-signature-canvas';
import { resolveInvoiceCustomerDisplayName, odooLocalizedText } from '../utils/customerDisplayName';
import { lineSubtotalAtQuantity, lineTaxAtQuantity } from '../utils/orderLineTax.js';
import { setCheckoutResumePhase, clearCheckoutResume, getCheckoutResumeEntry } from '../services/checkoutResume.service';
import * as syncQueueDb from '../database/syncQueue.js';
import {
  mergeInvoiceLinesWithCatalog,
  resolveInvoiceLineUnitPrice,
} from '../utils/invoiceCatalogLines.js';

/**
 * Expo `printToFileAsync` defaults to US Letter width (612pt), so a 104mm-wide layout sits in a
 * narrow column on the left. Match PDF page width to ~104mm at 72 PPI so the invoice fills the paper.
 */
const THERMAL_INVOICE_PDF_WIDTH_PT = Math.round((104 * 72) / 25.4);
const THERMAL_INVOICE_PDF_HEIGHT_PT = 4096;

/** True when local_payments-derived split has any non-zero line (re-print without route paymentType). */
function paymentSplitHasLineItems(split) {
  if (!split) return false;
  const cash = Number(split.cash) || 0;
  const chq = Number(split.check ?? split.cheque) || 0;
  const cred = Number(split.credit) || 0;
  return cash > 0 || chq > 0 || cred > 0;
}

/** PNG/JPEG base64 payload only (for Rongta native header bitmap). */
function extractRawBase64FromDataUri(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') return null;
  const idx = dataUri.indexOf('base64,');
  if (idx < 0) return null;
  const raw = dataUri.slice(idx + 7).replace(/\s/g, '');
  return raw || null;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * SDK 54: `readAsStringAsync` on `expo-file-system` throws — use legacy + new File API only.
 */
async function readBase64FromUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  if (/^ph:\/\//i.test(trimmed)) return null;

  const tryFileClass = async (fileUri) => {
    try {
      const disk = new FileSystem.File(fileUri);
      if (!disk.exists) return null;
      const buf = await disk.arrayBuffer();
      return arrayBufferToBase64(buf);
    } catch (_) {
      return null;
    }
  };

  const fromDisk = await tryFileClass(trimmed);
  if (fromDisk) return fromDisk;

  const normalizedUri =
    /^file:\/\//i.test(trimmed) || /^content:\/\//i.test(trimmed) ? trimmed : `file://${trimmed}`;
  try {
    const b64 = await FileSystemLegacy.readAsStringAsync(normalizedUri, { encoding: 'base64' });
    if (b64 && typeof b64 === 'string' && b64.trim()) return b64.trim();
  } catch (_) {
    /* fall through */
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const res = await fetch(trimmed);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return arrayBufferToBase64(buf);
    } catch (_) {
      return null;
    }
  }
  return null;
}

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
    second: '2-digit',
  });
}

/** Clock only — pairs with "Date of Invoice" so the date is not repeated on the printout. */
function formatInvoiceIssueTime(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-LK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Prefer delivery date for invoice printing; fall back to order/creation dates only when missing. */
function resolveInvoiceDateSource(order) {
  const raw =
    order?.commitment_date ||
    order?.delivery_date ||
    order?.date_order ||
    order?.create_date ||
    order?.date;
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function convertIntegerToWords(value) {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

  const toWordsUnderThousand = (n) => {
    const parts = [];
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;

    if (hundreds > 0) {
      parts.push(`${ones[hundreds]} Hundred`);
    }

    if (rest > 0) {
      if (rest < 20) {
        parts.push(ones[rest]);
      } else {
        const ten = Math.floor(rest / 10);
        const unit = rest % 10;
        parts.push(unit > 0 ? `${tens[ten]} ${ones[unit]}` : tens[ten]);
      }
    }

    return parts.join(' ').trim();
  };

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Zero';
  if (numeric === 0) return 'Zero';

  const isNegative = numeric < 0;
  let n = Math.abs(Math.round(numeric));
  let scaleIndex = 0;
  const words = [];

  while (n > 0 && scaleIndex < scales.length) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const chunkWords = toWordsUnderThousand(chunk);
      words.unshift(scales[scaleIndex] ? `${chunkWords} ${scales[scaleIndex]}` : chunkWords);
    }
    n = Math.floor(n / 1000);
    scaleIndex += 1;
  }

  const full = words.join(' ').replace(/\s+/g, ' ').trim() || 'Zero';
  return isNegative ? `Minus ${full}` : full;
}

function formatAmountInWords(amount) {
  return `${convertIntegerToWords(amount)} Only`;
}

function buildInvoiceHtml(
  order,
  lines,
  paymentType,
  selectedBankName,
  paymentSplit,
  logoDataUriForPrint,
  customerSignatureDataUrl,
  driverSignatureDataUrl,
  chequeBankName,
  checkNumber,
  invoiceNumber,
  supplierTin = '—',
  purchaserTin = '—',
  partyInfo = {},
  printOptions = {}
) {
  const omitLogoBlock = printOptions.omitLogoBlock === true;
  const appLanguage = printOptions.appLanguage || 'en';
  const generatedAtRaw =
    printOptions.invoiceGeneratedAt instanceof Date
      ? printOptions.invoiceGeneratedAt
      : printOptions.invoiceGeneratedAt
        ? new Date(printOptions.invoiceGeneratedAt)
        : new Date();
  const invoiceIssueTimeStr = String(formatInvoiceIssueTime(generatedAtRaw)).replace(/</g, '&lt;');
  const driverNameDisplay = safeDisplay(printOptions.salesRepName || '').replace(/</g, '&lt;');
  const vehicleNoDisplay = safeDisplay(printOptions.vehicleNumber || '').replace(/</g, '&lt;');
  const invoiceDateSource = resolveInvoiceDateSource(order);
  const date = invoiceDateSource && !Number.isNaN(invoiceDateSource.getTime())
    ? invoiceDateSource.toLocaleDateString('en-LK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString('en-LK');
  const dateOfInvoiceWithTime = `${date}, ${invoiceIssueTimeStr}`.replace(/</g, '&lt;');
  const customerName = safeDisplay(resolveInvoiceCustomerDisplayName(order, partyInfo, appLanguage)).replace(
    /</g,
    '&lt;'
  );
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
  const supplierAddressMultiline = supplierAddress
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',<br/>') || supplierAddress;
  const customerAddressMultiline = customerAddress
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',<br/>') || customerAddress;
  const chequeAmount = Number(paymentSplit?.check ?? paymentSplit?.cheque ?? 0);
  const invNo =
    (invoiceNumber && String(invoiceNumber).trim()) ||
    (order?.invoice_number && String(order.invoice_number).trim()) ||
    order?.name ||
    '—';
  const showSplitBreakdown =
    (paymentType === 'split' && paymentSplit) || paymentSplitHasLineItems(paymentSplit);
  const paymentLabel = showSplitBreakdown
    ? [
        (Number(paymentSplit.cash) || 0) > 0 && `Cash ${formatInvoiceCurrency(paymentSplit.cash)}`,
        chequeAmount > 0 && `Check ${formatInvoiceCurrency(chequeAmount)}`,
        (Number(paymentSplit.credit) || 0) > 0 && `Amount Due ${formatInvoiceCurrency(paymentSplit.credit)}`,
      ].filter(Boolean).join(' • ') || 'Payment'
    : (paymentType === 'bank' || paymentType === 'check') && selectedBankName
      ? `Check: ${selectedBankName}`
      : paymentType === 'credit' && selectedBankName
        ? `Credit: ${selectedBankName}`
        : !paymentType && !selectedBankName && !paymentSplitHasLineItems(paymentSplit)
          ? 'Invoiced'
          : 'Cash';

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
          const lineSub = (Number(l.product_uom_qty) || 0) * (Number(l.price_unit) || 0);
          return `<tr>
            <td style="padding:4px 2px;border:1px solid #000;font-size:10px">${i + 1}</td>
            <td style="padding:4px 2px;border:1px solid #000;font-size:10px">${productName}</td>
            <td style="padding:4px 4px 4px 2px;border:1px solid #000;text-align:right;font-size:10px">${Number(l.product_uom_qty ?? 0)}</td>
            <td style="padding:4px 2px 4px 4px;border:1px solid #000;text-align:right;font-size:10px">${formatAmount(l.price_unit ?? 0)}</td>
            <td style="padding:4px 2px;border:1px solid #000;text-align:right;font-size:10px">${formatAmount(lineSub)}</td>
          </tr>`;
        }
      )
      .join('') || '<tr><td colspan="5" style="padding:4px;text-align:center;font-size:10px;border:1px solid #000">No line items</td></tr>';

  const hasLineTotals = Array.isArray(lines) && lines.length > 0;
  const amountUntaxed = hasLineTotals
    ? computedUntaxed
    : ((order?.amount_untaxed != null && order.amount_untaxed !== 0) ? order.amount_untaxed : computedUntaxed);
  const amountTax = hasLineTotals
    ? computedTax
    : ((order?.amount_tax != null && order.amount_tax !== 0) ? order.amount_tax : computedTax);
  const amountTotal = hasLineTotals
    ? (amountUntaxed + amountTax)
    : (order?.amount_total ?? (amountUntaxed + amountTax));
  const amountInWords = formatAmountInWords(amountTotal);

  const logoImg = omitLogoBlock
    ? ''
    : logoDataUriForPrint
      ? `<img src="${logoDataUriForPrint}" alt="" style="max-width:40mm;height:auto;display:block;margin:0 auto 2px auto;filter:grayscale(100%) contrast(200%) brightness(85%);" />`
      : '<h1 style="margin:0 0 2px 0;font-size:13px;font-weight:700;color:#000;text-align:center">GasTech</h1>';

  const pageMargin = omitLogoBlock ? '0.5mm 1.5mm 2mm 1.5mm' : '2mm';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    @page { size: 104mm auto; margin: ${pageMargin}; }
    @media print {
      html, body, .page {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
      }
      body { padding: 0 2mm !important; }
      body.thermal-native-invoice { padding: 0 1.5mm !important; }
      .page { padding-bottom: 10mm !important; }
    }
    body {
      font-family: Tahoma, "Trebuchet MS", Arial, sans-serif;
      font-size: 10px;
      font-weight: 400;
      color: #000;
      margin: 0 auto;
      padding: 3px 4px;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body.thermal-native-invoice {
      padding-top: 0;
      padding-bottom: 2px;
    }
    body.thermal-native-invoice .page {
      padding-top: 0;
    }
    body.thermal-native-invoice .title {
      margin: 0 0 5px;
    }
    .page {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
      padding-bottom: 10mm;
    }
    .title {
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      margin: 3px 0 6px;
      border: 1px solid #000;
      padding: 4px 6px;
      text-transform: uppercase;
    }
    .top-row {
      display: flex;
      width: 100%;
      border: 1px solid #000;
      margin-bottom: 4px;
    }
    .top-row .info-cell {
      flex: 1;
      min-width: 0;
      padding: 4px;
      font-size: 10px;
      line-height: 1.3;
      word-break: break-word;
    }
    .top-row .info-cell:first-child {
      border-right: 1px solid #000;
    }
    .top-row .info-cell .invoice-meta-stack {
      margin-top: 3px;
    }
    .top-row .info-cell .invoice-meta-stack .field {
      margin-bottom: 2px;
      font-weight: 400;
    }
    .top-row .info-cell .invoice-meta-stack .field:last-child {
      margin-bottom: 0;
    }
    .top-row .info-cell .invoice-meta-stack .label {
      font-weight: 400;
    }
    .info-box {
      border: 1px solid #000;
      margin-bottom: 4px;
      display: flex;
      width: 100%;
    }
    .two-col {
      display: flex;
      width: 100%;
    }
    .col {
      flex: 1;
      min-width: 0;
      padding: 4px;
      line-height: 1.35;
    }
    .col:first-child {
      border-right: 1px solid #000;
    }
    .field {
      margin-bottom: 3px;
      font-size: 10px;
      font-weight: 400;
      word-break: break-word;
    }
    .label {
      font-weight: 400;
      color: #000;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
      font-size: 10px;
      border: 1px solid #000;
      table-layout: fixed;
    }
    th {
      text-align: left;
      padding: 3px 2px;
      border: 1px solid #000;
      background: #fff;
      font-weight: 700;
      font-size: 10px;
    }
    th:nth-child(1) { width: 6%; text-align: center; }
    th:nth-child(2) { width: 42%; }
    th:nth-child(3) { width: 10%; text-align: right; padding-right: 4px; }
    th:nth-child(4) { width: 18%; text-align: right; padding-left: 4px; }
    th:nth-child(5) { width: 24%; text-align: right; }
    td {
      padding: 4px 2px;
      border: 1px solid #000;
      font-size: 10px;
      word-break: break-word;
    }
    td:nth-child(1) { text-align: center; }
    td:nth-child(2) { overflow: hidden; text-overflow: ellipsis; }
    td:nth-child(3) { padding-right: 4px; }
    td:nth-child(4) { padding-left: 4px; }
    td:nth-child(3), td:nth-child(4), td:nth-child(5) { text-align: right; }
    .totals-box {
      border: 1px solid #000;
      border-top: none;
      margin-bottom: 4px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 4px;
      padding: 3px 4px;
      border-top: 1px solid #000;
      font-size: 10px;
    }
    .totals-row:first-child {
      border-top: none;
    }
    .meta-box {
      border: 1px solid #000;
      margin-bottom: 6px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 4px;
      padding: 3px 4px;
      border-top: 1px solid #000;
      font-size: 10px;
    }
    .meta-row:first-child {
      border-top: none;
    }
    .meta-row span:last-child {
      text-align: right;
    }
    .payment { margin-top: 4px; padding: 4px; font-size: 10px; text-align: center; }
    .footer { margin-top: 6px; font-size: 10px; color: #333; text-align: center; }
    .powered { margin-top: 2px; font-size: 10px; font-style: italic; color: #111; text-align: center; }
  </style>
</head>
<body class="${omitLogoBlock ? 'thermal-native-invoice' : ''}">
  <div class="page">
  ${logoImg}
  <div class="title">Tax Invoice</div>

  <div class="top-row">
    <div class="info-cell">
      <div>Date of Invoice: ${dateOfInvoiceWithTime}</div>
      <div class="invoice-meta-stack">
        <div class="field"><span class="label">Driver name:</span> ${driverNameDisplay}</div>
        <div class="field"><span class="label">Vehicle no.:</span> ${vehicleNoDisplay}</div>
      </div>
    </div>
    <div class="info-cell">Tax Invoice No.: ${invNo}</div>
  </div>

  <div class="info-box">
  <div class="two-col">
    <div class="col">
      <div class="field"><span class="label">Supplier's TIN:</span> ${hasSupplierTin ? supplierTinSafe : '—'}</div>
      <div class="field"><span class="label">Supplier's Name:</span> ${supplierName}</div>
      <div class="field"><span class="label">Address:</span> ${supplierAddressMultiline}</div>
      <div class="field"><span class="label">Telephone No:</span> ${supplierPhone}</div>
    </div>
    <div class="col">
      <div class="field"><span class="label">Purchaser's TIN:</span> ${hasPurchaserTin ? purchaserTinSafe : '—'}</div>
      <div class="field"><span class="label">Purchaser's Name:</span> ${customerName}</div>
      <div class="field"><span class="label">Address:</span> ${customerAddressMultiline}</div>
      <div class="field"><span class="label">Telephone No:</span> ${customerPhone}</div>
    </div>
  </div>
  </div>

  <div class="top-row">
    <div class="info-cell">Date of Delivery: ${date}</div>
    <div class="info-cell">Place of Supply: ${cityPart !== '—' ? cityPart.replace(/</g, '&lt;') : '—'}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount Excluding VAT</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals-box">
    <div class="totals-row"><span>Total Value of Supply:</span><span>${formatInvoiceCurrency(amountUntaxed)}</span></div>
    <div class="totals-row"><span>VAT Amount (18%):</span><span>${formatInvoiceCurrency(amountTax)}</span></div>
    <div class="totals-row"><span>Total Amount including VAT:</span><span>${formatInvoiceCurrency(amountTotal)}</span></div>
  </div>

  <div class="meta-box">
    <div class="meta-row"><span>Total Amount in words:</span><span>${amountInWords}</span></div>
    <div class="meta-row"><span>Mode of Payment:</span><span>${paymentLabel.replace(/</g, '&lt;')}</span></div>
    ${(chequeBankName || checkNumber) ? `
    <div class="meta-row"><span>Bank (Cheque):</span><span>${(chequeBankName || '—').replace(/</g, '&lt;')}</span></div>
    <div class="meta-row"><span>Cheque No.:</span><span>${(checkNumber || '—').replace(/</g, '&lt;')}</span></div>
    ` : ''}
  </div>
  <div class="payment">Thank you for your business</div>
  ${(customerSignatureDataUrl || driverSignatureDataUrl) ? `
  <div class="signature-section" style="margin-top:4px;padding-top:4px;border-top:1px solid #000;width:100%;box-sizing:border-box;">
    <div style="display:flex;flex-direction:row;width:100%;justify-content:space-between;align-items:flex-start;box-sizing:border-box;">
      <div style="flex:0 1 48%;min-width:0;text-align:left;">
        <div style="font-size:9px;font-weight:400;color:#000;margin-bottom:2px;text-align:left;">Driver signature</div>
        ${driverSignatureDataUrl
          ? `<img src="${driverSignatureDataUrl}" alt="" style="max-width:34mm;width:auto;height:auto;max-height:18mm;display:block;margin:0;" />`
          : `<div style="height:18mm;max-width:34mm;border:1px dashed #999;box-sizing:border-box;"></div>`}
      </div>
      <div style="flex:0 1 48%;min-width:0;display:flex;flex-direction:column;align-items:flex-end;text-align:right;">
        <div style="font-size:9px;font-weight:400;color:#000;margin-bottom:2px;width:100%;text-align:right;">Customer signature</div>
        ${customerSignatureDataUrl
          ? `<img src="${customerSignatureDataUrl}" alt="" style="max-width:34mm;width:auto;height:auto;max-height:18mm;display:block;margin:0;margin-left:auto;" />`
          : `<div style="height:18mm;max-width:34mm;border:1px dashed #999;box-sizing:border-box;margin-left:auto;"></div>`}
      </div>
    </div>
  </div>
  ` : ''}
  <div class="footer">GasTech – Your Trusted Business Partner</div>
  <div class="powered">Powered by everestsx.com</div>
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
  const d = resolveInvoiceDateSource(order);
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
  partyInfo = {},
  printOptions = {}
) {
  const appLanguage = printOptions.appLanguage || 'en';
  const isoDate = formatPlainISODate(order);
  const genPlain =
    printOptions.invoiceGeneratedAt instanceof Date
      ? printOptions.invoiceGeneratedAt
      : printOptions.invoiceGeneratedAt
        ? new Date(printOptions.invoiceGeneratedAt)
        : new Date();
  const issueTimePlain = formatInvoiceIssueTime(genPlain);
  const driverNamePlain = safeDisplay(printOptions.salesRepName || '—');
  const vehicleNoPlain = safeDisplay(printOptions.vehicleNumber || '—');
  const customerName = safeDisplay(resolveInvoiceCustomerDisplayName(order, partyInfo, appLanguage));
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
  const invNo =
    (invoiceNumber && String(invoiceNumber).trim()) ||
    (order?.invoice_number && String(order.invoice_number).trim()) ||
    order?.name ||
    '—';

  const lineAmounts = (lines || []).map((l) => {
    const sub = Number(l.price_subtotal) || 0;
    const total = Number(l.price_total) || 0;
    return { sub, total, tax: total - sub };
  });
  const computedUntaxed = lineAmounts.reduce((s, a) => s + a.sub, 0);
  const computedTax = lineAmounts.reduce((s, a) => s + a.tax, 0);
  const hasLineTotals = Array.isArray(lines) && lines.length > 0;
  const amountUntaxed = hasLineTotals
    ? computedUntaxed
    : (order?.amount_untaxed != null && order.amount_untaxed !== 0 ? order.amount_untaxed : computedUntaxed);
  const amountTax = hasLineTotals
    ? computedTax
    : (order?.amount_tax != null && order.amount_tax !== 0 ? order.amount_tax : computedTax);
  const amountTotal = hasLineTotals
    ? (amountUntaxed + amountTax)
    : (order?.amount_total ?? (amountUntaxed + amountTax));

  const w = PLAIN_WIDTH;
  const parts = [
    centerPlainLine('GasTech', w),
    centerPlainLine('TAX INVOICE', w),
    dashLine(),
    lineLR('Invoice No.', invNo, w),
    lineLR('Date of Invoice', `${isoDate} ${issueTimePlain}`, w),
    lineLR('Driver name', driverNamePlain, w),
    lineLR('Vehicle no.', vehicleNoPlain, w),
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
    const total = thermalMoney((Number(l.product_uom_qty) || 0) * (Number(l.price_unit) || 0)).padStart(9, ' ');
    parts.push(`${idx} ${desc}${qty} ${unit} ${total}`.slice(0, w));
  });
  if (!lines?.length) parts.push('(No line items)'.slice(0, w));

  parts.push(dashLine());
  parts.push(lineLR('Gross Amount', thermalMoney(amountUntaxed), w));
  parts.push(lineLR('VAT (18%)', thermalMoney(amountTax), w));
  parts.push(lineLR('Net Amount', thermalMoney(amountTotal), w));
  parts.push(dashLine());

  const split = paymentSplit;
  const showPlainSplit = (paymentType === 'split' && split) || paymentSplitHasLineItems(split);
  if (showPlainSplit) {
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
          : !paymentType && !selectedBankName && !paymentSplitHasLineItems(paymentSplit)
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
  parts.push('Driver Sign  : __________________');
  parts.push('Customer Sign: __________________');
  parts.push(centerPlainLine('Thank you for your business', w));

  return `${parts.filter(Boolean).join('\r\n')}\r\n\r\n`;
}

/** Same file as app icon / splash — embedded as base64 for expo-print PDF (WebView cannot load packager URIs). */
const INVOICE_LOGO_ASSET = require('../../assets/icon.png');

function getInvoiceLogoCachePath() {
  const base = FileSystemLegacy.cacheDirectory;
  if (!base) return null;
  return `${base}invoice-logo-print.png`;
}

async function resolveInvoiceLogoDataUriForPrint() {
  /**
   * Bundled base64 always works — no Asset.downloadAsync, no expo-file-system reads.
   * Those paths often fail on release builds / SDK 54, which caused "logo could not be loaded".
   */
  const embedded =
    typeof INVOICE_LOGO_PNG_BASE64 === 'string' && INVOICE_LOGO_PNG_BASE64.length > 64
      ? `data:image/png;base64,${INVOICE_LOGO_PNG_BASE64}`
      : null;

  if (embedded) {
    try {
      const img = await manipulateAsync(embedded, [{ resize: { width: 680 } }], {
        format: SaveFormat.PNG,
        compress: 1,
        base64: true,
      });
      const b64 = img?.base64?.trim();
      if (b64) return `data:image/png;base64,${b64}`;
    } catch (e) {
      console.warn('[InvoiceScreen] Embedded logo resize failed, using full image', e?.message ?? e);
    }
    return embedded;
  }

  let a = null;
  try {
    const rows = await Asset.loadAsync(INVOICE_LOGO_ASSET);
    a = Array.isArray(rows) ? rows[0] : null;
  } catch (e) {
    console.warn('[InvoiceScreen] Asset.loadAsync(logo) failed', e?.message ?? e);
  }
  if (!a) {
    try {
      a = Asset.fromModule(INVOICE_LOGO_ASSET);
      await a.downloadAsync();
    } catch (e2) {
      console.warn('[InvoiceScreen] Asset.fromModule(logo).downloadAsync failed', e2?.message ?? e2);
      return null;
    }
  } else if (!a.localUri) {
    try {
      await a.downloadAsync();
    } catch (e3) {
      console.warn('[InvoiceScreen] Asset.downloadAsync(logo) retry failed', e3?.message ?? e3);
    }
  }

  const resolved = Image.resolveAssetSource(INVOICE_LOGO_ASSET);
  const candidates = [a?.localUri, a?.uri, resolved?.uri].filter(Boolean);

  const seen = new Set();
  for (const originalUri of candidates) {
    if (!originalUri || seen.has(originalUri)) continue;
    seen.add(originalUri);
    let sourceUri = originalUri;

    if (/^https?:\/\//i.test(sourceUri)) {
      const cachePath = getInvoiceLogoCachePath();
      if (cachePath) {
        try {
          const dl = await FileSystemLegacy.downloadAsync(sourceUri, cachePath);
          if (dl?.uri) sourceUri = dl.uri;
        } catch (_) {
          /* keep remote URI; fetch/readBase64 may still work */
        }
      }
    }

    try {
      const img = await manipulateAsync(
        sourceUri,
        [{ resize: { width: 680 } }],
        { format: SaveFormat.PNG, compress: 1, base64: true }
      );
      const b64 = img?.base64?.trim();
      if (b64) return `data:image/png;base64,${b64}`;
    } catch (_) {
      /* direct read below */
    }
    const directB64 = await readBase64FromUri(sourceUri);
    if (directB64) return `data:image/png;base64,${directB64}`;
  }
  return null;
}

export default function InvoiceScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { colors, appLanguage } = useTheme();
  const {
    rongtaReady,
    thermalPrinter,
    thermalConnected,
    connectingThermal,
    selectPrinter,
    connect,
    clearPrinter,
  } = usePrinterConnection();

  const [invoiceLogoDataUri, setInvoiceLogoDataUri] = useState(null);
  const {
    saleOrderId,
    total: routeTotalParam,
    subtotal: routeSubtotalParam,
    tax: routeTaxParam,
    paymentType,
    selectedBankName,
    chequeBankName,
    checkNumber,
    paymentSplit,
    customerSignatureDataUrl,
    driverSignatureDataUrl,
    supplierTin,
    purchaserTin,
    previewBeforePayment,
    invoiceLineQtys,
    deliveryPayload,
    deliveryDone: routeDeliveryDone,
    fromProceedPayment: routeFromProceedPayment,
    promptSignatures: routePromptSignatures,
    skipEvidenceModal: routeSkipEvidenceModal,
    openPaymentProofAfterPrint: routeOpenPaymentProofAfterPrint,
    creditProofRequired: routeCreditProofRequired,
    orderName: routeOrderName,
    emptyCylinderEntries: routeEmptyCylinderEntries,
  } = route.params ?? {};

  const fromProceedPayment = routeFromProceedPayment === true;
  const promptSignatures = routePromptSignatures === true;
  const skipEvidenceModal = routeSkipEvidenceModal === true;
  const openPaymentProofAfterPrint = routeOpenPaymentProofAfterPrint === true;
  const blockSignatureModalDismiss =
    promptSignatures && (openPaymentProofAfterPrint || fromProceedPayment);

  const { setHideSyncIndicator } = useSync();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  /** When route omits invoiceLineQtys (e.g. opened from Delivered tab), restore from payment queue or checkout resume. */
  const [resolvedInvoiceLineQtys, setResolvedInvoiceLineQtys] = useState(null);

  const effectiveInvoiceQtyRows = useMemo(() => {
    if (Array.isArray(invoiceLineQtys) && invoiceLineQtys.length > 0) return invoiceLineQtys;
    if (Array.isArray(resolvedInvoiceLineQtys) && resolvedInvoiceLineQtys.length > 0) return resolvedInvoiceLineQtys;

    const delivered = deliveryPayload?.saleOrderLineDeliveredUpdates;
    if (Array.isArray(delivered) && delivered.length > 0) {
      return delivered.map((u) => ({
        lineId: u?.lineId,
        qty: Number(u?.qty_delivered ?? 0),
      }));
    }

    // Delivered screen opens InvoiceScreen without explicit qty overrides.
    // For invoiced SOs, prefer synced qty_delivered so printed invoice matches back office.
    const isInvoiced = String(order?.invoice_status || '').toLowerCase() === 'invoiced';
    if (!isInvoiced || !Array.isArray(lines) || lines.length === 0) return [];

    const rows = [];
    let hasDeliveredDiff = false;
    for (const l of lines) {
      const lineId = l?.id;
      if (lineId == null) continue;
      const deliveredQty = Number(l?.qty_delivered);
      const orderedQty = Number(l?.product_uom_qty) || 0;
      if (!Number.isFinite(deliveredQty)) continue;
      if (Math.abs(deliveredQty - orderedQty) > 0.0001) hasDeliveredDiff = true;
      rows.push({ lineId, qty: deliveredQty });
    }
    /** If every line matches ordered qty, totals already match Odoo — no override. Includes full delivery / full zero when both match. */
    if (!hasDeliveredDiff) return [];
    return rows;
  }, [invoiceLineQtys, resolvedInvoiceLineQtys, deliveryPayload, order?.invoice_status, lines]);

  const hasInvoiceQtyOverrides = effectiveInvoiceQtyRows.length > 0;

  const qtyByLineId = useMemo(() => {
    const m = {};
    for (const row of effectiveInvoiceQtyRows || []) {
      if (row?.lineId != null) m[String(row.lineId)] = Number(row.qty) || 0;
    }
    return m;
  }, [effectiveInvoiceQtyRows]);

  /** Apply explicit invoice qty overrides whenever provided (from delivery/payment flow). */
  const displayLines = useMemo(() => {
    const useQtyOverride = hasInvoiceQtyOverrides;
    if (!useQtyOverride) return lines;
    return lines.map((l) => {
      const q = qtyByLineId[String(l.id)];
      if (q === undefined) return { ...l };
      const origQ = Number(l.product_uom_qty) || 0;
      if (origQ > 0) {
        const scale = q / origQ;
        const price_subtotal = (Number(l.price_subtotal) || 0) * scale;
        const price_total = (Number(l.price_total) || 0) * scale;
        return { ...l, product_uom_qty: q, price_subtotal, price_total };
      }
      const price_subtotal = lineSubtotalAtQuantity(l, q);
      const tax = lineTaxAtQuantity(l, q);
      return { ...l, product_uom_qty: q, price_subtotal, price_total: price_subtotal + tax };
    });
  }, [lines, hasInvoiceQtyOverrides, qtyByLineId]);

  /** Keep all line rows; order by gas size (2.4 kg → 37+ kg) for screen + print. */
  const invoiceVisibleLines = useMemo(
    () => sortInvoiceLinesByGasKgAsc(displayLines || []),
    [displayLines]
  );

  const [invoiceNumber, setInvoiceNumber] = useState(null);
  const [odooInvoiceNumber, setOdooInvoiceNumber] = useState(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [printResult, setPrintResult] = useState(null);
  const [printError, setPrintError] = useState(null);
  const [localPaymentSplit, setLocalPaymentSplit] = useState(null);
  const [localChequeMeta, setLocalChequeMeta] = useState({ bankName: null, checkNumber: null });
  const [localCustomerSig, setLocalCustomerSig] = useState(null);
  const [localDriverSig, setLocalDriverSig] = useState(null);
  const [partyInfo, setPartyInfo] = useState({});
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [deliveryPhotos, setDeliveryPhotos] = useState([]);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [printerModalVisible, setPrinterModalVisible] = useState(false);
  const [loadingPairedPrinters, setLoadingPairedPrinters] = useState(false);

  useEffect(() => {
    if (!printerModalVisible || !rongtaReady) return;
    if (!thermalPrinter?.address || thermalConnected || connectingThermal) return;
    const t = setTimeout(() => {
      connect().catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [printerModalVisible, rongtaReady, thermalPrinter?.address, thermalConnected, connectingThermal, connect]);

  /** Only auto-close after a connect attempt in this modal session (not when opening while already connected). */
  const printerModalConnectAttemptRef = useRef(false);
  useEffect(() => {
    if (!printerModalVisible) printerModalConnectAttemptRef.current = false;
  }, [printerModalVisible]);
  useEffect(() => {
    if (connectingThermal) printerModalConnectAttemptRef.current = true;
  }, [connectingThermal]);
  useEffect(() => {
    if (!printerModalVisible || !thermalConnected || connectingThermal) return;
    if (!printerModalConnectAttemptRef.current) return;
    printerModalConnectAttemptRef.current = false;
    const t = setTimeout(() => setPrinterModalVisible(false), 500);
    return () => clearTimeout(t);
  }, [printerModalVisible, thermalConnected, connectingThermal]);
  const [pairedPrinterRows, setPairedPrinterRows] = useState([]);
  const [showSignatureCaptureModal, setShowSignatureCaptureModal] = useState(false);
  /** 'customer' | 'driver' — one pad at a time for comfortable signing */
  const [signatureCaptureStep, setSignatureCaptureStep] = useState('customer');
  const [captureCustomerSig, setCaptureCustomerSig] = useState(null);
  const [captureDriverSig, setCaptureDriverSig] = useState(null);
  const [captureCustomerSaved, setCaptureCustomerSaved] = useState(false);
  const [captureDriverSaved, setCaptureDriverSaved] = useState(false);
  /** Bumps when signature modal opens so pads remount with correct initial dataURL. */
  const [signatureModalSession, setSignatureModalSession] = useState(0);
  const signatureModalEnteredRef = useRef(false);
  const captureCustomerRef = useRef(null);
  const captureDriverRef = useRef(null);
  const MAX_PHOTOS = 3;
  const rongtaPrintBlocked =
    rongtaReady && (!thermalPrinter?.address || !thermalConnected);

  const effectiveCustomerSignatureDataUrl = useMemo(
    () => customerSignatureDataUrl ?? localCustomerSig ?? null,
    [customerSignatureDataUrl, localCustomerSig]
  );
  const effectiveDriverSignatureDataUrl = useMemo(
    () => driverSignatureDataUrl ?? localDriverSig ?? null,
    [driverSignatureDataUrl, localDriverSig]
  );

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
        thTax: { flex: 1, minWidth: 56, textAlign: 'right', marginLeft: 4 },
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
        tdTax: { flex: 1, minWidth: 56, textAlign: 'right', marginLeft: 4 },
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
        skipPrintBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
        },
        skipPrintBtnText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
        previewPrintBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primarySurface || '#eef2ff',
          borderWidth: 1,
          borderColor: colors.primary,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
        },
        previewPrintBtnText: { fontSize: 16, fontWeight: '700', color: colors.primary },
        printBlockedHint: {
          fontSize: 13,
          color: colors.textSecondary,
          textAlign: 'center',
          marginBottom: spacing.md,
          lineHeight: 20,
          paddingHorizontal: spacing.sm,
        },
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
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.lg,
          maxHeight: '78%',
          borderWidth: 1,
          borderBottomWidth: 0,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
          elevation: 16,
        },
        printerPickHandle: {
          width: 44,
          height: 5,
          borderRadius: 3,
          backgroundColor: colors.border,
          alignSelf: 'center',
          marginBottom: spacing.md,
        },
        printerPickHero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
        printerPickIconCircle: {
          width: 54,
          height: 54,
          borderRadius: 27,
          backgroundColor: colors.primarySurface || '#eef2ff',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: (colors.primary || '#6366f1') + '40',
        },
        printerPickHeadTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
        printerPickHeadSub: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 19 },
        printerPickStatusPill: {
          alignSelf: 'stretch',
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
        },
        printerPickStatusText: { fontSize: 13, fontWeight: '700' },
        printerPickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md },
        printerPickPrimaryBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderRadius: borderRadius.lg,
          backgroundColor: colors.primary,
        },
        printerPickPrimaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
        printerPickGhostBtn: {
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          justifyContent: 'center',
        },
        printerPickGhostBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
        printerPickCloseBtn: {
          position: 'absolute',
          right: 0,
          top: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 8,
        },
        printerPickCloseBtnText: { fontSize: 15, fontWeight: '700', color: colors.primary },
        printerPickOutlineBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: borderRadius.lg,
          borderWidth: 1.5,
          borderColor: colors.error || '#dc2626',
          backgroundColor: (colors.error || '#dc2626') + '14',
        },
        printerPickOutlineBtnText: { fontSize: 14, fontWeight: '700', color: colors.error || '#b91c1c' },
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
        resultModalActionsColumn: { width: '100%', gap: 10 },
        resultModalLinkBtn: { paddingVertical: 12, paddingHorizontal: 8 },
        resultModalLinkText: { fontSize: 15, fontWeight: '600', color: colors.primary, textAlign: 'center' },
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
        sigCapOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md },
        sigCapCard: {
          borderRadius: borderRadius.lg,
          maxHeight: '92%',
          overflow: 'hidden',
          padding: spacing.md,
          paddingBottom: spacing.xl,
        },
        sigCapHero: { alignItems: 'center', marginBottom: spacing.lg },
        sigCapHeroIconWrap: {
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: (colors.primary || '#6366f1') + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        sigCapHeroTitle: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
        sigCapHeroSubtitle: {
          fontSize: 14,
          color: colors.textSecondary,
          textAlign: 'center',
          marginTop: spacing.sm,
          lineHeight: 21,
          paddingHorizontal: spacing.sm,
        },
        sigCapTabs: {
          flexDirection: 'row',
          marginBottom: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        sigCapTab: {
          flex: 1,
          paddingVertical: 12,
          paddingHorizontal: 4,
          alignItems: 'center',
          justifyContent: 'center',
        },
        sigCapTabActive: {
          borderBottomWidth: 2,
          borderBottomColor: colors.primary,
          marginBottom: -StyleSheet.hairlineWidth,
        },
        sigCapTabText: {
          fontSize: 13,
          fontWeight: '600',
          color: colors.textSecondary,
          textAlign: 'center',
        },
        sigCapTabTextActive: {
          color: colors.primary,
          fontWeight: '700',
        },
        sigCapSection: { marginBottom: spacing.lg },
        sigCapSectionHeader: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
        sigCapSectionHint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
        sigCapCanvasWrap: {
          height: 150,
          marginBottom: spacing.sm,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        },
        /** Single-step flow: taller signing area (no vertical scroll in modal). */
        sigCapCanvasWrapLarge: {
          height: 240,
          marginBottom: spacing.sm,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        },
        /** Both pads stay mounted while the modal is open so tab switches keep each WebView’s strokes. */
        sigCapCanvasWrapStack: {
          height: 240,
          marginBottom: spacing.sm,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          position: 'relative',
        },
        sigCapCanvasLayer: {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        },
        sigCapCanvas: { flex: 1, height: 150 },
        sigCapCanvasLarge: { flex: 1, height: 240 },
        sigCapBtnRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
        sigCapBtn: {
          flex: 1,
          paddingVertical: 12,
          alignItems: 'center',
          borderRadius: borderRadius.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        sigCapBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
        sigCapBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
        sigCapBtnTextLight: { fontSize: 15, fontWeight: '600', color: '#fff' },
        sigCapBtnSaved: { 
          backgroundColor: colors.primary + '20', 
          borderColor: colors.primary + '40',
        },
        sigCapBtnTextSaved: { fontSize: 15, fontWeight: '600', color: colors.primary },
        sigCapDoneBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: borderRadius.lg,
          marginTop: spacing.xs,
        },
        sigCapDoneBtnDisabled: {
          opacity: 0.45,
        },
      }),
    [colors]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataUri = await resolveInvoiceLogoDataUriForPrint();
        if (!cancelled) {
          setInvoiceLogoDataUri(dataUri);
        }
      } catch (e) {
        console.warn('[InvoiceScreen] Could not load logo for print', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadInvoiceLogoDataUriForPrint = useCallback(async () => {
    if (invoiceLogoDataUri) return invoiceLogoDataUri;
    try {
      const dataUri = await resolveInvoiceLogoDataUriForPrint();
      setInvoiceLogoDataUri(dataUri);
      return dataUri;
    } catch (e) {
      console.warn('[InvoiceScreen] Could not load logo for print (on-demand)', e);
      return null;
    }
  }, [invoiceLogoDataUri]);

  const loadInvoice = useCallback(async () => {
    if (!saleOrderId) {
      setLocalCustomerSig(null);
      setLocalDriverSig(null);
      setOdooInvoiceNumber(null);
      setLoading(false);
      return;
    }
    try {
      let extraInvoiceQtys = route.params?.invoiceLineQtys;
      if (!Array.isArray(extraInvoiceQtys) || extraInvoiceQtys.length === 0) {
        try {
          const pending = await syncQueueDb.getPendingPaymentItemBySaleOrderId(Number(saleOrderId));
          const fromPay = pending?.payload?.invoiceLineQtys;
          if (Array.isArray(fromPay) && fromPay.length > 0) extraInvoiceQtys = fromPay;
        } catch (_) {
          /* ignore */
        }
      }
      if (!Array.isArray(extraInvoiceQtys) || extraInvoiceQtys.length === 0) {
        try {
          const entry = await getCheckoutResumeEntry(Number(saleOrderId));
          const fromResume = entry?.invoiceParams?.invoiceLineQtys;
          if (Array.isArray(fromResume) && fromResume.length > 0) extraInvoiceQtys = fromResume;
        } catch (_) {
          /* ignore */
        }
      }
      const data = await getSaleOrderDetailsFromDB(saleOrderId);
      setOrder(data.order);
      const orderName = data?.order?.name;
      const invNo =
        route.params?.invoiceNumber ??
        (await getOrAssignInvoiceNumber(saleOrderId, {
          saleOrderName: orderName,
          backendInvoiceNumber: data?.order?.invoice_number,
        }));
      setInvoiceNumber(invNo);

      const { getInvoiceLineSnapshotForSaleOrder, snapshotRowsToInvoiceLines } = await import(
        '../utils/localInvoiceSnapshot.js'
      );
      const frozenSnapshot = await getInvoiceLineSnapshotForSaleOrder(saleOrderId);
      if (frozenSnapshot?.length) {
        setResolvedInvoiceLineQtys(
          frozenSnapshot.map((row) => ({ lineId: row.lineId, qty: row.qty }))
        );
      } else {
        setResolvedInvoiceLineQtys(
          Array.isArray(extraInvoiceQtys) && extraInvoiceQtys.length > 0 ? extraInvoiceQtys : null
        );
      }

      const rawLines = data.lines ?? [];
      let baseLines = rawLines;
      if (frozenSnapshot?.length) {
        baseLines = snapshotRowsToInvoiceLines(saleOrderId, frozenSnapshot);
      }
      const nextLines = await mergeInvoiceLinesWithCatalog(saleOrderId, baseLines);
      setLines(nextLines);
      const split = await localPaymentsDb.getPaymentSplitBySaleOrderId(saleOrderId);
      setLocalPaymentSplit(split || { cash: 0, cheque: 0, credit: 0 });
      const paymentRows = await localPaymentsDb.getLocalPaymentsBySaleOrderId(saleOrderId);
      const chequeRow = [...(paymentRows || [])].reverse().find((p) => String(p.payment_type || '').toLowerCase() === 'cheque');
      setLocalChequeMeta({
        bankName: chequeRow?.bank_name || null,
        checkNumber: chequeRow?.check_number || null,
      });

      const localInv = await localInvoicesDb.getLocalInvoiceBySaleOrderId(saleOrderId);
      setLocalCustomerSig(localInv?.customer_signature_data ?? null);
      setLocalDriverSig(localInv?.driver_signature_data ?? null);
      setLoading(false);

      let odooNo = null;
      const odooInvoiceId = Number(localInv?.odoo_invoice_id);
      if (Number.isFinite(odooInvoiceId) && odooInvoiceId > 0) {
        try {
          const invRows = await callOdoo('account.move', 'read', [[odooInvoiceId]], { fields: ['name'] });
          const name = Array.isArray(invRows) ? invRows[0]?.name : null;
          if (name && typeof name === 'string' && String(name).trim()) {
            odooNo = String(name).trim();
          }
        } catch (_) {
          odooNo = null;
        }
      }
      setOdooInvoiceNumber(odooNo);

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
            fields: ['name', 'phone', 'street', 'street2', 'city', 'vat', 'name_tamil', 'name_sinhala'],
          });
        }
        const customer = Array.isArray(customerRows) ? customerRows[0] : null;

        nextPartyInfo = {
          supplierName: company?.name || null,
          supplierPhone: company?.phone || null,
          supplierTin: company?.vat || null,
          supplierAddress: [companyStreet, companyCity].filter(Boolean).join(', ') || null,
          customerName: customer?.name || null,
          customerNameTamil: odooLocalizedText(customer?.name_tamil),
          customerNameSinhala: odooLocalizedText(customer?.name_sinhala),
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
      setLocalCustomerSig(null);
      setLocalDriverSig(null);
      setPartyInfo({});
      setOdooInvoiceNumber(null);
    } finally {
      setLoading(false);
    }
  }, [saleOrderId, route.params?.invoiceNumber, route.params?.invoiceLineQtys]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  useEffect(() => {
    if (!saleOrderId) return;
    if (!fromProceedPayment || !promptSignatures) return;
    const hasCust =
      (customerSignatureDataUrl && String(customerSignatureDataUrl).trim() !== '') ||
      (localCustomerSig && String(localCustomerSig).trim() !== '');
    const hasDrv =
      (driverSignatureDataUrl && String(driverSignatureDataUrl).trim() !== '') ||
      (localDriverSig && String(localDriverSig).trim() !== '');
    if (hasCust && hasDrv) return;
    setShowSignatureCaptureModal(true);
  }, [
    saleOrderId,
    fromProceedPayment,
    promptSignatures,
    localCustomerSig,
    localDriverSig,
    customerSignatureDataUrl,
    driverSignatureDataUrl,
  ]);

  useLayoutEffect(() => {
    if (!showSignatureCaptureModal) {
      signatureModalEnteredRef.current = false;
      return;
    }
    if (signatureModalEnteredRef.current) return;
    signatureModalEnteredRef.current = true;

    const c =
      localCustomerSig && String(localCustomerSig).trim() !== '' ? localCustomerSig : null;
    const d = localDriverSig && String(localDriverSig).trim() !== '' ? localDriverSig : null;
    setCaptureCustomerSig(c);
    setCaptureDriverSig(d);
    setCaptureCustomerSaved(!!c);
    setCaptureDriverSaved(!!d);
    setSignatureCaptureStep('customer');
    setSignatureModalSession((s) => s + 1);
  }, [showSignatureCaptureModal, localCustomerSig, localDriverSig]);

  useEffect(() => {
    setHideSyncIndicator(true);
    return () => setHideSyncIndicator(false);
  }, [setHideSyncIndicator]);

  const handleConnectToRongta = useCallback(async () => {
    if (!thermalPrinter?.address) {
      Alert.alert('Printer', 'Pick a paired printer first.');
      return;
    }
    try {
      await connect();
    } catch (e) {
      const msg = e?.message || 'Turn on Bluetooth and make sure the printer is paired.';
      Alert.alert('Could not connect', msg);
    }
  }, [thermalPrinter, connect]);

  const openThermalPrinterPicker = useCallback(async () => {
    if (!rongtaReady) return;
    setPrinterModalVisible(true);
    setLoadingPairedPrinters(true);
    setPairedPrinterRows([]);
    try {
      const list = await findBluetoothPrinters();
      setPairedPrinterRows(list);
    } catch (e) {
      Alert.alert('Bluetooth', e?.message || 'Could not load paired devices.');
    } finally {
      setLoadingPairedPrinters(false);
    }
  }, [rongtaReady]);

  const onInvoicePrinterHeaderPress = useCallback(() => {
    if (!rongtaReady) return;
    void openThermalPrinterPicker();
  }, [rongtaReady, openThermalPrinterPicker]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 2 }}>
          {rongtaReady ? (
            <TouchableOpacity
              onPress={onInvoicePrinterHeaderPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={thermalConnected ? 'Bluetooth printer connected' : 'Connect Bluetooth printer'}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginRight: 6,
                paddingVertical: 6,
                paddingHorizontal: 8,
                maxWidth: 140,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: thermalConnected ? 'rgba(187, 247, 208, 0.55)' : 'rgba(255, 255, 255, 0.5)',
                backgroundColor: thermalConnected ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.22)',
              }}
            >
              <Ionicons
                name="bluetooth"
                size={18}
                color={thermalConnected ? '#bbf7d0' : 'rgba(255,255,255,0.92)'}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: '700',
                  marginLeft: 5,
                  flexShrink: 1,
                }}
              >
                {thermalConnected ? 'Connected' : 'Not connected'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <SyncHeaderBadge variant="header" />
        </View>
      ),
    });
  }, [navigation, rongtaReady, thermalConnected, onInvoicePrinterHeaderPress]);

  const goToPaymentProofScreen = useCallback(async () => {
    if (saleOrderId != null) {
      try {
        await setCheckoutResumePhase(saleOrderId, 'payment_proof');
      } catch (e) {
        console.warn('[InvoiceScreen] setCheckoutResumePhase', e?.message ?? e);
      }
    }
    navigation.replace('PaymentProof', {
      saleOrderId,
      creditProofRequired: routeCreditProofRequired === true,
      orderName: routeOrderName,
      customerLabel: safeDisplay(resolveInvoiceCustomerDisplayName(order, partyInfo, appLanguage)) || routeOrderName,
    });
  }, [navigation, saleOrderId, routeCreditProofRequired, routeOrderName, order, partyInfo, appLanguage]);

  const backendSoInvoice =
    order?.invoice_number && String(order.invoice_number).trim()
      ? String(order.invoice_number).trim()
      : null;
  const effectiveInvoiceNumber = backendSoInvoice || odooInvoiceNumber || invoiceNumber;

  const buildInvoicePrintHtml = useCallback(async () => {
    if (!order) return null;
    const recomputeTotalsFromLines =
      previewBeforePayment ||
      (Array.isArray(invoiceLineQtys) && invoiceLineQtys.length > 0);
    const orderForPrint = recomputeTotalsFromLines
      ? (() => {
          const sub = invoiceVisibleLines.reduce((s, l) => s + (Number(l.price_subtotal) || 0), 0);
          const tax = invoiceVisibleLines.reduce(
            (s, l) => s + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)),
            0
          );
          return { ...order, amount_untaxed: sub, amount_tax: tax, amount_total: sub + tax };
        })()
      : order;
    const logoForPrint = await loadInvoiceLogoDataUriForPrint();
    const effectiveSplitForPrint =
      paymentType === 'split' && paymentSplit ? paymentSplit : localPaymentSplit || paymentSplit;
    const resolvedChequeBankName = chequeBankName || selectedBankName || localChequeMeta.bankName || null;
    const resolvedChequeNumber = checkNumber || localChequeMeta.checkNumber || null;
    const logoB64ForNative = extractRawBase64FromDataUri(logoForPrint);
    const user = await getUserSession();
    const vehicleNo =
      (user?.licensePlate && String(user.licensePlate).trim()) ||
      (user?.vehicleName && String(user.vehicleName).trim()) ||
      '';
    const printSessionOpts = {
      appLanguage,
      invoiceGeneratedAt: new Date(),
      salesRepName: user?.driverName && String(user.driverName).trim() ? user.driverName : '',
      vehicleNumber: vehicleNo,
    };
    const htmlForThermal = buildInvoiceHtml(
      orderForPrint,
      invoiceVisibleLines,
      paymentType,
      selectedBankName,
      effectiveSplitForPrint,
      logoForPrint,
      effectiveCustomerSignatureDataUrl,
      effectiveDriverSignatureDataUrl,
      resolvedChequeBankName,
      resolvedChequeNumber,
      effectiveInvoiceNumber,
      supplierTin,
      purchaserTin,
      partyInfo,
      { ...printSessionOpts, omitLogoBlock: true }
    );
    const htmlForSystem = buildInvoiceHtml(
      orderForPrint,
      invoiceVisibleLines,
      paymentType,
      selectedBankName,
      effectiveSplitForPrint,
      logoForPrint,
      effectiveCustomerSignatureDataUrl,
      effectiveDriverSignatureDataUrl,
      resolvedChequeBankName,
      resolvedChequeNumber,
      effectiveInvoiceNumber,
      supplierTin,
      purchaserTin,
      partyInfo,
      printSessionOpts
    );
    return { htmlForSystem, htmlForThermal, logoB64ForNative };
  }, [
    order,
    previewBeforePayment,
    invoiceLineQtys,
    invoiceVisibleLines,
    paymentType,
    paymentSplit,
    localPaymentSplit,
    chequeBankName,
    selectedBankName,
    localChequeMeta.bankName,
    checkNumber,
    localChequeMeta.checkNumber,
    appLanguage,
    effectiveCustomerSignatureDataUrl,
    effectiveDriverSignatureDataUrl,
    supplierTin,
    purchaserTin,
    partyInfo,
    loadInvoiceLogoDataUriForPrint,
    effectiveInvoiceNumber,
  ]);

  const handlePrint = useCallback(async () => {
    if (!order) return;
    if (openPaymentProofAfterPrint && promptSignatures) {
      const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
      const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
      if (!hasCust || !hasDrv) {
        Alert.alert('Signatures needed', 'Add customer and driver signatures before printing.');
        setShowSignatureCaptureModal(true);
        return;
      }
    }
    const skipEv = route.params?.skipEvidenceModal === true;
    const wantSig = route.params?.promptSignatures === true;
    const openAfterPrint = () => {
      if (openPaymentProofAfterPrint) {
        void goToPaymentProofScreen();
        return;
      }
      if (skipEv) {
        if (wantSig) setShowSignatureCaptureModal(true);
      } else {
        setShowEvidenceModal(true);
      }
    };
    setPrinting(true);
    setPrintResult(null);
    setPrintError(null);
    try {
      const payload = await buildInvoicePrintHtml();
      if (!payload) throw new Error('Invoice content is not ready yet.');
      const { htmlForThermal, htmlForSystem, logoB64ForNative } = payload;

      if (rongtaReady && thermalConnected && thermalPrinter?.address) {
        try {
          if (!logoB64ForNative) {
            throw new Error('Could not load the invoice logo. Try again.');
          }
          const { uri } = await Print.printToFileAsync({
            html: htmlForThermal,
            width: THERMAL_INVOICE_PDF_WIDTH_PT,
            height: THERMAL_INVOICE_PDF_HEIGHT_PT,
          });
          await printPdfFileToRongta(
            uri,
            thermalPrinter,
            { headerLogoBase64: logoB64ForNative }
          );
          openAfterPrint();
          setPrintResult(null);
          return;
        } catch (thermalPdfErr) {
          console.warn('[InvoiceScreen] thermal print blocked/failure', thermalPdfErr?.message);
          throw thermalPdfErr;
        }
      }

      await Print.printAsync({ html: htmlForSystem });
      openAfterPrint();
      setPrintResult(null);
    } catch (err) {
      console.error(err);
      setPrintResult('failed');
      setPrintError(
        err?.message ||
          'Could not print. Use the header Bluetooth menu to pair and connect, or use the system print dialog.'
      );
    } finally {
      setPrinting(false);
      setHideSyncIndicator(false);
    }
  }, [
    order,
    previewBeforePayment,
    buildInvoicePrintHtml,
    rongtaReady,
    thermalPrinter,
    thermalConnected,
    route.params?.skipEvidenceModal,
    route.params?.promptSignatures,
    openPaymentProofAfterPrint,
    localCustomerSig,
    localDriverSig,
    goToPaymentProofScreen,
    fromProceedPayment,
    invoiceLineQtys,
  ]);

  /** System print / preview dialog only (no navigation, no Bluetooth thermal). */
  const handlePreviewPrintInvoice = useCallback(async () => {
    if (!order) return;
    if (openPaymentProofAfterPrint && promptSignatures) {
      const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
      const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
      if (!hasCust || !hasDrv) {
        Alert.alert('Signatures needed', 'Add customer and driver signatures before preview.');
        setShowSignatureCaptureModal(true);
        return;
      }
    }
    setPreviewing(true);
    setPrintError(null);
    try {
      const payload = await buildInvoicePrintHtml();
      if (!payload) throw new Error('Invoice content is not ready yet.');
      const { htmlForSystem } = payload;
      await Print.printAsync({ html: htmlForSystem });
    } catch (err) {
      console.error(err);
      setPrintError(
        err?.message ||
          'Could not open preview. Try again, or use Print invoice to open the system print dialog.'
      );
    } finally {
      setPreviewing(false);
    }
  }, [
    order,
    buildInvoicePrintHtml,
    openPaymentProofAfterPrint,
    promptSignatures,
    localCustomerSig,
    localDriverSig,
  ]);

  const goToHome = useCallback(async () => {
    try {
      if (fromProceedPayment && !openPaymentProofAfterPrint && saleOrderId != null) {
        await clearCheckoutResume(saleOrderId);
      }
    } catch (e) {
      console.warn('[InvoiceScreen] clearCheckoutResume', e?.message ?? e);
    }
    navigation.navigate('MainTabs', { screen: 'Dashboard' });
  }, [navigation, fromProceedPayment, openPaymentProofAfterPrint, saleOrderId]);

  const effectivePaymentSplit = (paymentType === 'split' && paymentSplit)
    ? paymentSplit
    : localPaymentSplit;

  const handleSaveEvidence = useCallback(async () => {
    const isCreditFlow = !previewBeforePayment && (((effectivePaymentSplit?.credit ?? 0) > 0) || paymentType === 'credit');
    const goNextAfterEvidence = () => {
      if (previewBeforePayment) {
        navigation.navigate('ProceedPayment', {
          saleOrderId,
          total: routeTotalParam,
          subtotal: routeSubtotalParam,
          tax: routeTaxParam,
          deliveryDone: routeDeliveryDone,
          deliveryPayload,
          invoiceLineQtys,
        });
      } else {
        void goToHome();
      }
    };
    if (isCreditFlow && deliveryPhotos.length === 0) {
      Alert.alert('Photo needed', 'Credit payment needs at least one evidence photo.');
      return;
    }

    if (deliveryPhotos.length === 0) {
      runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence skip', e?.message ?? e));
      goNextAfterEvidence();
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
      goNextAfterEvidence();
    } catch (err) {
      console.error('[InvoiceScreen] save evidence failed', err);
      Alert.alert('Save failed', 'Could not save photos. Try again.');
    } finally {
      setSavingEvidence(false);
    }
  }, [
    deliveryPhotos,
    saleOrderId,
    goToHome,
    navigation,
    previewBeforePayment,
    routeTotalParam,
    routeSubtotalParam,
    routeTaxParam,
    routeDeliveryDone,
    deliveryPayload,
    effectivePaymentSplit,
    paymentType,
    invoiceLineQtys,
  ]);

  /** Subtotal from current invoice rows (zero-qty rows naturally add 0). */
  const computedSubtotal = useMemo(() => {
    if (!invoiceVisibleLines?.length) return 0;
    return invoiceVisibleLines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
  }, [invoiceVisibleLines]);

  const computedTax = useMemo(() => {
    if (!invoiceVisibleLines?.length) return 0;
    return invoiceVisibleLines.reduce(
      (sum, l) => sum + ((Number(l.price_total) || 0) - (Number(l.price_subtotal) || 0)),
      0
    );
  }, [invoiceVisibleLines]);

  const hasLineBasedTotals = (invoiceVisibleLines?.length || 0) > 0;

  const displaySubtotal = useMemo(() => {
    if ((previewBeforePayment || fromProceedPayment) && routeSubtotalParam != null) {
      const n = Number(routeSubtotalParam);
      if (Number.isFinite(n)) return n;
    }
    // Keep subtotal aligned with displayed line rows (including extra qty adjustments).
    if (hasLineBasedTotals) return computedSubtotal;
    return (order?.amount_untaxed != null && order.amount_untaxed !== 0)
      ? order.amount_untaxed
      : computedSubtotal;
  }, [
    previewBeforePayment,
    fromProceedPayment,
    routeSubtotalParam,
    hasLineBasedTotals,
    computedSubtotal,
    order?.amount_untaxed,
  ]);

  const displayTax = useMemo(() => {
    if ((previewBeforePayment || fromProceedPayment) && routeTaxParam != null) {
      const n = Number(routeTaxParam);
      if (Number.isFinite(n)) return n;
    }
    if (hasLineBasedTotals) return computedTax;
    return (order?.amount_tax != null && order.amount_tax !== 0)
      ? order.amount_tax
      : computedTax;
  }, [
    previewBeforePayment,
    fromProceedPayment,
    routeTaxParam,
    hasLineBasedTotals,
    computedTax,
    order?.amount_tax,
  ]);

  const displayTotal = useMemo(() => {
    if ((previewBeforePayment || fromProceedPayment) && routeTotalParam != null) {
      const n = Number(routeTotalParam);
      if (Number.isFinite(n)) return n;
    }
    if (hasLineBasedTotals) return displaySubtotal + displayTax;
    return order?.amount_total ?? routeTotalParam ?? (displaySubtotal + displayTax);
  }, [
    previewBeforePayment,
    fromProceedPayment,
    routeTotalParam,
    hasLineBasedTotals,
    order?.amount_total,
    displaySubtotal,
    displayTax,
  ]);

  /** Persist signatures even when no local invoice row yet (invoice row is finalized later on payment proof complete). */
  const persistCapturedSignatures = useCallback(
    async (rawCust, rawDrv) => {
      const norm = (raw) => {
        if (raw == null || typeof raw !== 'string') return '';
        const s = raw.trim();
        if (s === '' || s === '[object Object]') return '';
        return s;
      };
      const custSig = norm(rawCust);
      const drvSig = norm(rawDrv);
      const existing = await localInvoicesDb.getLocalInvoiceBySaleOrderId(saleOrderId);

      let invNumber =
        existing?.invoice_number ??
        (order?.invoice_number && String(order.invoice_number).trim() ? String(order.invoice_number).trim() : null) ??
        invoiceNumber ??
        null;
      if (invNumber == null || String(invNumber).trim() === '') {
        try {
          invNumber = await getOrAssignInvoiceNumber(saleOrderId, {
            saleOrderName: order?.name,
            backendInvoiceNumber: order?.invoice_number,
          });
          setInvoiceNumber(invNumber);
        } catch (_) {
          invNumber = `INV-${saleOrderId}`;
        }
      }

      const amountTotal =
        existing?.amount_total != null && existing.amount_total !== ''
          ? Number(existing.amount_total)
          : Number(displayTotal) || Number(order?.amount_total) || 0;
      const amountUntaxed =
        existing?.amount_untaxed != null && existing.amount_untaxed !== ''
          ? Number(existing.amount_untaxed)
          : Number(displaySubtotal) || Number(order?.amount_untaxed) || amountTotal;
      const amountTax =
        existing?.amount_tax != null && existing.amount_tax !== ''
          ? Number(existing.amount_tax)
          : Number(displayTax) || Number(order?.amount_tax) || 0;

      await localInvoicesDb.upsertLocalInvoice({
        sale_order_id: Number(saleOrderId),
        invoice_number: String(invNumber),
        amount_total: amountTotal,
        amount_untaxed: amountUntaxed,
        amount_tax: amountTax,
        state: existing?.state || 'posted',
        customer_signature_data: custSig,
        driver_signature_data: drvSig,
      });
      setLocalCustomerSig(custSig || null);
      setLocalDriverSig(drvSig || null);
      setShowSignatureCaptureModal(false);
      setCaptureCustomerSig(null);
      setCaptureDriverSig(null);
      setCaptureCustomerSaved(false);
      setCaptureDriverSaved(false);
      setSignatureCaptureStep('customer');
      captureCustomerRef.current?.clearSignature();
      captureDriverRef.current?.clearSignature();
      navigation.setParams({ promptSignatures: false });
    },
    [
      saleOrderId,
      navigation,
      invoiceNumber,
      displayTotal,
      displaySubtotal,
      displayTax,
      order?.amount_total,
      order?.amount_untaxed,
      order?.amount_tax,
      order?.name,
      order?.invoice_number,
    ]
  );

  const navigateToProceedPayment = useCallback(() => {
    navigation.navigate('ProceedPayment', {
      saleOrderId,
      total: displayTotal,
      subtotal: displaySubtotal,
      tax: displayTax,
      deliveryDone: routeDeliveryDone,
      deliveryPayload,
      invoiceLineQtys,
    });
  }, [
    navigation,
    saleOrderId,
    displayTotal,
    displaySubtotal,
    displayTax,
    routeDeliveryDone,
    deliveryPayload,
    invoiceLineQtys,
  ]);

  const handlePrintFailContinueWithoutPrinting = useCallback(() => {
    setPrintResult(null);
    setPrintError(null);
    if (previewBeforePayment) {
      navigateToProceedPayment();
      return;
    }
    if (openPaymentProofAfterPrint && promptSignatures) {
      const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
      const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
      if (!hasCust || !hasDrv) {
        Alert.alert('Signatures needed', 'Add customer and driver signatures first.');
        setShowSignatureCaptureModal(true);
        return;
      }
    }
    if (openPaymentProofAfterPrint) {
      void goToPaymentProofScreen();
      return;
    }
    if (skipEvidenceModal) {
      if (promptSignatures) {
        const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
        const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
        if (!hasCust || !hasDrv) {
          setShowSignatureCaptureModal(true);
          return;
        }
      }
      void goToHome();
      return;
    }
    setShowEvidenceModal(true);
  }, [
    previewBeforePayment,
    navigateToProceedPayment,
    openPaymentProofAfterPrint,
    localCustomerSig,
    localDriverSig,
    skipEvidenceModal,
    promptSignatures,
    goToPaymentProofScreen,
    goToHome,
  ]);

  const paymentLabel = (() => {
    if (previewBeforePayment) {
      return 'Pending — complete payment on the next screen';
    }
    const split = effectivePaymentSplit;
    if (paymentSplitHasLineItems(split)) {
      const cash = Number(split.cash) || 0;
      const chq = Number(split.check ?? split.cheque) || 0;
      const cred = Number(split.credit) || 0;
      return [
        cash > 0 && `Cash ${formatInvoiceCurrency(cash)}`,
        chq > 0 && `Cheque ${formatInvoiceCurrency(chq)}`,
        cred > 0 && `Credit ${formatInvoiceCurrency(cred)}`,
      ]
        .filter(Boolean)
        .join(' • ') || 'Payment';
    }
    if ((paymentType === 'bank' || paymentType === 'check') && selectedBankName) {
      return `Check: ${selectedBankName}`;
    }
    if (paymentType === 'credit' && selectedBankName) {
      return `Credit: ${selectedBankName}`;
    }
    if (paymentType != null || selectedBankName != null || paymentSplit != null) {
      return 'Cash';
    }
    return 'Invoiced';
  })();

  const hasCreditPayment = (effectivePaymentSplit?.credit ?? 0) > 0 || paymentType === 'credit';
  const evidenceRequired = !previewBeforePayment && hasCreditPayment;
  const emptyCollectionLabel = useMemo(() => {
    const rows = Array.isArray(routeEmptyCylinderEntries) ? routeEmptyCylinderEntries : [];
    if (rows.length === 0) return '';
    const parts = rows
      .filter((r) => Number(r?.emptyCollectedQty) > 0)
      .map((r) => `${Number(r.kg)}kg: ${Number(r.emptyCollectedQty)}`);
    if (parts.length === 0) return 'Empty collected: 0';
    return `Empty collected: ${parts.join(' • ')}`;
  }, [routeEmptyCylinderEntries]);

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const invoiceDate = resolveInvoiceDateSource(order).toLocaleDateString('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Invoice preview */}
      <View style={styles.previewCard}>
        <Image source={INVOICE_LOGO_ASSET} style={styles.logo} resizeMode="contain" />
        <Text style={styles.invoiceTitle}>Tax Invoice</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Invoice No.</Text>
          <Text style={styles.metaValue}>{effectiveInvoiceNumber ?? '—'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('invoice.date', 'Date')}</Text>
          <Text style={styles.metaValue}>{invoiceDate}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('invoice.customer', 'Customer')}</Text>
          <Text style={styles.metaValue} numberOfLines={2}>
            {resolveInvoiceCustomerDisplayName(order, partyInfo, appLanguage)}
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
            <Text style={[styles.th, styles.thProduct]}>{t('invoice.product', 'Product')}</Text>
            <Text style={[styles.th, styles.thQty]}>Qty</Text>
            <Text style={[styles.th, styles.thTax]}>Unit Price</Text>
            <Text style={[styles.th, styles.thTotal]}>{t('invoice.total', 'Total')}</Text>
          </View>
          {(invoiceVisibleLines || []).map((line, index) => {
            const lineUnitPrice = resolveInvoiceLineUnitPrice(line);
            const lineQty = Number(line.product_uom_qty) || 0;
            const lineTotal =
              lineQty > 0 && Number(line.price_subtotal) > 0
                ? Number(line.price_subtotal)
                : lineQty * lineUnitPrice;
            return (
              <View
                key={line.id}
                style={[styles.tableRow, index === (invoiceVisibleLines?.length ?? 0) - 1 && styles.tableRowLast]}
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
            <Text style={styles.totalsLabel}>{t('invoice.subtotal', 'Subtotal')}</Text>
            <Text style={styles.totalsValue}>
              {formatInvoiceCurrency(displaySubtotal)}
            </Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{t('invoice.vAT', 'VAT')}</Text>
            <Text style={styles.totalsValue}>
              {formatInvoiceCurrency(displayTax)}
            </Text>
          </View>
          <View style={[styles.totalsRow, styles.totalsRowMain]}>
            <Text style={styles.totalsLabelMain}>{t('invoice.total', 'Total')}</Text>
            <Text style={styles.totalsValueMain}>
              {formatInvoiceCurrency(displayTotal)}
            </Text>
          </View>
        </View>
        <View style={styles.paymentBadge}>
          <Text style={styles.paymentText}>Payment: {paymentLabel}</Text>
        </View>
        {emptyCollectionLabel ? (
          <View style={styles.paymentBadge}>
            <Text style={styles.paymentText}>{emptyCollectionLabel}</Text>
          </View>
        ) : null}
        {previewBeforePayment ? (
          <TouchableOpacity
            style={[styles.printBtn, { marginTop: spacing.md }]}
            onPress={navigateToProceedPayment}
            activeOpacity={0.85}
          >
            <Ionicons name="card-outline" size={22} color="#fff" />
            <Text style={styles.printBtnText}>{t('invoice.proceedToPayment', 'Proceed to payment')}</Text>
          </TouchableOpacity>
        ) : null}
        {(effectiveCustomerSignatureDataUrl || effectiveDriverSignatureDataUrl) ? (
          <View
            style={{
              marginTop: spacing.sm,
              paddingTop: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                width: '100%',
              }}
            >
              <View style={{ flex: 1, maxWidth: '48%', alignItems: 'flex-start', paddingRight: 4 }}>
                <Text style={[styles.totalsLabel, { marginBottom: 4, alignSelf: 'stretch', textAlign: 'left' }]}>
                  Driver signature
                </Text>
                {effectiveDriverSignatureDataUrl ? (
                  <Image
                    source={{ uri: effectiveDriverSignatureDataUrl }}
                    style={{ width: 140, height: 70, resizeMode: 'contain', alignSelf: 'flex-start' }}
                  />
                ) : (
                  <View
                    style={{
                      width: 140,
                      height: 70,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: colors.border,
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1, maxWidth: '48%', alignItems: 'flex-end', paddingLeft: 4 }}>
                <Text style={[styles.totalsLabel, { marginBottom: 4, alignSelf: 'stretch', textAlign: 'right' }]}>
                  Customer signature
                </Text>
                {effectiveCustomerSignatureDataUrl ? (
                  <Image
                    source={{ uri: effectiveCustomerSignatureDataUrl }}
                    style={{ width: 140, height: 70, resizeMode: 'contain', alignSelf: 'flex-end' }}
                  />
                ) : (
                  <View
                    style={{
                      width: 140,
                      height: 70,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: colors.border,
                      alignSelf: 'flex-end',
                    }}
                  />
                )}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <Modal
        visible={printerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (connectingThermal) return;
          setPrinterModalVisible(false);
        }}
      >
        <View style={styles.printerPickBackdrop}>
          <View style={styles.printerPickSheet}>
            <View style={{ position: 'relative', paddingTop: 4, marginBottom: spacing.sm }}>
              <View style={styles.printerPickHandle} />
              <TouchableOpacity
                onPress={() => {
                  if (connectingThermal) return;
                  setPrinterModalVisible(false);
                }}
                disabled={connectingThermal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.printerPickCloseBtn, connectingThermal && { opacity: 0.45 }]}
                activeOpacity={0.75}
              >
                <Text style={styles.printerPickCloseBtnText}>{t('invoice.close', 'Close')}</Text>
                <Ionicons name="close-circle" size={26} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.printerPickHero}>
              <View style={styles.printerPickIconCircle}>
                <Ionicons name="bluetooth" size={28} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.printerPickHeadTitle}>{t('invoice.bluetoothPrinter', 'Bluetooth printer')}</Text>
                <Text style={styles.printerPickHeadSub}>
                  Choose a paired device, then print. This sheet tries to connect for you — use Connect if it does not link, or Clear saved printer to pick another device.
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.printerPickStatusPill,
                {
                  backgroundColor: connectingThermal
                    ? `${colors.primary}18`
                    : thermalConnected
                      ? `${colors.success ?? '#22c55e'}26`
                      : thermalPrinter?.address
                        ? `${colors.warning ?? '#d97706'}26`
                        : colors.background,
                  borderWidth: 1,
                  borderColor: connectingThermal
                    ? `${colors.primary}44`
                    : thermalConnected
                      ? `${colors.success ?? '#22c55e'}55`
                      : thermalPrinter?.address
                        ? `${colors.warning ?? '#d97706'}55`
                        : colors.border,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {connectingThermal ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
                <Text
                  style={[
                    styles.printerPickStatusText,
                    {
                      flex: 1,
                      color: connectingThermal
                        ? colors.primary
                        : thermalConnected
                          ? colors.success ?? '#15803d'
                          : thermalPrinter?.address
                            ? colors.warning ?? '#b45309'
                            : colors.textSecondary,
                    },
                  ]}
                >
                  {connectingThermal
                    ? 'Connecting…'
                    : thermalConnected
                      ? `Ready · ${thermalPrinter?.name || 'Printer'}`
                      : thermalPrinter?.name
                        ? `${thermalPrinter.name} — tap Connect`
                        : 'Pick a printer from the list'}
                </Text>
              </View>
            </View>
            <View style={styles.printerPickActions}>
              {thermalPrinter?.address && !thermalConnected && !connectingThermal ? (
                <TouchableOpacity
                  style={styles.printerPickPrimaryBtn}
                  onPress={() => void handleConnectToRongta()}
                  activeOpacity={0.85}
                >
                  <Ionicons name="link" size={20} color="#fff" />
                  <Text style={styles.printerPickPrimaryBtnText}>{t('invoice.connectNow', 'Connect now')}</Text>
                </TouchableOpacity>
              ) : null}
              {thermalPrinter?.address ? (
                <TouchableOpacity
                  style={styles.printerPickOutlineBtn}
                  onPress={() => void clearPrinter()}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error || '#b91c1c'} />
                  <Text style={styles.printerPickOutlineBtnText}>{t('invoice.clearSavedPrinter', 'Clear saved printer')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.printerPickGhostBtn}
                onPress={() => {
                  if (connectingThermal) return;
                  setPrinterModalVisible(false);
                  navigation.navigate('BluetoothPrinter');
                }}
                disabled={connectingThermal}
                activeOpacity={0.85}
              >
                <Text style={styles.printerPickGhostBtnText}>{t('invoice.fullBluetoothSettings', 'Full Bluetooth settings')}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.printerPickHeader, { marginTop: spacing.xs }]}>
              <Text style={styles.printerPickTitle}>{t('invoice.pairedDevices', 'Paired devices')}</Text>
            </View>
            <TouchableOpacity
              style={[styles.thermalPrinterBtn, { alignSelf: 'flex-start', marginBottom: spacing.sm }]}
              onPress={() => void openThermalPrinterPicker()}
              disabled={loadingPairedPrinters}
            >
              {loadingPairedPrinters ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={20} color={colors.primary} />
              )}
              <Text style={styles.thermalPrinterBtnText}>{t('invoice.refreshList', 'Refresh list')}</Text>
            </TouchableOpacity>
            <FlatList
              data={pairedPrinterRows}
              keyExtractor={(item) => item.address}
              style={{ flexGrow: 0 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.printerPickRow}
                  onPress={async () => {
                    if (connectingThermal) return;
                    await selectPrinter(item);
                  }}
                >
                  <Text style={styles.printerPickName}>{item.name}</Text>
                  <Text style={styles.printerPickAddr}>{item.address}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                loadingPairedPrinters ? null : (
                  <Text style={{ color: colors.textSecondary, paddingVertical: 16 }}>
                    No paired printers. Pair in phone Settings, then refresh.
                  </Text>
                )
              }
            />
          </View>
        </View>
      </Modal>

      {rongtaPrintBlocked ? (
        <Text style={styles.printBlockedHint}>
          Use the Bluetooth icon in the header, choose a printer, tap Connect — then you can print.
        </Text>
      ) : null}

      {/* Print invoice button - hidden after print so modal offers Re-print */}
      {printResult == null && (
        <TouchableOpacity
          style={[styles.printBtn, (printing || previewing || rongtaPrintBlocked) && styles.printBtnDisabled]}
          onPress={handlePrint}
          disabled={printing || previewing || rongtaPrintBlocked}
          activeOpacity={0.8}
        >
          {printing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="print-outline" size={24} color="#fff" />
              <Text style={styles.printBtnText}>{t('invoice.printInvoice', 'Print invoice')}</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {printResult == null && (
        <TouchableOpacity
          style={[styles.previewPrintBtn, (printing || previewing) && styles.printBtnDisabled]}
          onPress={() => void handlePreviewPrintInvoice()}
          disabled={printing || previewing}
          activeOpacity={0.8}
        >
          {previewing && !printing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={22} color={colors.primary} />
              <Text style={styles.previewPrintBtnText}>
                {t('invoice.previewPrintInvoice', 'Preview print invoice')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {printResult == null && (
        <TouchableOpacity
          style={styles.skipPrintBtn}
          onPress={() => {
            if (previewBeforePayment) {
              navigateToProceedPayment();
              return;
            }
            if (openPaymentProofAfterPrint && promptSignatures) {
              const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
              const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
              if (!hasCust || !hasDrv) {
                Alert.alert('Signatures needed', 'Add customer and driver signatures first.');
                setShowSignatureCaptureModal(true);
                return;
              }
            }
            if (openPaymentProofAfterPrint) {
              void goToPaymentProofScreen();
              return;
            }
            if (skipEvidenceModal) {
              if (promptSignatures) {
                const hasCust = localCustomerSig && String(localCustomerSig).trim() !== '';
                const hasDrv = localDriverSig && String(localDriverSig).trim() !== '';
                if (!hasCust || !hasDrv) {
                  setShowSignatureCaptureModal(true);
                  return;
                }
              }
              void goToHome();
              return;
            }
            setShowEvidenceModal(true);
          }}
          disabled={printing || previewing}
          activeOpacity={0.8}
        >
          <Ionicons name="play-forward-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.skipPrintBtnText}>
            {previewBeforePayment ? 'Skip print, go to payment' : 'Skip invoice printing'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Printing / preview overlay - full screen until system dialog is shown */}
      {(printing || previewing) && (
        <View style={styles.printOverlay} pointerEvents="box-only">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.printOverlayText}>
            {previewing && !printing
              ? t('invoice.openingPreview', 'Opening preview…')
              : t('invoice.printing', 'Printing…')}
          </Text>
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
                ? 'Sent to the printer.'
                : `${printError || 'Could not print.'}\n\nTry again, skip printing, or go to the dashboard. Finish payment proof when you can.`}
            </Text>
            <View style={styles.resultModalActionsColumn}>
              <TouchableOpacity
                style={[styles.resultModalBtn, styles.resultModalBtnPrimary, { width: '100%', flex: 0 }]}
                onPress={() => {
                  setPrintResult(null);
                  setPrintError(null);
                  handlePrint();
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="print-outline" size={22} color="#fff" />
                <Text style={styles.resultModalBtnTextPrimary}>{t('invoice.rePrint', 'Re-print')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultModalBtn, styles.resultModalBtnSecondary, { width: '100%', flex: 0 }]}
                onPress={handlePrintFailContinueWithoutPrinting}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-forward-circle-outline" size={22} color={colors.primary} />
                <Text style={styles.resultModalBtnTextSecondary}>{t('invoice.continueWithoutPrinting', 'Continue without printing')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resultModalLinkBtn} onPress={() => void goToHome()} activeOpacity={0.75}>
                <Text style={[styles.resultModalLinkText, { color: colors.textSecondary }]}>
                  Go to dashboard
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSignatureCaptureModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (blockSignatureModalDismiss) {
            Alert.alert(
              'Signatures needed',
              'Add both signatures, then tap Save signatures. Use the tabs to switch between customer and driver.'
            );
            return;
          }
          setShowSignatureCaptureModal(false);
        }}
      >
        <View style={styles.sigCapOverlay}>
          <View style={[styles.sigCapCard, { backgroundColor: colors.surface }]}>
            <View style={styles.sigCapHero}>
              <View style={styles.sigCapHeroIconWrap}>
                <Ionicons name="create-outline" size={32} color={colors.primary} />
              </View>
              <Text style={styles.sigCapHeroTitle}>{t('invoice.signToConfirmDelivery', 'Sign to confirm delivery')}</Text>
              <Text style={styles.sigCapHeroSubtitle}>
                {blockSignatureModalDismiss
                  ? 'Add customer and driver signatures, then tap Save signatures.'
                  : 'Add signatures if you can. You can close when they are optional.'}
              </Text>
            </View>

            <View style={styles.sigCapTabs}>
              <TouchableOpacity
                style={[styles.sigCapTab, signatureCaptureStep === 'customer' && styles.sigCapTabActive]}
                onPress={() => setSignatureCaptureStep('customer')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.sigCapTabText,
                    signatureCaptureStep === 'customer' && styles.sigCapTabTextActive,
                  ]}
                >
                  Customer signature
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sigCapTab, signatureCaptureStep === 'driver' && styles.sigCapTabActive]}
                onPress={() => setSignatureCaptureStep('driver')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.sigCapTabText,
                    signatureCaptureStep === 'driver' && styles.sigCapTabTextActive,
                  ]}
                >
                  Driver signature
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sigCapSection}>
              <View style={styles.sigCapCanvasWrapStack}>
                <View
                  style={[
                    styles.sigCapCanvasLayer,
                    {
                      opacity: signatureCaptureStep === 'customer' ? 1 : 0,
                      zIndex: signatureCaptureStep === 'customer' ? 2 : 0,
                    },
                  ]}
                  pointerEvents={signatureCaptureStep === 'customer' ? 'auto' : 'none'}
                >
                  <SignatureCanvas
                    key={`${signatureModalSession}-customer`}
                    ref={captureCustomerRef}
                    dataURL={
                      captureCustomerSig && String(captureCustomerSig).trim() !== ''
                        ? captureCustomerSig
                        : ''
                    }
                    onOK={(dataUrl) => {
                      setCaptureCustomerSig(dataUrl);
                      setCaptureCustomerSaved(true);
                      setSignatureCaptureStep('driver');
                    }}
                    onEmpty={() => {
                      Alert.alert('Signature', 'Sign in the box, then tap Save customer.');
                    }}
                    descriptionText=""
                    clearText=""
                    confirmText=""
                    penColor="#000000"
                    backgroundColor="rgba(255,255,255,1)"
                    style={styles.sigCapCanvasLarge}
                    autoClear={false}
                    webStyle={`.m-signature-pad--footer { display: none !important; }`}
                  />
                </View>
                <View
                  style={[
                    styles.sigCapCanvasLayer,
                    {
                      opacity: signatureCaptureStep === 'driver' ? 1 : 0,
                      zIndex: signatureCaptureStep === 'driver' ? 2 : 0,
                    },
                  ]}
                  pointerEvents={signatureCaptureStep === 'driver' ? 'auto' : 'none'}
                >
                  <SignatureCanvas
                    key={`${signatureModalSession}-driver`}
                    ref={captureDriverRef}
                    dataURL={
                      captureDriverSig && String(captureDriverSig).trim() !== '' ? captureDriverSig : ''
                    }
                    onOK={(dataUrl) => {
                      setCaptureDriverSig(dataUrl);
                      setCaptureDriverSaved(true);
                    }}
                    onEmpty={() => {
                      Alert.alert('Signature', 'Sign in the box, then tap Save driver.');
                    }}
                    descriptionText=""
                    clearText=""
                    confirmText=""
                    penColor="#000000"
                    backgroundColor="rgba(255,255,255,1)"
                    style={styles.sigCapCanvasLarge}
                    autoClear={false}
                    webStyle={`.m-signature-pad--footer { display: none !important; }`}
                  />
                </View>
              </View>

              {signatureCaptureStep === 'customer' ? (
                <View style={styles.sigCapBtnRow}>
                  <TouchableOpacity
                    style={styles.sigCapBtn}
                    onPress={() => {
                      captureCustomerRef.current?.clearSignature();
                      setCaptureCustomerSig(null);
                      setCaptureCustomerSaved(false);
                    }}
                  >
                    <Text style={styles.sigCapBtnText}>{t('invoice.clear', 'Clear')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.sigCapBtn,
                      captureCustomerSaved ? styles.sigCapBtnSaved : styles.sigCapBtnPrimary
                    ]}
                    onPress={() => captureCustomerRef.current?.readSignature()}
                  >
                    <Text style={captureCustomerSaved ? styles.sigCapBtnTextSaved : styles.sigCapBtnTextLight}>
                      {captureCustomerSaved ? 'Saved' : 'Save customer'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.sigCapBtnRow}>
                  <TouchableOpacity
                    style={styles.sigCapBtn}
                    onPress={() => {
                      captureDriverRef.current?.clearSignature();
                      setCaptureDriverSig(null);
                      setCaptureDriverSaved(false);
                    }}
                  >
                    <Text style={styles.sigCapBtnText}>{t('invoice.clear', 'Clear')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.sigCapBtn,
                      captureDriverSaved ? styles.sigCapBtnSaved : styles.sigCapBtnPrimary
                    ]}
                    onPress={() => captureDriverRef.current?.readSignature()}
                  >
                    <Text style={captureDriverSaved ? styles.sigCapBtnTextSaved : styles.sigCapBtnTextLight}>
                      {captureDriverSaved ? 'Saved' : 'Save driver'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.sigCapDoneBtn,
                (!captureCustomerSaved || !captureDriverSaved) && styles.sigCapDoneBtnDisabled,
              ]}
              onPress={() => {
                const custOk =
                  captureCustomerSig && String(captureCustomerSig).trim() !== '' && captureCustomerSaved;
                const drvOk =
                  captureDriverSig && String(captureDriverSig).trim() !== '' && captureDriverSaved;
                if (!custOk || !drvOk) {
                  Alert.alert(
                    'Signatures',
                    'Use Save customer and Save driver on each tab, then tap Continue.'
                  );
                  return;
                }
                void persistCapturedSignatures(captureCustomerSig, captureDriverSig);
              }}
              activeOpacity={0.88}
              disabled={!captureCustomerSaved || !captureDriverSaved}
            >
              <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
              <Text style={styles.evidenceSaveBtnText}>{t('invoice.continue', 'Continue')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEvidenceModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (evidenceRequired && deliveryPhotos.length === 0 && !savingEvidence) {
            Alert.alert('Photo needed', 'Credit payment needs at least one photo.');
            return;
          }
          setShowEvidenceModal(false);
          setDeliveryPhotos([]);
          runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence close', e?.message ?? e));
          if (previewBeforePayment) {
            navigation.navigate('ProceedPayment', {
              saleOrderId,
              total: routeTotalParam,
              subtotal: routeSubtotalParam,
              tax: routeTaxParam,
              deliveryDone: routeDeliveryDone,
              deliveryPayload,
              invoiceLineQtys,
            });
          } else {
            void goToHome();
          }
        }}
      >
        <View style={styles.evidenceModalOverlay}>
          <ScrollView style={styles.evidenceModalContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            <Text style={styles.evidenceModalTitle}>{t('invoice.deliveryPhotos', 'Delivery photos')}</Text>
            <Text style={styles.evidenceModalHint}>
              {evidenceRequired
                ? 'Credit: add at least one photo.'
                : 'Optional — add photos if you want a record.'}
            </Text>

            {deliveryPhotos.length < MAX_PHOTOS && (
              <View style={styles.evidencePhotoButtonsRow}>
                <TouchableOpacity
                  style={styles.evidencePhotoBtn}
                  onPress={async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission', 'Allow camera to take a photo.');
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
                  <Text style={styles.evidencePhotoBtnText}>{t('invoice.takePhoto', 'Take photo')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.evidencePhotoBtn}
                  onPress={async () => {
                    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission', 'Allow photos to pick from gallery.');
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
                  <Text style={styles.evidencePhotoBtnText}>{t('invoice.choosePhoto', 'Choose photo')}</Text>
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
              style={[
                styles.evidenceSaveBtn,
                evidenceRequired && deliveryPhotos.length === 0 && { opacity: 0.5 },
              ]}
              onPress={handleSaveEvidence}
              disabled={savingEvidence || (evidenceRequired && deliveryPhotos.length === 0)}
              activeOpacity={0.8}
            >
              {savingEvidence ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
                  <Text style={styles.evidenceSaveBtnText}>{deliveryPhotos.length > 0 || evidenceRequired ? 'Save & Continue' : 'Skip'}</Text>
                </>
              )}
            </TouchableOpacity>

            {deliveryPhotos.length > 0 && !evidenceRequired && (
              <TouchableOpacity
                style={styles.evidenceSkipBtn}
                onPress={() => {
                  setShowEvidenceModal(false);
                  setDeliveryPhotos([]);
                  runSync().catch((e) => console.warn('[InvoiceScreen] sync after evidence skip', e?.message ?? e));
                  if (previewBeforePayment) {
                    navigation.navigate('ProceedPayment', {
                      saleOrderId,
                      total: routeTotalParam,
                      subtotal: routeSubtotalParam,
                      tax: routeTaxParam,
                      deliveryDone: routeDeliveryDone,
                      deliveryPayload,
                      invoiceLineQtys,
                    });
                  } else {
                    void goToHome();
                  }
                }}
                disabled={savingEvidence}
                activeOpacity={0.8}
              >
                <Text style={styles.evidenceSkipBtnText}>{t('invoice.skip', 'Skip')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Printer connection note */}
      <View style={styles.printerNote}>
        <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
        <View style={styles.printerNoteTextWrap}>
          <Text style={styles.printerNoteTitle}>{t('invoice.connectToPrinter', 'Connect to printer')}</Text>
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

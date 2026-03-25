/**
 * Thermal Receipt Image Generator for Rongta Printers
 * Creates a simple PNG image suitable for thermal printing
 * Optimized for 58mm thermal paper (RPP04)
 */

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

// 58mm paper at 203 DPI ≈ 464 pixels, use 384 for compatibility
const THERMAL_WIDTH_PX = 384;
const LINE_HEIGHT_PX = 24;

/**
 * Creates a simple monochrome receipt image from text
 * This is a workaround until proper HTML-to-image conversion is available
 * 
 * @param {Object} receiptData - Receipt data
 * @returns {Promise<string>} Base64 encoded PNG image
 */
export async function createThermalReceiptImage(receiptData) {
  const {
    companyName = 'GasTech',
    invoiceNumber,
    date,
    customer,
    customerTIN,
    supplierTIN,
    lineItems = [],
    grossAmount,
    vatAmount,
    netAmount,
    paymentInfo,
    signatureBase64,
  } = receiptData;

  // Create simple SVG receipt
  const svg = `
    <svg width="${THERMAL_WIDTH_PX}" height="auto" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .header { font: bold 32px monospace; text-anchor: middle; }
          .title { font: bold 20px monospace; text-anchor: middle; }
          .label { font: bold 14px monospace; }
          .value { font: 14px monospace; }
          .line { stroke: black; stroke-width: 2; }
        </style>
      </defs>
      
      <!-- Company Header -->
      <text x="192" y="40" class="header">${escapeXml(companyName)}</text>
      <text x="192" y="70" class="title">TAX INVOICE</text>
      <line x1="10" y1="80" x2="374" y2="80" class="line"/>
      
      <!-- Invoice Details -->
      <text x="10" y="110" class="label">Invoice: ${escapeXml(invoiceNumber || 'N/A')}</text>
      <text x="10" y="135" class="label">Date: ${escapeXml(date || 'N/A')}</text>
      <text x="10" y="160" class="label">Customer: ${escapeXml(customer || 'N/A')}</text>
      ${customerTIN ? `<text x="10" y="185" class="label">Customer TIN: ${escapeXml(customerTIN)}</text>` : ''}
      ${supplierTIN ? `<text x="10" y="${customerTIN ? 210 : 185}" class="label">Supplier TIN: ${escapeXml(supplierTIN)}</text>` : ''}
      
      <line x1="10" y1="${customerTIN || supplierTIN ? 220 : 195}" x2="374" y2="${customerTIN || supplierTIN ? 220 : 195}" class="line"/>
      
      <!-- Line Items Header -->
      <text x="10" y="${customerTIN || supplierTIN ? 250 : 225}" class="label">Item</text>
      <text x="250" y="${customerTIN || supplierTIN ? 250 : 225}" class="label">Qty</text>
      <text x="310" y="${customerTIN || supplierTIN ? 250 : 225}" class="label">Amount</text>
      <line x1="10" y1="${customerTIN || supplierTIN ? 260 : 235}" x2="374" y2="${customerTIN || supplierTIN ? 260 : 235}" class="line"/>
      
      <!-- Line Items (limited to first 5 for simplicity) -->
      ${lineItems.slice(0, 5).map((item, index) => {
        const y = (customerTIN || supplierTIN ? 290 : 265) + (index * 25);
        return `
          <text x="10" y="${y}" class="value">${escapeXml(truncate(item.name, 20))}</text>
          <text x="250" y="${y}" class="value">${item.qty}</text>
          <text x="310" y="${y}" class="value">${item.total}</text>
        `;
      }).join('')}
      
      <!-- Totals -->
      <line x1="10" y1="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 10}" 
            x2="374" y2="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 10}" class="line"/>
      
      <text x="10" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 40}" class="label">Gross Amount:</text>
      <text x="310" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 40}" class="value">${grossAmount}</text>
      
      <text x="10" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 65}" class="label">VAT (18%):</text>
      <text x="310" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 65}" class="value">${vatAmount}</text>
      
      <text x="10" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 95}" class="label" style="font-size: 18px;">NET AMOUNT:</text>
      <text x="310" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 95}" class="label" style="font-size: 18px;">${netAmount}</text>
      
      <line x1="10" y1="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 105}" 
            x2="374" y2="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 105}" class="line"/>
      
      <!-- Payment Info -->
      <text x="192" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 135}" class="label" style="text-anchor: middle;">${escapeXml(paymentInfo || 'Payment')}</text>
      
      <!-- Footer -->
      <text x="192" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 170}" class="value" style="text-anchor: middle; font-size: 12px;">Thank you for your business</text>
      <text x="192" y="${(customerTIN || supplierTIN ? 290 : 265) + (Math.min(lineItems.length, 5) * 25) + 190}" class="value" style="text-anchor: middle; font-size: 10px; font-style: italic;">Powered by everestx.com</text>
    </svg>
  `;

  // Save SVG to file
  const svgPath = `${FileSystem.cacheDirectory}receipt_${Date.now()}.svg`;
  await FileSystem.writeAsStringAsync(svgPath, svg);

  // Convert SVG to PNG using ImageManipulator
  const result = await ImageManipulator.manipulateAsync(
    svgPath,
    [{ resize: { width: THERMAL_WIDTH_PX } }],
    { 
      compress: 0,  // No compression for thermal printers
      format: ImageManipulator.SaveFormat.PNG,
      base64: true,
    }
  );

  // Clean up SVG file
  await FileSystem.deleteAsync(svgPath, { idempotent: true });

  return result.base64;
}

function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

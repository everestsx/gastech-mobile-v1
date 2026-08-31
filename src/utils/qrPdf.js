import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { customerQrValue } from './customerQr';
import { qrSvgMarkup } from './qrMatrix';

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildQrPdfHtml(customers, { displayName, logoDataUri } = {}) {
  const cards = (Array.isArray(customers) ? customers : [])
    .map((c) => {
      const value = customerQrValue(c);
      if (!value) return '';
      const name = htmlEscape(displayName ? displayName(c) : c?.name || 'Customer');
      return `<article class="card">
        <header class="head">
          ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="GasTech" />` : ''}
          <div class="brand">GasTech</div>
        </header>
        <div class="qr">${qrSvgMarkup(value, 220)}</div>
        <h2 class="name">${name}</h2>
      </article>`;
    })
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    font-family: -apple-system, Segoe UI, sans-serif;
    background: #f3f4f6;
    color: #111827;
  }
  h1 { font-size: 18px; margin: 0 0 14px; color: #312e81; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .card {
    width: 320px;
    background: #fff;
    border-radius: 22px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    page-break-inside: avoid;
  }
  .head {
    background: #312e81;
    padding: 18px 16px 14px;
    text-align: center;
  }
  .logo { width: 56px; height: 56px; object-fit: contain; background: #fff; border-radius: 16px; padding: 6px; }
  .brand { color: #fff; font-size: 20px; font-weight: 800; margin-top: 8px; letter-spacing: 0.4px; }
  .qr { padding: 18px 18px 8px; text-align: center; }
  .name {
    margin: 0;
    padding: 8px 16px 22px;
    text-align: center;
    font-size: 17px;
    font-weight: 800;
    color: #312e81;
  }
</style>
</head>
<body>
  <h1>GasTech customer QR</h1>
  <div class="grid">${cards}</div>
</body>
</html>`;
}

export async function shareQrPdf(customers, fileName, options = {}) {
  const html = buildQrPdfHtml(customers, options);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: fileName,
    UTI: 'com.adobe.pdf',
  });
  return { uri, fileName };
}

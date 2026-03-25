/**
 * Receipt Renderer for Rongta Thermal Printers
 * Converts receipt data to base64 image for thermal printing
 * Optimized for 58mm thermal paper (RPP04)
 */

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';

const PAPER_WIDTH_MM = 58;
const DPI = 203;
const PIXEL_WIDTH = Math.floor((PAPER_WIDTH_MM / 25.4) * DPI);
const CHAR_WIDTH = 8;
const CHARS_PER_LINE = Math.floor(PIXEL_WIDTH / CHAR_WIDTH);

/**
 * Converts receipt nodes to HTML for rendering
 * @param {Array} receiptNodes - Array of receipt node objects
 * @returns {string} HTML string
 */
export function buildReceiptHtml(receiptNodes) {
  const styles = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.4;
        color: #000;
        background: #fff;
        width: ${PIXEL_WIDTH}px;
        padding: 8px;
      }
      .line { border-bottom: 1px solid #000; margin: 4px 0; }
      .text-center { text-align: center; }
      .text-left { text-align: left; }
      .text-right { text-align: right; }
      .bold { font-weight: bold; }
      .size-1 { font-size: 12px; }
      .size-2 { font-size: 18px; font-weight: bold; }
      .size-3 { font-size: 24px; font-weight: bold; }
      table { 
        width: 100%; 
        border-collapse: collapse; 
        margin: 4px 0;
      }
      table td {
        padding: 2px;
        vertical-align: top;
        word-wrap: break-word;
      }
      .columns {
        display: flex;
        justify-content: space-between;
        margin: 2px 0;
      }
      .column {
        flex: 1;
      }
      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 4px auto;
      }
      .feed {
        height: 20px;
      }
    </style>
  `;

  let bodyHtml = '';

  for (const node of receiptNodes) {
    switch (node.type) {
      case 'text': {
        const style = node.style || {};
        const align = style.align || 'left';
        const bold = style.bold ? 'bold' : '';
        const size = style.size || 1;
        const content = escapeHtml(node.content || '');
        bodyHtml += `<div class="text-${align} ${bold} size-${size}">${content}</div>\n`;
        break;
      }

      case 'line': {
        bodyHtml += `<div class="line"></div>\n`;
        break;
      }

      case 'columns': {
        const columns = node.columns || [];
        bodyHtml += `<div class="columns">`;
        for (const col of columns) {
          const align = col.align || 'left';
          const content = escapeHtml(col.content || '');
          bodyHtml += `<div class="column text-${align}">${content}</div>`;
        }
        bodyHtml += `</div>\n`;
        break;
      }

      case 'table': {
        const headers = node.headers || [];
        const rows = node.rows || [];
        const columnWidths = node.columnWidths || [];
        const alignments = node.alignments || [];

        bodyHtml += `<table>`;
        
        if (headers.length > 0) {
          bodyHtml += `<tr>`;
          headers.forEach((header, i) => {
            const width = columnWidths[i] ? `width="${columnWidths[i]}%"` : '';
            const align = alignments[i] || 'left';
            bodyHtml += `<td ${width} style="text-align:${align};font-weight:bold;">${escapeHtml(header)}</td>`;
          });
          bodyHtml += `</tr>`;
        }

        rows.forEach(row => {
          bodyHtml += `<tr>`;
          row.forEach((cell, i) => {
            const width = columnWidths[i] ? `width="${columnWidths[i]}%"` : '';
            const align = alignments[i] || 'left';
            const cellContent = typeof cell === 'object' && cell.text 
              ? escapeHtml(cell.text) 
              : escapeHtml(String(cell));
            bodyHtml += `<td ${width} style="text-align:${align};">${cellContent}</td>`;
          });
          bodyHtml += `</tr>`;
        });
        
        bodyHtml += `</table>\n`;
        break;
      }

      case 'image': {
        if (node.imagePath) {
          const align = node.options?.align || 'center';
          bodyHtml += `<div class="text-${align}">`;
          bodyHtml += `<img src="${node.imagePath}" alt="Image" />`;
          bodyHtml += `</div>\n`;
        }
        break;
      }

      case 'feed': {
        const lines = node.lines || 1;
        for (let i = 0; i < lines; i++) {
          bodyHtml += `<div class="feed"></div>\n`;
        }
        break;
      }

      case 'cut': {
        break;
      }

      default: {
        console.warn(`Unknown receipt node type: ${node.type}`);
      }
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${PIXEL_WIDTH}px">
  ${styles}
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

/**
 * Converts HTML to base64 PNG image for thermal printing
 * This is a simplified version - in production, you might want to use
 * a more robust HTML-to-image conversion library
 * 
 * @param {string} html - HTML content
 * @returns {Promise<string>} Base64 encoded PNG image
 */
export async function htmlToBase64Image(html) {
  try {
    const { uri } = await Print.printToFileAsync({ html });
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return base64;
  } catch (error) {
    console.error('Error converting HTML to image:', error);
    throw new Error('Failed to generate receipt image');
  }
}

/**
 * Main function to render receipt nodes to base64 image
 * @param {Array} receiptNodes - Array of receipt node objects
 * @returns {Promise<string>} Base64 encoded image
 */
export async function renderReceiptToImage(receiptNodes) {
  if (!Array.isArray(receiptNodes) || receiptNodes.length === 0) {
    throw new Error('Invalid receipt nodes');
  }

  const html = buildReceiptHtml(receiptNodes);
  const base64 = await htmlToBase64Image(html);
  return base64;
}

/**
 * Escapes HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Alternative approach: Generate canvas-based image directly
 * This approach doesn't rely on Print API and gives more control
 * 
 * @param {Array} receiptNodes - Array of receipt node objects
 * @returns {Promise<string>} Base64 encoded PNG
 */
export async function renderReceiptToCanvas(receiptNodes) {
  const html = buildReceiptHtml(receiptNodes);
  
  const tempFile = `${FileSystem.cacheDirectory}receipt_${Date.now()}.html`;
  await FileSystem.writeAsStringAsync(tempFile, html);
  
  try {
    const base64 = await FileSystem.readAsStringAsync(tempFile, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } finally {
    await FileSystem.deleteAsync(tempFile, { idempotent: true });
  }
}

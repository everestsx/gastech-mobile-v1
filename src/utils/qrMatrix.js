import QRCode from 'qrcode';

export function wrapQrLabel(text, maxChars = 22, maxLines = 3) {
  const s = String(text || '').trim() || 'Customer';
  if (s.length <= maxChars) return [s];
  const lines = [];
  let rest = s;
  while (rest.length && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < Math.floor(maxChars / 2)) cut = maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (lines.length === maxLines && rest) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines;
}

export function qrMatrixFromValue(value) {
  const arr = Array.prototype.slice.call(
    QRCode.create(value, { errorCorrectionLevel: 'M' }).modules.data,
    0
  );
  const sqrt = Math.sqrt(arr.length);
  return arr.reduce(
    (rows, key, index) =>
      (index % sqrt === 0 ? rows.push([key]) : rows[rows.length - 1].push(key)) && rows,
    []
  );
}

export function qrPathFromMatrix(matrix, size) {
  const cellSize = size / matrix.length;
  let path = '';
  matrix.forEach((row, i) => {
    let needDraw = false;
    row.forEach((column, j) => {
      if (column) {
        if (!needDraw) {
          path += `M${cellSize * j} ${cellSize / 2 + cellSize * i} `;
          needDraw = true;
        }
        if (needDraw && j === matrix.length - 1) {
          path += `L${cellSize * (j + 1)} ${cellSize / 2 + cellSize * i} `;
        }
      } else if (needDraw) {
        path += `L${cellSize * j} ${cellSize / 2 + cellSize * i} `;
        needDraw = false;
      }
    });
  });
  return { cellSize, path };
}

export function qrSvgMarkup(value, size = 240) {
  const { path, cellSize } = qrPathFromMatrix(qrMatrixFromValue(value), size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#ffffff"/>
    <path d="${path}" stroke="#111827" stroke-width="${cellSize}" fill="none"/>
  </svg>`;
}

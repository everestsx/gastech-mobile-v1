import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { INVOICE_LOGO_PNG_BASE64 } from '../constants/invoiceLogoBase64';

let cachedLogoUri = null;

export function gasTechLogoRawDataUri() {
  return `data:image/png;base64,${INVOICE_LOGO_PNG_BASE64}`;
}

export async function getGasTechLogoDataUri() {
  if (cachedLogoUri) return cachedLogoUri;
  const src = gasTechLogoRawDataUri();
  try {
    const img = await manipulateAsync(src, [{ resize: { width: 220 } }], {
      format: SaveFormat.PNG,
      compress: 0.92,
      base64: true,
    });
    if (img?.base64) {
      cachedLogoUri = `data:image/png;base64,${img.base64}`;
      return cachedLogoUri;
    }
  } catch (e) {
    console.warn('[qr] logo resize', e?.message || e);
  }
  cachedLogoUri = src;
  return cachedLogoUri;
}

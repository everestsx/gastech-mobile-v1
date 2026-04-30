import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';

const STORAGE_KEY_LAST_BT_PRINTER = '@gastech/last_bluetooth_printer';

/** Requested default for wider Rongta paper mode (104mm). */
export const DEFAULT_THERMAL_WIDTH_DOTS = 832;
export const PAPER_WIDTH_DOTS = {
  MM58: 384,
  MM80: 576,
  MM104: 832,
};

function inferPaperWidthDots(printer) {
  const name = String(printer?.name || '').toLowerCase();
  if (name.includes('rpp04') || name.includes('58')) return PAPER_WIDTH_DOTS.MM58;
  if (name.includes('58')) return PAPER_WIDTH_DOTS.MM58;
  if (name.includes('104') || name.includes('rp425') || name.includes('rp4')) return PAPER_WIDTH_DOTS.MM104;
  if (name.includes('80')) return PAPER_WIDTH_DOTS.MM80;
  return DEFAULT_THERMAL_WIDTH_DOTS;
}

export function isRongtaNativeAvailable() {
  return Platform.OS === 'android' && !!NativeModules.RongtaNativeModule;
}

export async function getStoredBluetoothPrinter() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_LAST_BT_PRINTER);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.address === 'string' && parsed.address.trim()) {
      return {
        name: parsed.name || 'Printer',
        address: parsed.address.trim(),
        mac: parsed.mac || parsed.address.trim(),
        limitWidthDots:
          typeof parsed.limitWidthDots === 'number'
            ? parsed.limitWidthDots
            : DEFAULT_THERMAL_WIDTH_DOTS,
      };
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

export async function setStoredBluetoothPrinter(printer) {
  if (!printer?.address) {
    await AsyncStorage.removeItem(STORAGE_KEY_LAST_BT_PRINTER);
    return;
  }
  await AsyncStorage.setItem(
    STORAGE_KEY_LAST_BT_PRINTER,
    JSON.stringify({
      name: printer.name || 'Printer',
      address: printer.address,
      mac: printer.mac || printer.address,
      limitWidthDots: printer.limitWidthDots ?? DEFAULT_THERMAL_WIDTH_DOTS,
    })
  );
}

export async function requestBluetoothPermissions() {
  if (Platform.OS !== 'android') return true;

  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const need = [];

  if (api >= 31) {
    need.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    );
  } else {
    need.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADMIN
    );
  }

  if (api < 31) {
    need.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }

  const uniq = [...new Set(need)];
  const result = await PermissionsAndroid.requestMultiple(uniq);
  const denied = Object.entries(result).filter(([, v]) => v !== PermissionsAndroid.RESULTS.GRANTED);
  return denied.length === 0;
}

/**
 * Paired (bonded) Bluetooth printers from the native Rongta module.
 * @returns {Promise<Array<{ name: string, address: string, mac: string, connectionType: string }>>}
 */
export async function findBluetoothPrinters() {
  if (!isRongtaNativeAvailable()) {
    return [];
  }
  const ok = await requestBluetoothPermissions();
  if (!ok) {
    throw new Error('Bluetooth permissions are required to list paired printers.');
  }
  const mod = NativeModules.RongtaNativeModule;
  const raw = await mod.findPrinters('Bluetooth');
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((p) => ({
    name: p.name || 'Unknown',
    address: p.address || p.mac || '',
    mac: p.mac || p.address || '',
    connectionType: p.connectionType || 'Bluetooth',
  })).filter((p) => p.address);
}

function printerPayload(printer) {
  const inferred = inferPaperWidthDots(printer);
  return {
    address: printer.address,
    mac: printer.mac || printer.address,
    limitWidthDots: printer.limitWidthDots ?? inferred,
    textAlign: printer.textAlign || 'center',
  };
}

export async function printTextToRongta(text, printer) {
  if (!isRongtaNativeAvailable()) {
    throw new Error('Rongta native module is not available.');
  }
  const ok = await requestBluetoothPermissions();
  if (!ok) {
    throw new Error('Bluetooth permissions are required to print.');
  }
  await NativeModules.RongtaNativeModule.printText(text, printerPayload(printer));
}

/**
 * @param {string} fileUri — file:// URI from expo-print printToFileAsync
 * @param {{ headerLogoBase64?: string }} [options] — raw PNG base64 (no data: prefix). Prepended via ESC bitmap before PDF raster (PDF WebView often drops huge data-URI images).
 */
export async function printPdfFileToRongta(fileUri, printer, options = {}) {
  if (!isRongtaNativeAvailable()) {
    throw new Error('Rongta native module is not available.');
  }
  const ok = await requestBluetoothPermissions();
  if (!ok) {
    throw new Error('Bluetooth permissions are required to print.');
  }
  const uri = fileUri.startsWith('file:') ? fileUri : `file://${fileUri}`;
  const payload = printerPayload(printer);
  if (options.headerLogoBase64 && String(options.headerLogoBase64).trim()) {
    payload.headerLogoBase64 = String(options.headerLogoBase64).trim();
  }
  await NativeModules.RongtaNativeModule.printImage(uri, payload);
}

/**
 * Opens a fresh Bluetooth SPP session to the paired printer. Call once after the user picks a
 * device and before printing.
 */
export async function connectToRongtaPrinter(printer) {
  if (!isRongtaNativeAvailable()) {
    throw new Error('Rongta native module is not available.');
  }
  const ok = await requestBluetoothPermissions();
  if (!ok) {
    throw new Error('Bluetooth permissions are required to connect.');
  }
  if (!printer?.address) {
    throw new Error('Select a paired printer first.');
  }
  await NativeModules.RongtaNativeModule.connectToPrinter(printerPayload(printer));
}

export async function disconnectRongtaPrinter() {
  if (!isRongtaNativeAvailable()) return;
  try {
    await NativeModules.RongtaNativeModule.disconnect();
  } catch (_) {
    /* ignore */
  }
}

/** System print / share sheet (HTML). */
export async function printHtmlWithExpoPrint(html) {
  await Print.printAsync({ html });
}

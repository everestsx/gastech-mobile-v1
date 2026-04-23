import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserSession } from '../services/sync.service';

const SEQ_PREFIX = 'invoice_seq_v2_';
const ORDER_PREFIX = 'invoice_no_';
const LORRY_MAP_PREFIX = 'invoice_lorry_map_';
const LORRY_LAST_INDEX_KEY = 'invoice_lorry_last_index';

function padN(v, n) {
  return String(v).padStart(n, '0');
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function financialYearLabel(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1; // Apr-Mar financial year
  const endYear = startYear + 1;
  return `${padN(startYear % 100, 2)}-${padN(endYear % 100, 2)}`;
}

async function resolveSessionVehicle() {
  try {
    const s = await getUserSession();
    return {
      vehicleId: safeNumber(s?.vehicleId),
      vehicleName: String(s?.vehicleName || '').trim(),
      licensePlate: String(s?.licensePlate || '').trim(),
    };
  } catch (_) {
    return { vehicleId: null, vehicleName: '', licensePlate: '' };
  }
}

function extractExplicitLorryNo(vehicleName, licensePlate) {
  const candidates = [String(vehicleName || ''), String(licensePlate || '')];
  for (const raw of candidates) {
    const m = raw.match(/\bL\s*[-/]?\s*(\d+)\b/i);
    if (m?.[1]) return `L${Number(m[1])}`;
  }
  return null;
}

async function getOrAssignLorryNumber({ vehicleId, vehicleName, licensePlate }) {
  const explicit = extractExplicitLorryNo(vehicleName, licensePlate);
  if (explicit) return explicit;
  const key = `${LORRY_MAP_PREFIX}${vehicleId != null ? vehicleId : String(licensePlate || vehicleName || 'default')}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const lastRaw = await AsyncStorage.getItem(LORRY_LAST_INDEX_KEY);
  const nextIndex = (parseInt(lastRaw || '0', 10) || 0) + 1;
  const assigned = `L${nextIndex}`;
  await AsyncStorage.multiSet([
    [LORRY_LAST_INDEX_KEY, String(nextIndex)],
    [key, assigned],
  ]);
  return assigned;
}

async function getNextInvoiceNumberV2(options = {}) {
  const sessionVehicle = await resolveSessionVehicle();
  const vehicle = {
    vehicleId: options.vehicleId != null ? safeNumber(options.vehicleId) : sessionVehicle.vehicleId,
    vehicleName: options.vehicleName != null ? String(options.vehicleName) : sessionVehicle.vehicleName,
    licensePlate: options.licensePlate != null ? String(options.licensePlate) : sessionVehicle.licensePlate,
  };
  const lorryNo = await getOrAssignLorryNumber(vehicle);
  const fy = financialYearLabel(new Date());
  const seqKey = `${SEQ_PREFIX}${lorryNo}_${fy}`;
  const raw = await AsyncStorage.getItem(seqKey);
  const next = (parseInt(raw || '0', 10) || 0) + 1;
  await AsyncStorage.setItem(seqKey, String(next));
  return `${lorryNo}/${fy}/${padN(next, 5)}`;
}

export async function getOrAssignInvoiceNumber(saleOrderId, options = {}) {
  if (saleOrderId == null) return getNextInvoiceNumberV2(options);
  const key = ORDER_PREFIX + saleOrderId;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const next = await getNextInvoiceNumberV2(options);
  await AsyncStorage.setItem(key, next);
  return next;
}

/**
 * Get stored invoice number for a sale order (if any). Does not generate.
 * @param {number|string} saleOrderId
 * @returns {Promise<string|null>}
 */
export async function getStoredInvoiceNumber(saleOrderId) {
  if (saleOrderId == null) return null;
  return AsyncStorage.getItem(ORDER_PREFIX + saleOrderId);
}

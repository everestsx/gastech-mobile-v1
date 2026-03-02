/**
 * Invoice number in format ddmmyy0001 (sequential per day).
 * Persists last sequence per day and assigns one number per sale order (reused when reopening invoice).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEQ_PREFIX = 'invoice_seq_';
const ORDER_PREFIX = 'invoice_no_';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Get ddmmyy for today (e.g. 270226 for 27 Feb 2026). */
export function getTodayDdmmyy() {
  const d = new Date();
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = pad2(d.getFullYear() % 100);
  return `${day}${month}${year}`;
}

/**
 * Get next sequential number for today (increments and persists).
 * @returns {Promise<string>} e.g. "2702260001"
 */
export async function getNextInvoiceNumber() {
  const ddmmyy = getTodayDdmmyy();
  const key = SEQ_PREFIX + ddmmyy;
  const raw = await AsyncStorage.getItem(key);
  const next = (parseInt(raw ?? '0', 10) + 1);
  await AsyncStorage.setItem(key, String(next));
  const seq = String(next).padStart(4, '0');
  return ddmmyy + seq;
}

/**
 * Get or assign invoice number for a sale order.
 * Reuses stored number if already assigned; otherwise generates next and stores.
 * @param {number|string} saleOrderId
 * @returns {Promise<string>} Invoice number ddmmyy0001
 */
export async function getOrAssignInvoiceNumber(saleOrderId) {
  if (saleOrderId == null) return getNextInvoiceNumber();
  const key = ORDER_PREFIX + saleOrderId;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const next = await getNextInvoiceNumber();
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

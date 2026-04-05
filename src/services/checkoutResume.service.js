import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gastech_checkout_resume_v1';

async function readMap() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

async function writeMap(map) {
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}

/**
 * After payment is saved locally, before opening the invoice flow.
 * @param {number|string} saleOrderId
 * @param {object} invoiceParams — navigation params for InvoiceScreen (JSON-serializable)
 */
export async function setCheckoutResumeFromPayment(saleOrderId, invoiceParams) {
  const id = String(saleOrderId);
  const map = await readMap();
  const params = { ...(invoiceParams || {}) };
  if (params.saleOrderId == null) params.saleOrderId = id;
  map[id] = {
    updatedAt: Date.now(),
    phase: 'invoice',
    invoiceParams: params,
  };
  await writeMap(map);
}

export async function setCheckoutResumePhase(saleOrderId, phase) {
  const id = String(saleOrderId);
  const map = await readMap();
  const cur = map[id];
  if (!cur?.invoiceParams) return;
  const nextPhase = phase === 'payment_proof' ? 'payment_proof' : 'invoice';
  map[id] = { ...cur, phase: nextPhase, updatedAt: Date.now() };
  await writeMap(map);
}

export async function clearCheckoutResume(saleOrderId) {
  const map = await readMap();
  delete map[String(saleOrderId)];
  await writeMap(map);
}

export async function getCheckoutResumeEntry(saleOrderId) {
  const map = await readMap();
  return map[String(saleOrderId)] || null;
}

export async function getCheckoutResumeMap() {
  return readMap();
}

/**
 * Fleet vehicle odometer writes for Pre Check (start KM) and End Day (end KM).
 * Offline-first: persist to the sync queue, then POST JSON2 immediately.
 *
 * POST /json/2/fleet.vehicle/write
 * { ids: [<logged-in vehicle id>], vals: { odometer: <km>, driver_id: <work_contact_id partner> } }
 *
 * fleet.vehicle.driver_id is res.partner, not hr.employee. The logged-in driverId is
 * hr.employee.id; we send that employee's work_contact_id instead.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdooJson2 } from './index.service';
import * as syncQueueDb from '../database/syncQueue.js';
import { getEmployeeWorkContactId, parseWorkContactId } from './employee.service.js';

const START_ODOMETER_KEY = '@gastech_start_odometer';
const MAX_ODOMETER_KM = 99999999;

export function parseOdometerKm(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_ODOMETER_KM) {
    return raw;
  }
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_ODOMETER_KM) return null;
  return n;
}

function parseDriverId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function persistSessionWorkContactId(workContactId) {
  const id = parseDriverId(workContactId);
  if (id == null) return;
  try {
    const { getUserSession, saveUserSession } = await import('./sync.service.js');
    const session = await getUserSession();
    if (!session || parseDriverId(session.workContactId) === id) return;
    await saveUserSession({ ...session, workContactId: id });
  } catch (_) {}
}

/**
 * fleet.vehicle.driver_id is res.partner (hr.employee.work_contact_id).
 * Never send hr.employee.id on this field.
 */
async function resolveFleetDriverPartnerId({ driverId, workContactId } = {}) {
  const fromArg = parseWorkContactId(workContactId) ?? parseDriverId(workContactId);
  if (fromArg != null) return fromArg;

  let session = null;
  try {
    const { getUserSession } = await import('./sync.service.js');
    session = await getUserSession();
  } catch (_) {
    session = null;
  }

  const fromSession = parseWorkContactId(session?.workContactId) ?? parseDriverId(session?.workContactId);
  if (fromSession != null) return fromSession;

  const employeeId = parseDriverId(driverId) ?? parseDriverId(session?.driverId);
  if (employeeId == null) return null;

  try {
    const fetched = await getEmployeeWorkContactId(employeeId);
    if (fetched != null) {
      await persistSessionWorkContactId(fetched);
      return fetched;
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[vehicleOdometer] work_contact_id lookup failed', e?.message ?? e);
    }
  }
  return null;
}

/**
 * POST /json/2/fleet.vehicle/write
 * { "ids": [<vehicle id>], "vals": { "odometer": <km>, "driver_id": <work_contact_id> } }
 */
export async function writeVehicleOdometerJson2(vehicleId, odometer, driverId = null, workContactId = null) {
  const vid = Number(vehicleId);
  const km = Number(odometer);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (!Number.isFinite(km) || km < 0) {
    throw new Error('Invalid odometer value');
  }
  const partnerId = await resolveFleetDriverPartnerId({ driverId, workContactId });
  if (partnerId == null) {
    throw new Error('Missing driver work contact id for odometer write');
  }
  const payload = {
    ids: [vid],
    vals: {
      odometer: km,
      driver_id: partnerId,
    },
  };
  if (__DEV__) {
    console.log('[vehicleOdometer] POST /json/2/fleet.vehicle/write', JSON.stringify(payload));
  }
  return callOdooJson2('fleet.vehicle', 'write', payload);
}

function odometerDedupeKey(vehicleId, odometer, source) {
  return `${Number(vehicleId)}|${Number(odometer)}|${String(source || '')}`;
}

/** One in-flight JSON2 write per vehicle+km+source so queue drain cannot duplicate the submit write. */
const inFlightOdometerWrites = new Map();

async function markOdometerQueueRowsSynced(queueId, vehicleId, odometer, source) {
  const marked = new Set();
  const id = Number(queueId);
  if (Number.isFinite(id) && id > 0) {
    await syncQueueDb.markSynced(id);
    marked.add(id);
  }
  const key = odometerDedupeKey(vehicleId, odometer, source);
  const pending = (await syncQueueDb.getPending().catch(() => [])) || [];
  for (const row of pending) {
    if (row.action_type !== syncQueueDb.ACTION_VEHICLE_ODOMETER) continue;
    const rp = row.payload || {};
    if (odometerDedupeKey(rp.vehicleId ?? rp.vehicle_id, rp.odometer, rp.source) !== key) continue;
    const rowId = Number(row.id);
    if (!Number.isFinite(rowId) || rowId <= 0 || marked.has(rowId)) continue;
    await syncQueueDb.markSynced(rowId);
    marked.add(rowId);
  }
}

async function runOdometerWriteOnce(vehicleId, odometer, source, queueId, driverId = null, workContactId = null) {
  const key = odometerDedupeKey(vehicleId, odometer, source);
  const existing = inFlightOdometerWrites.get(key);
  if (existing) return existing;
  const run = (async () => {
    await writeVehicleOdometerJson2(vehicleId, odometer, driverId, workContactId);
    await markOdometerQueueRowsSynced(queueId, vehicleId, odometer, source);
    return { ok: true };
  })();
  inFlightOdometerWrites.set(key, run);
  try {
    return await run;
  } finally {
    inFlightOdometerWrites.delete(key);
  }
}

/**
 * Write this queue row to Odoo once. Always performs the JSON2 write when not already
 * in-flight — do not skip just because getPending() has not caught up yet.
 */
export async function flushVehicleOdometerQueueItem(item) {
  const id = Number(item?.id);
  const p = item?.payload || {};
  const vehicleId = Number(p.vehicleId ?? p.vehicle_id);
  const odometer = Number(p.odometer);
  const source = p.source || null;
  const driverId = parseDriverId(p.driverId ?? p.driver_id);
  const workContactId = parseDriverId(p.workContactId ?? p.work_contact_id);
  if (!Number.isFinite(vehicleId) || vehicleId <= 0 || !Number.isFinite(odometer) || odometer < 0) {
    if (Number.isFinite(id) && id > 0) await syncQueueDb.markSynced(id);
    return { ok: true, skipped: true };
  }
  return runOdometerWriteOnce(vehicleId, odometer, source, id, driverId, workContactId);
}

export async function saveStartOdometer({ vehicleId, km, loggedInAt }) {
  const payload = {
    vehicleId: Number(vehicleId),
    km: Number(km),
    loggedInAt: loggedInAt != null ? String(loggedInAt) : null,
    recordedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(START_ODOMETER_KEY, JSON.stringify(payload));
  return payload;
}

export async function getStartOdometer() {
  try {
    const raw = await AsyncStorage.getItem(START_ODOMETER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const km = parseOdometerKm(parsed?.km);
    const vehicleId = Number(parsed?.vehicleId);
    if (km == null || !Number.isFinite(vehicleId) || vehicleId <= 0) return null;
    return {
      vehicleId,
      km,
      loggedInAt: parsed?.loggedInAt != null ? String(parsed.loggedInAt) : null,
      recordedAt: parsed?.recordedAt || null,
    };
  } catch (_) {
    return null;
  }
}

export async function clearStartOdometer() {
  try {
    await AsyncStorage.removeItem(START_ODOMETER_KEY);
  } catch (_) {}
}

/**
 * Persist to the sync queue first so offline drivers never lose the reading,
 * then write JSON2 immediately (same API as Start Delivery / End Day).
 */
export async function submitVehicleOdometerWrite({ vehicleId, odometer, driverId, workContactId, source }) {
  const vid = Number(vehicleId);
  const km = parseOdometerKm(odometer);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (km == null) {
    throw new Error('Invalid odometer value');
  }
  let partnerId = parseWorkContactId(workContactId) ?? parseDriverId(workContactId);
  if (partnerId == null) {
    partnerId = await resolveFleetDriverPartnerId({ driverId, workContactId });
  }
  const employeeId = parseDriverId(driverId);
  if (partnerId == null && employeeId == null) {
    throw new Error('Missing driver work contact id for odometer write');
  }
  const payload = {
    vehicleId: vid,
    odometer: km,
    driverId: employeeId,
    workContactId: partnerId,
    source: source || null,
    recordedAt: new Date().toISOString(),
  };
  const queueId = await syncQueueDb.enqueue(syncQueueDb.ACTION_VEHICLE_ODOMETER, payload, {
    suppressWake: true,
  });
  try {
    await runOdometerWriteOnce(vid, km, payload.source, queueId, employeeId, partnerId);
    return { ok: true, queued: false, queueId };
  } catch (e) {
    console.warn('[vehicleOdometer] write queued for retry', e?.message ?? e);
    syncQueueDb.requestPendingUploadWake();
    return { ok: true, queued: true, queueId, error: e };
  }
}

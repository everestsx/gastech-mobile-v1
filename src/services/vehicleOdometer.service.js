/**
 * Fleet vehicle odometer writes for Pre Check (start KM) and End Day (end KM).
 * Offline-first: persist to the sync queue, then POST JSON2 immediately.
 *
 * POST /json/2/fleet.vehicle/write
 * { ids: [<logged-in vehicle id>], vals: { odometer: <km>, driver_id: <logged-in driver id> } }
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdooJson2 } from './index.service';
import * as syncQueueDb from '../database/syncQueue.js';

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

async function resolveLoggedInDriverId(driverId) {
  const fromArg = parseDriverId(driverId);
  if (fromArg != null) return fromArg;
  try {
    const { getUserSession } = await import('./sync.service.js');
    const session = await getUserSession();
    return parseDriverId(session?.driverId);
  } catch (_) {
    return null;
  }
}

/**
 * POST /json/2/fleet.vehicle/write
 * { "ids": [<vehicle id>], "vals": { "odometer": <km>, "driver_id": <driver id> } }
 */
export async function writeVehicleOdometerJson2(vehicleId, odometer, driverId = null) {
  const vid = Number(vehicleId);
  const km = Number(odometer);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (!Number.isFinite(km) || km < 0) {
    throw new Error('Invalid odometer value');
  }
  const did = await resolveLoggedInDriverId(driverId);
  if (did == null) {
    throw new Error('Missing logged-in driver id for odometer write');
  }
  const payload = {
    ids: [vid],
    vals: {
      odometer: km,
      driver_id: did,
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

async function runOdometerWriteOnce(vehicleId, odometer, source, queueId, driverId = null) {
  const key = odometerDedupeKey(vehicleId, odometer, source);
  const existing = inFlightOdometerWrites.get(key);
  if (existing) return existing;
  const run = (async () => {
    await writeVehicleOdometerJson2(vehicleId, odometer, driverId);
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
  if (!Number.isFinite(vehicleId) || vehicleId <= 0 || !Number.isFinite(odometer) || odometer < 0) {
    if (Number.isFinite(id) && id > 0) await syncQueueDb.markSynced(id);
    return { ok: true, skipped: true };
  }
  return runOdometerWriteOnce(vehicleId, odometer, source, id, driverId);
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
export async function submitVehicleOdometerWrite({ vehicleId, odometer, driverId, source }) {
  const vid = Number(vehicleId);
  const km = parseOdometerKm(odometer);
  const did = await resolveLoggedInDriverId(driverId);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (km == null) {
    throw new Error('Invalid odometer value');
  }
  if (did == null) {
    throw new Error('Missing logged-in driver id for odometer write');
  }
  const payload = {
    vehicleId: vid,
    odometer: km,
    driverId: did,
    source: source || null,
    recordedAt: new Date().toISOString(),
  };
  const queueId = await syncQueueDb.enqueue(syncQueueDb.ACTION_VEHICLE_ODOMETER, payload, {
    suppressWake: true,
  });
  try {
    await runOdometerWriteOnce(vid, km, payload.source, queueId, did);
    return { ok: true, queued: false, queueId };
  } catch (e) {
    console.warn('[vehicleOdometer] write queued for retry', e?.message ?? e);
    syncQueueDb.requestPendingUploadWake();
    return { ok: true, queued: true, queueId, error: e };
  }
}

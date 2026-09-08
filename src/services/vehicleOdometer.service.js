/**
 * Fleet vehicle odometer writes for Pre Check (start KM) and End Day (end KM).
 * Offline-first: always persist locally and enqueue, then try JSON2 immediately.
 *
 * POST /json/2/fleet.vehicle/write
 * { ids: [<logged-in vehicle id>], vals: { odometer: <km> } }
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdooJson2 } from './index.service';
import * as syncQueueDb from '../database/syncQueue.js';

const START_ODOMETER_KEY = '@gastech_start_odometer';
const MAX_ODOMETER_KM = 99999999;

export function parseOdometerKm(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_ODOMETER_KM) return null;
  return n;
}

export async function writeVehicleOdometerJson2(vehicleId, odometer) {
  const vid = Number(vehicleId);
  const km = Number(odometer);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (!Number.isFinite(km) || km < 0) {
    throw new Error('Invalid odometer value');
  }
  return callOdooJson2('fleet.vehicle', 'write', {
    ids: [vid],
    vals: { odometer: km },
  });
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
 * then try JSON2 immediately. Queue row stays until Odoo write succeeds.
 */
export async function submitVehicleOdometerWrite({ vehicleId, odometer, source }) {
  const vid = Number(vehicleId);
  const km = parseOdometerKm(odometer);
  if (!Number.isFinite(vid) || vid <= 0) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  if (km == null) {
    throw new Error('Invalid odometer value');
  }
  const queueId = await syncQueueDb.enqueue(syncQueueDb.ACTION_VEHICLE_ODOMETER, {
    vehicleId: vid,
    odometer: km,
    source: source || null,
    recordedAt: new Date().toISOString(),
  });
  try {
    await writeVehicleOdometerJson2(vid, km);
    await syncQueueDb.markSynced(queueId);
    return { ok: true, queued: false, queueId };
  } catch (e) {
    console.warn('[vehicleOdometer] write queued for retry', e?.message ?? e);
    return { ok: true, queued: true, queueId, error: e };
  }
}

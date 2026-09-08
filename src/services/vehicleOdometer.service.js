/**
 * Fleet vehicle odometer writes for Pre Check (start KM) and End Day (end KM).
 * Offline-first: persist to the sync queue, then POST JSON2 immediately.
 *
 * Always send driver and KM as two writes. Do not combine them: Odoo `odometer` is a
 * computed inverse field, so `{ driver_id, odometer }` can update the driver and skip the meter.
 * KM is created as fleet.vehicle.odometer (with fleet.vehicle write as fallback).
 *
 * fleet.vehicle.driver_id is res.partner (hr.employee.work_contact_id), not hr.employee.id.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callOdoo, callOdooArgs, callOdooJson2 } from './index.service';
import * as syncQueueDb from '../database/syncQueue.js';
import { getEmployeeWorkContactId, parseWorkContactId } from './employee.service.js';
import { resolveFleetVehicleId } from './vehicle.service.js';
import { formatLocalYyyyMmDd } from '../utils/localDate.js';

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

function json2Log(model, method, params) {
  if (__DEV__) {
    console.log(`[vehicleOdometer] POST /json/2/${model}/${method}`, JSON.stringify(params));
  }
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

async function persistSessionVehicleId(vehicleId) {
  const id = parseDriverId(vehicleId);
  if (id == null) return;
  try {
    const { getUserSession, saveUserSession } = await import('./sync.service.js');
    const session = await getUserSession();
    if (!session || parseDriverId(session.vehicleId) === id) return;
    await saveUserSession({ ...session, vehicleId: id });
  } catch (_) {}
}

async function readSessionVehicleHints() {
  try {
    const { getUserSession } = await import('./sync.service.js');
    const session = await getUserSession();
    return {
      vehicleId: parseDriverId(session?.vehicleId),
      licensePlate: String(session?.licensePlate || session?.license_plate || session?.vehicleName || '').trim() || null,
      driverId: parseDriverId(session?.driverId),
      workContactId: parseDriverId(session?.workContactId),
    };
  } catch (_) {
    return { vehicleId: null, licensePlate: null, driverId: null, workContactId: null };
  }
}

/**
 * Bind the live Odoo fleet.vehicle id (session/local ids can be stale).
 */
async function resolveOdometerVehicleId({ vehicleId, licensePlate } = {}) {
  const session = await readSessionVehicleHints();
  const hintedId = parseDriverId(vehicleId) ?? session.vehicleId;
  const plate = String(licensePlate || session.licensePlate || '').trim() || null;
  try {
    const resolved = await resolveFleetVehicleId({ vehicleId: hintedId, licensePlate: plate });
    if (resolved != null) {
      if (hintedId !== resolved) {
        await persistSessionVehicleId(resolved);
      }
      return resolved;
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[vehicleOdometer] vehicle id rebind failed', e?.message ?? e);
    }
  }
  return hintedId;
}

/**
 * fleet.vehicle.driver_id is res.partner (hr.employee.work_contact_id).
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

async function patchOdometerQueueProgress(queueId, payload) {
  const id = Number(queueId);
  if (!Number.isFinite(id) || id <= 0 || !payload || typeof payload !== 'object') return;
  try {
    await syncQueueDb.updateQueueItemPayload(id, payload, { suppressWake: true });
  } catch (_) {}
}

/** Replace the vehicle driver even when one is already assigned. Throws on failure. */
async function assignDriverMustSucceed(vid, partnerId) {
  const assignPayload = { ids: [vid], vals: { driver_id: partnerId } };
  json2Log('fleet.vehicle', 'write', assignPayload);
  try {
    await callOdooJson2('fleet.vehicle', 'write', assignPayload);
    return;
  } catch (firstErr) {
    const clearPayload = { ids: [vid], vals: { driver_id: false } };
    json2Log('fleet.vehicle', 'write', clearPayload);
    await callOdooJson2('fleet.vehicle', 'write', clearPayload);
    json2Log('fleet.vehicle', 'write', assignPayload);
    try {
      await callOdooJson2('fleet.vehicle', 'write', assignPayload);
    } catch (retryErr) {
      throw new Error(
        `Driver assign failed: ${retryErr?.message || retryErr || firstErr?.message || firstErr}`
      );
    }
  }
}

function odometerValuesMatch(a, b) {
  const n = Number(a);
  const m = Number(b);
  return Number.isFinite(n) && Number.isFinite(m) && Math.abs(n - m) < 0.5;
}

async function vehicleHasOdometerValue(vid, km) {
  try {
    const logs = await callOdoo(
      'fleet.vehicle.odometer',
      'search_read',
      [[['vehicle_id', '=', vid]]],
      { fields: ['id', 'value'], limit: 20, order: 'id desc' }
    );
    if (Array.isArray(logs) && logs.some((r) => odometerValuesMatch(r?.value, km))) {
      return { found: true, readable: true };
    }
    if (Array.isArray(logs)) return { found: false, readable: true };
  } catch (_) {}
  try {
    const logs = await callOdooJson2('fleet.vehicle.odometer', 'search_read', {
      domain: [['vehicle_id', '=', vid]],
      fields: ['id', 'value'],
      limit: 20,
      order: 'id desc',
    });
    if (Array.isArray(logs) && logs.some((r) => odometerValuesMatch(r?.value, km))) {
      return { found: true, readable: true };
    }
    if (Array.isArray(logs)) return { found: false, readable: true };
  } catch (_) {}
  try {
    const vehicles = await callOdoo(
      'fleet.vehicle',
      'search_read',
      [[['id', '=', vid]]],
      { fields: ['id', 'odometer'], limit: 1 }
    );
    const rec = Array.isArray(vehicles) ? vehicles[0] : null;
    if (rec && odometerValuesMatch(rec.odometer, km)) return { found: true, readable: true };
    if (rec) return { found: false, readable: true };
  } catch (_) {}
  return { found: false, readable: false };
}

/**
 * KM must land as a fleet.vehicle.odometer log. JSON2 create can return 200 without
 * creating a meter, which previously skipped the Postman write. Use execute_kw write
 * (triggers Odoo _set_odometer) and confirm the value on the vehicle.
 */
async function writeOdometerMustSucceed(vid, km) {
  const already = await vehicleHasOdometerValue(vid, km);
  if (already.found) return;

  const errors = [];
  const odooKm = Number(km);
  const today = formatLocalYyyyMmDd(new Date());

  try {
    json2Log('fleet.vehicle', 'execute_kw write odometer', { ids: [vid], odometer: odooKm });
    await callOdooArgs('fleet.vehicle', 'write', [[vid], { odometer: odooKm }]);
  } catch (e) {
    errors.push(`execute_kw write: ${e?.message || e}`);
  }
  if ((await vehicleHasOdometerValue(vid, odooKm)).found) return;

  try {
    json2Log('fleet.vehicle.odometer', 'execute_kw create', { vehicle_id: vid, value: odooKm, date: today });
    await callOdooArgs('fleet.vehicle.odometer', 'create', [
      [{ vehicle_id: vid, value: odooKm, date: today }],
    ]);
  } catch (e) {
    errors.push(`execute_kw create list: ${e?.message || e}`);
    try {
      await callOdooArgs('fleet.vehicle.odometer', 'create', [
        { vehicle_id: vid, value: odooKm, date: today },
      ]);
    } catch (e2) {
      errors.push(`execute_kw create dict: ${e2?.message || e2}`);
    }
  }
  if ((await vehicleHasOdometerValue(vid, odooKm)).found) return;

  try {
    const payload = { ids: [vid], vals: { odometer: odooKm } };
    json2Log('fleet.vehicle', 'write', payload);
    await callOdooJson2('fleet.vehicle', 'write', payload);
  } catch (e) {
    errors.push(`json2 write: ${e?.message || e}`);
  }
  if ((await vehicleHasOdometerValue(vid, odooKm)).found) return;

  try {
    const payload = { vals: { vehicle_id: vid, value: odooKm, date: today } };
    json2Log('fleet.vehicle.odometer', 'create', payload);
    await callOdooJson2('fleet.vehicle.odometer', 'create', payload);
  } catch (e) {
    errors.push(`json2 create: ${e?.message || e}`);
  }

  const check = await vehicleHasOdometerValue(vid, odooKm);
  if (check.found) return;
  if (!check.readable && errors.length === 0) return;
  throw new Error(
    `Odoo meter KM ${odooKm} was not saved on vehicle ${vid}${errors.length ? ` (${errors.join('; ')})` : ''}`
  );
}

/**
 * Driver first (already working), then KM as a separate write so the meter is always created.
 */
async function sendDriverAndOdometer({
  vid,
  km,
  partnerId,
  queueId,
  queuePayload,
  driverSynced: driverSyncedIn,
  odometerSynced: odometerSyncedIn,
}) {
  let driverSynced = driverSyncedIn === true;
  let odometerSynced = odometerSyncedIn === true;

  const persist = async () => {
    await patchOdometerQueueProgress(queueId, {
      ...queuePayload,
      vehicleId: vid,
      odometer: km,
      workContactId: partnerId ?? queuePayload?.workContactId ?? null,
      driverSynced,
      odometerSynced,
    });
  };

  if (!driverSynced && partnerId != null) {
    await assignDriverMustSucceed(vid, partnerId);
    driverSynced = true;
    await persist();
  }

  // Always send KM. Do not trust a prior odometerSynced flag — JSON2 create used to
  // return 200 without creating a fleet meter, which skipped this write.
  await writeOdometerMustSucceed(vid, km);
  odometerSynced = true;
  await persist();

  if (!odometerSynced) {
    throw new Error('Odometer was not written to Odoo');
  }
  if (partnerId != null && !driverSynced) {
    throw new Error('Driver was not assigned on the vehicle');
  }
  if (partnerId == null && !driverSynced) {
    throw new Error('Missing driver work contact id for vehicle driver assign');
  }
  return { driverSynced, odometerSynced, vehicleId: vid, workContactId: partnerId };
}

/**
 * POST driver + odometer to Odoo. Not complete until both succeeded.
 */
export async function writeVehicleOdometerJson2(
  vehicleId,
  odometer,
  driverId = null,
  workContactId = null,
  licensePlate = null,
  progress = {}
) {
  const km = Number(odometer);
  if (!Number.isFinite(km) || km < 0) {
    throw new Error('Invalid odometer value');
  }
  const vid = await resolveOdometerVehicleId({ vehicleId, licensePlate });
  if (vid == null) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  const partnerId = await resolveFleetDriverPartnerId({ driverId, workContactId });
  return sendDriverAndOdometer({
    vid,
    km,
    partnerId,
    queueId: progress.queueId,
    queuePayload: progress.queuePayload || {},
    driverSynced: progress.driverSynced,
    odometerSynced: progress.odometerSynced,
  });
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

async function runOdometerWriteOnce({
  vehicleId,
  odometer,
  source,
  queueId,
  driverId = null,
  workContactId = null,
  licensePlate = null,
  queuePayload = {},
  driverSynced = false,
  odometerSynced = false,
}) {
  const key = odometerDedupeKey(vehicleId, odometer, source);
  const existing = inFlightOdometerWrites.get(key);
  if (existing) return existing;
  const run = (async () => {
    const result = await writeVehicleOdometerJson2(
      vehicleId,
      odometer,
      driverId,
      workContactId,
      licensePlate,
      { queueId, queuePayload, driverSynced, odometerSynced }
    );
    if (result?.odometerSynced && result?.driverSynced) {
      await markOdometerQueueRowsSynced(queueId, vehicleId, odometer, source);
    } else {
      throw new Error('Vehicle meter and driver were not both saved to Odoo');
    }
    return { ok: true, ...result };
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
  const odometer = Number(p.odometer);
  const source = p.source || null;
  const driverId = parseDriverId(p.driverId ?? p.driver_id);
  const workContactId = parseDriverId(p.workContactId ?? p.work_contact_id);
  const licensePlate = String(p.licensePlate ?? p.license_plate ?? '').trim() || null;
  if (!Number.isFinite(odometer) || odometer < 0) {
    if (Number.isFinite(id) && id > 0) await syncQueueDb.markSynced(id);
    return { ok: true, skipped: true };
  }
  const vehicleId = await resolveOdometerVehicleId({
    vehicleId: p.vehicleId ?? p.vehicle_id,
    licensePlate,
  });
  if (vehicleId == null) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  return runOdometerWriteOnce({
    vehicleId,
    odometer,
    source,
    queueId: id,
    driverId,
    workContactId,
    licensePlate,
    queuePayload: p,
    driverSynced: p.driverSynced === true,
    odometerSynced: p.odometerSynced === true,
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
 * then write JSON2 immediately (same API as Start Delivery / End Day).
 */
export async function submitVehicleOdometerWrite({ vehicleId, odometer, driverId, workContactId, licensePlate, source }) {
  const km = parseOdometerKm(odometer);
  if (km == null) {
    throw new Error('Invalid odometer value');
  }
  const session = await readSessionVehicleHints();
  const plate = String(licensePlate || session.licensePlate || '').trim() || null;
  const vid = await resolveOdometerVehicleId({ vehicleId, licensePlate: plate });
  if (vid == null) {
    throw new Error('Missing logged-in vehicle id for odometer write');
  }
  let partnerId = parseWorkContactId(workContactId) ?? parseDriverId(workContactId);
  if (partnerId == null) {
    partnerId = await resolveFleetDriverPartnerId({ driverId, workContactId });
  }
  const employeeId = parseDriverId(driverId) ?? session.driverId;
  const payload = {
    vehicleId: vid,
    odometer: km,
    driverId: employeeId,
    workContactId: partnerId,
    licensePlate: plate,
    source: source || null,
    recordedAt: new Date().toISOString(),
    driverSynced: false,
    odometerSynced: false,
  };
  const queueId = await syncQueueDb.enqueue(syncQueueDb.ACTION_VEHICLE_ODOMETER, payload, {
    suppressWake: true,
  });
  try {
    await runOdometerWriteOnce({
      vehicleId: vid,
      odometer: km,
      source: payload.source,
      queueId,
      driverId: employeeId,
      workContactId: partnerId,
      licensePlate: plate,
      queuePayload: payload,
      driverSynced: false,
      odometerSynced: false,
    });
    return { ok: true, queued: false, queueId, vehicleId: vid };
  } catch (e) {
    console.warn('[vehicleOdometer] write queued for retry', e?.message ?? e);
    syncQueueDb.requestPendingUploadWake();
    return { ok: true, queued: true, queueId, vehicleId: vid, error: e };
  }
}

import { callOdooJson2, postOdooRoute } from './index.service';

/**
 * gastech.driver.login.history — driver login / route / logout sync.
 * Same JSON 2 / Bearer pattern as commission.service.js: host comes from ODOO_URL
 * (env/session), never hardcoded here.
 */
const DRIVER_LOGIN_HISTORY_MODEL = 'gastech.driver.login.history';
const DRIVER_LOGIN_HISTORY_ROUTE_PATH = '/gastech/driver_login_history/route';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Local yyyy-mm-dd — the business/shift day the driver is on (matches the "date" field). */
function localDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/**
 * UTC "yyyy-mm-dd HH:MM:SS" for Odoo Datetime fields. Odoo stores/expects Datetime values
 * as naive UTC — sending local wall-clock time here makes login_time/logout_time display
 * shifted by the device's UTC offset once Odoo converts it back to a viewer's timezone.
 */
function toOdooUtcDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
}

function isNetworkLikeError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('cannot reach server') ||
    error?.name === 'TypeError'
  );
}

function warn(tag, error) {
  if (__DEV__ && !isNetworkLikeError(error)) {
    console.warn(`[DriverLoginHistory] ${tag}:`, error?.message || error);
  }
}

/**
 * Record a driver login. Call right after a login session is saved.
 * @param {object} p
 * @param {string} p.batchId - driver code (e.g. "D5")
 * @param {number} p.driverId
 * @param {number} p.vehicleId
 * @param {Date|string} [p.loginAt] - defaults to now
 * @returns {Promise<object|null>} null on failure (never throws — must not block login)
 */
export const recordDriverLogin = async ({ batchId, driverId, vehicleId, loginAt }) => {
  if (!batchId || driverId == null || vehicleId == null) return null;
  const at = loginAt ? new Date(loginAt) : new Date();
  try {
    return await callOdooJson2(DRIVER_LOGIN_HISTORY_MODEL, 'record_login', {
      date: localDate(at),
      batch_id: batchId,
      driver_id: driverId,
      vehicle_id: vehicleId,
      login_time: toOdooUtcDateTime(at),
    });
  } catch (error) {
    warn('record_login failed', error);
    return null;
  }
};

/**
 * Record a driver logout. Call right before the local session is cleared.
 * @param {object} p
 * @param {string} p.batchId
 * @param {number} p.driverId
 * @param {number} p.vehicleId
 * @param {Date|string} [p.logoutAt] - defaults to now
 * @returns {Promise<object|null>}
 */
export const recordDriverLogout = async ({ batchId, driverId, vehicleId, logoutAt }) => {
  if (!batchId || driverId == null || vehicleId == null) return null;
  const at = logoutAt ? new Date(logoutAt) : new Date();
  try {
    return await callOdooJson2(DRIVER_LOGIN_HISTORY_MODEL, 'record_logout', {
      date: localDate(at),
      batch_id: batchId,
      driver_id: driverId,
      vehicle_id: vehicleId,
      logout_time: toOdooUtcDateTime(at),
    });
  } catch (error) {
    warn('record_logout failed', error);
    return null;
  }
};

/**
 * Update today's route once it is known from synced orders. Only call this when a real
 * route name was found on today's orders — there is nothing to send when the vehicle has
 * no orders for the day.
 * @param {object} p
 * @param {string} p.batchId
 * @param {number} p.driverId
 * @param {number} p.vehicleId
 * @param {string} p.routeName
 * @param {Date|string} [p.date] - defaults to today
 * @returns {Promise<object|null>}
 */
export const updateDriverLoginRoute = async ({ batchId, driverId, vehicleId, routeName, date }) => {
  if (!batchId || driverId == null || vehicleId == null || !routeName) return null;
  try {
    return await postOdooRoute(DRIVER_LOGIN_HISTORY_ROUTE_PATH, {
      date: localDate(date ? new Date(date) : new Date()),
      batch_id: batchId,
      driver_id: driverId,
      vehicle_id: vehicleId,
      route_name: routeName,
    });
  } catch (error) {
    warn('route update failed', error);
    return null;
  }
};

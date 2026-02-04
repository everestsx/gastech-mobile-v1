/**
 * Manual login config: 1 admin + 6 vehicle users.
 * Admin sees all data; each vehicle user sees only their vehicle's sale orders.
 * Change passwords as needed (admin sets these).
 */

export const ROLES = {
  ADMIN: 'admin',
  VEHICLE: 'vehicle',
};

/** Admin login (single common account) */
export const ADMIN_USER = {
  username: 'admin',
  password: 'admin123',
  role: ROLES.ADMIN,
};

/**
 * Six vehicle-based logins.
 * username / password = manual credentials for that vehicle.
 * vehicle_id = Odoo fleet.vehicle id (from get vehicles API).
 * vehicle_name = display name (e.g. license plate or name).
 */
export const VEHICLE_USERS = [
  { username: 'vehicle1', password: 'pass1', vehicle_id: 27, vehicle_name: 'LP-0374' },
  { username: 'vehicle2', password: 'pass2', vehicle_id: 26, vehicle_name: 'LN-0417' },
  { username: 'vehicle3', password: 'pass3', vehicle_id: 25, vehicle_name: 'LN-0425' },
  { username: 'vehicle4', password: 'pass4', vehicle_id: 24, vehicle_name: 'LN-0423' },
  { username: 'vehicle5', password: 'pass5', vehicle_id: 23, vehicle_name: 'LI-37370' },
  { username: 'vehicle6', password: 'pass6', vehicle_id: 22, vehicle_name: 'LN-7041' },
];

/**
 * Validate credentials and return session payload or null.
 */
export function validateLogin(username, password) {
  const u = (username || '').trim();
  const p = password || '';
  if (ADMIN_USER.username === u && ADMIN_USER.password === p) {
    return {
      username: ADMIN_USER.username,
      role: ROLES.ADMIN,
    };
  }
  const vehicle = VEHICLE_USERS.find(
    (v) => v.username === u && v.password === p
  );
  if (vehicle) {
    return {
      username: vehicle.username,
      role: ROLES.VEHICLE,
      vehicle_id: vehicle.vehicle_id,
      vehicle_name: vehicle.vehicle_name,
    };
  }
  return null;
}

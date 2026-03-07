import { callOdoo } from "./index.service";

/**
 * Get all fleet vehicles (fleet.vehicle search_read)
 */
export const getVehicles = () =>
  callOdoo(
    "fleet.vehicle",
    "search_read",
    [[]],
    {
      fields: ["id", "name", "license_plate", "model_id"],
      order: "name asc",
    }
  );

/**
 * Get a single vehicle by id (for vehicle-scoped sync; avoids fetching all vehicles).
 */
export const getVehicleById = (vehicleId) =>
  callOdoo(
    "fleet.vehicle",
    "search_read",
    [[["id", "=", vehicleId]]],
    {
      fields: ["id", "name", "license_plate", "model_id"],
      limit: 1,
    }
  ).then((rows) => (Array.isArray(rows) && rows.length > 0 ? rows[0] : null));

/** True if the error is due to network unreachability (no response from server). */
function isNetworkError(error) {
  const msg = (error?.message || String(error)).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    (error?.name === 'TypeError' && msg.includes('network'))
  );
}

/**
 * Validates credentials directly against the Odoo fleet.vehicle model.
 * Throws a user-friendly message for network vs auth failures.
 */
export const authenticateVehicleOnline = async (vehicleId, enteredPassword) => {
  try {
    const technicalName = 'vehicle_password';

    const count = await callOdoo("fleet.vehicle", "search_count", [
      [
        ["id", "=", vehicleId],
        [technicalName, "=", enteredPassword]
      ]
    ]);

    return count === 1;
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn("Odoo Auth: server unreachable — check device internet.");
      throw new Error(
        "Cannot reach server. Please check your internet connection (WiFi or mobile data) and try again."
      );
    }
    console.warn("Odoo Auth Error:", error?.message || error);
    throw new Error(
      error?.message?.includes("Odoo") ? error.message : "Invalid vehicle or password. Please try again."
    );
  }
};
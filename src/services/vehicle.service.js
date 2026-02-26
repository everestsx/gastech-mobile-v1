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

/**
 * Validates credentials directly against the Odoo fleet.vehicle model.
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
        console.error("Odoo Auth Error:", error);
        throw new Error("Login failed. Please check your internet connection.");
    }
};
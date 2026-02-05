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

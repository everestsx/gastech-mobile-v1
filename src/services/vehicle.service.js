import { callOdoo } from './index.service';

/**
 * Get all fleet vehicles (for display or mapping).
 */
export const getVehicles = () =>
  callOdoo('fleet.vehicle', 'search_read', [[]], {
    fields: ['id', 'name', 'license_plate', 'model_id'],
    order: 'name asc',
  });

/**
 * Get all routes (route.master).
 */
export const getRoutes = () =>
  callOdoo('route.master', 'search_read', [[]], {
    fields: ['id', 'name'],
    order: 'name asc',
  });

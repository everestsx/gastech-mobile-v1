import { callOdoo } from "./index.service";

/**
 * Get all routes (route.master search_read)
 */
export const getRoutes = () =>
  callOdoo(
    "route.master",
    "search_read",
    [[]],
    {
      fields: ["id", "name"],
      order: "name asc",
    }
  );

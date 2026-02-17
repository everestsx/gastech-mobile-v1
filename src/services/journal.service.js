import { callOdoo } from "./index.service";

/**
 * Get payment journals: type bank and cash from Odoo (account.journal).
 * App binds by name: "Cash" for cash method, "Cheque" for check (user selects Sri Lankan bank in UI).
 * Bank-type journals used for Credit. Sync stores these for offline payment screen.
 */
export const getJournals = () =>
  callOdoo(
    "account.journal",
    "search_read",
    [[["type", "in", ["bank", "cash"]]]],
    {
      fields: ["id", "name", "code", "type"],
      order: "type asc, name asc",
    }
  );

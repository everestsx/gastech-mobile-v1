import { callOdoo } from "./index.service";

/**
 * Get payment journals only: type bank and cash from Odoo (account.journal).
 * Use for payment method selection (Cash / Bank) on payment screen.
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

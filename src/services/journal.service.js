import { callOdoo } from "./index.service";
import { JOURNAL_CODE_CASH, JOURNAL_CODE_CHEQUE } from "../constants/journals";

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

/**
 * Get cash-type journals only (Cash + Cheque). Used by sync to resolve journalId when missing.
 * Returns { cashJournalId, chequeJournalId } so cheque is handled like cash (create → post → reconcile).
 */
export async function getCashTypeJournalIds() {
  const rows = await callOdoo(
    "account.journal",
    "search_read",
    [[["type", "=", "cash"]]],
    { fields: ["id", "name", "code"], order: "name asc" }
  );
  const list = Array.isArray(rows) ? rows : [];
  let cashJournalId = null;
  let chequeJournalId = null;
  for (const j of list) {
    const code = (j.code || "").toUpperCase().trim();
    const name = (j.name || "").toLowerCase();
    const chequeCode = (JOURNAL_CODE_CHEQUE || "").toUpperCase().trim();
    const cashCode = (JOURNAL_CODE_CASH || "").toUpperCase().trim();
    if (name.includes("cheque") || (chequeCode && code === chequeCode)) {
      if (chequeJournalId == null) chequeJournalId = j.id;
    } else if (name.includes("cash") || (cashCode && code === cashCode)) {
      if (cashJournalId == null) cashJournalId = j.id;
    }
  }
  return { cashJournalId, chequeJournalId };
}

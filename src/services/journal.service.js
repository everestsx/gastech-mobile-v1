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
 * Get cash-type journals only (Cash + Cheque). Used by sync to resolve journalId.
 * Uses same API as Postman: account.journal search_read domain [], fields ["id", "name", "code", "type"].
 * Returns { cashJournalId, chequeJournalId } (e.g. CSH1=13, CSH2=15).
 */
export async function getCashTypeJournalIds() {
  const rows = await callOdoo(
    "account.journal",
    "search_read",
    [[]],
    { fields: ["id", "name", "code", "type"] }
  );
  const list = Array.isArray(rows) ? rows : [];
  let cashJournalId = null;
  let chequeJournalId = null;
  const cashCode = (JOURNAL_CODE_CASH || "CSH1").toUpperCase().trim();
  const chequeCode = (JOURNAL_CODE_CHEQUE || "CSH2").toUpperCase().trim();
  for (const j of list) {
    const code = (j.code || "").toUpperCase().trim();
    const name = (j.name || "").toLowerCase();
    const id = j.id != null ? Number(j.id) : null;
    if (id == null) continue;
    if (code === chequeCode || name.includes("cheque")) {
      if (chequeJournalId == null) chequeJournalId = id;
    } else if (code === cashCode || name.includes("cash")) {
      if (cashJournalId == null) cashJournalId = id;
    }
  }
  return { cashJournalId, chequeJournalId };
}

/**
 * Get journal codes by ids (for classifying payments as cash vs cheque by code CSH1/CSH2).
 * Returns { [journalId]: code }.
 */
export async function getJournalCodesByIds(journalIds) {
  if (!Array.isArray(journalIds) || journalIds.length === 0) return {};
  const ids = [...new Set(journalIds)].filter((id) => id != null);
  if (ids.length === 0) return {};
  const rows = await callOdoo(
    "account.journal",
    "search_read",
    [[["id", "in", ids]]],
    { fields: ["id", "code"] }
  );
  const map = {};
  for (const r of rows || []) {
    if (r.id != null) map[r.id] = (r.code || "").trim().toUpperCase();
  }
  return map;
}

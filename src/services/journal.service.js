import { callOdoo } from "./index.service";

/**
 * Get all journals (account.journal search_read)
 */
export const getJournals = () =>
  callOdoo(
    "account.journal",
    "search_read",
    [[]],
    {
      fields: ["id", "name", "code", "type"],
    }
  );

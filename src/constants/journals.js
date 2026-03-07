/**
 * Odoo account.journal codes used for payment methods.
 * Cash → Cash journal; Cheque → Cheque journal (both type=cash in Odoo; post + reconcile same as cash).
 */
export const JOURNAL_CODE_CASH = 'CSH1';
/** Cheque journal code (e.g. CSH2, CSH5); also matched by name containing "cheque". */
export const JOURNAL_CODE_CHEQUE = 'CSH2';

import { callOdoo } from "./index.service";

export const createInvoice = (saleOrderId) =>
  callOdoo(
    "sale.order",
    "action_create_invoice",
    [[saleOrderId]]
  );

export const assignJournal = (invoiceId, journalId) =>
  callOdoo(
    "account.move",
    "write",
    [[invoiceId], { journal_id: journalId }]
  );

export const postInvoice = (invoiceId) =>
  callOdoo(
    "account.move",
    "action_post",
    [[invoiceId]]
  );

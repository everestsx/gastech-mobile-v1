import { callOdoo, callOdooArgs, callOdooArgsKwargs } from "./index.service";

/** Legacy: direct create invoice action (use wizard flow for full control) */
export const createInvoice = (saleOrderId) =>
  callOdooArgs("sale.order", "action_create_invoice", [[saleOrderId]]);

export const assignJournal = (invoiceId, journalId) =>
  callOdooArgs("account.move", "write", [[invoiceId], { journal_id: journalId }]);

/** Post (validate) an invoice. Uses action_post on account.move. */
export const postInvoice = (invoiceId) =>
  callOdooArgs("account.move", "action_post", [[invoiceId]]);

/* ---------------- Invoice creation wizard (after delivery validation) ---------------- */

/** Create advance payment wizard for delivered quantities. Returns wizard record id (integer). */
export const createAdvancePaymentWizard = (saleOrderId) =>
  callOdooArgs("sale.advance.payment.inv", "create", [
    {
      advance_payment_method: "delivered",
      sale_order_ids: [saleOrderId],
    },
  ]);

/** Create invoices from wizard. Call after createAdvancePaymentWizard. Pass wizard id and sale order id for context. */
export const createInvoicesFromWizard = (wizardId, saleOrderId) =>
  callOdooArgsKwargs(
    "sale.advance.payment.inv",
    "create_invoices",
    [[wizardId]],
    {
      context: {
        active_model: "sale.order",
        active_ids: [saleOrderId],
      },
    }
  );

/** Get sale order invoice ids. Call after createInvoicesFromWizard to get new invoice id, or to check existing. */
export const getSaleOrderInvoiceIds = async (saleOrderId) => {
  const rows = await callOdoo("sale.order", "read", [[saleOrderId]], {
    fields: ["invoice_ids"],
  });
  const record = Array.isArray(rows) ? rows[0] : rows;
  return record?.invoice_ids ?? [];
};

/** Get sale order invoice status and details (id, name, state, invoice_status, amount_total, invoice_ids). */
export const getSaleOrderInvoiceStatus = (saleOrderId) =>
  callOdoo("sale.order", "read", [[saleOrderId]], {
    fields: ["id", "name", "state", "invoice_status", "amount_total", "invoice_ids"],
  }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

/** Get sale order info for payment (partner_id, name, amount_total, invoice_status, invoice_ids). */
export const getSaleOrderForPayment = (saleOrderId) =>
  callOdoo("sale.order", "read", [[saleOrderId]], {
    fields: ["id", "name", "partner_id", "amount_total", "invoice_status", "invoice_ids"],
  }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

/** Read invoice state (draft/posted). */
export const getInvoiceState = (invoiceId) =>
  callOdoo("account.move", "read", [[invoiceId]], {
    fields: ["id", "name", "state"],
  }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

/** Create account.payment (inbound customer payment linked to invoice). invoice_ids: (4, id, 0) to link. */
export const createPayment = ({
  partnerId,
  amount,
  currencyId = 1,
  journalId,
  date,
  memo,
  invoiceId,
}) =>
  callOdooArgs("account.payment", "create", [
    {
      payment_type: "inbound",
      partner_type: "customer",
      partner_id: partnerId,
      amount: Number(amount),
      currency_id: currencyId,
      journal_id: journalId,
      date: date || new Date().toISOString().slice(0, 10),
      memo: memo || "",
      invoice_ids: invoiceId != null ? [[4, invoiceId, 0]] : [],
    },
  ]);

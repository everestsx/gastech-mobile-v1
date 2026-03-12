import { callOdoo, callOdooArgs, callOdooArgsKwargs } from "./index.service";

/** Legacy: direct create invoice action (use wizard flow for full control) */
export const createInvoice = (saleOrderId) =>
  callOdooArgs("sale.order", "action_create_invoice", [[saleOrderId]]);

export const assignJournal = (invoiceId, journalId) =>
  callOdooArgs("account.move", "write", [[invoiceId], { journal_id: journalId }]);

/** Step 3 — Post the invoice. Same as Postman: account.move action_post [[res_id]]. */
export const postInvoice = (invoiceId) =>
  callOdooArgs("account.move", "action_post", [[Number(invoiceId)]]);

/* ---------------- Invoice creation wizard (after delivery validation) ---------------- */

/** Step 1 — Create advance payment wizard (with context). Same as Postman: create with context active_model/active_ids. Returns wizard id (e.g. 679). */
export const createAdvancePaymentWizard = (saleOrderId) =>
  callOdooArgsKwargs(
    "sale.advance.payment.inv",
    "create",
    [[{ advance_payment_method: "delivered" }]],
    {
      context: {
        active_model: "sale.order",
        active_ids: [Number(saleOrderId)],
      },
    }
  );

/** Step 2 — Create invoice from wizard. Same as Postman: create_invoices [[wizardId]]. Returns action dict with res_id = invoice id (e.g. 92). */
export const createInvoicesFromWizard = (wizardId) =>
  callOdooArgs("sale.advance.payment.inv", "create_invoices", [[Number(wizardId)]]);

/** Get invoice id (res_id) from create_invoices result. Use this id for action_post and payment register. */
export const getInvoiceIdAfterCreate = (createInvoicesResult) => {
  const resId = createInvoicesResult?.res_id;
  if (resId != null) return Number(resId);
  return null;
};

/** Normalize Odoo invoice_ids entry to numeric id (handles [id, name] or id). */
export const firstInvoiceId = (invoiceIds) => {
  if (invoiceIds == null || !Array.isArray(invoiceIds) || invoiceIds.length === 0) return null;
  const first = invoiceIds[0];
  return Array.isArray(first) ? first[0] : first;
};

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

/** Create account.payment (inbound customer payment). Returns the created payment id. Payment is created in Draft. */
export const createPayment = ({
  partnerId,
  amount,
  currencyId = 1,
  journalId,
  date,
  memo,
  invoiceId,
  paymentMethodId = 1,
}) =>
  callOdooArgs("account.payment", "create", [
    {
      payment_type: "inbound",
      partner_type: "customer",
      partner_id: partnerId,
      amount: Number(amount),
      currency_id: currencyId,
      journal_id: journalId,
      payment_method_id: paymentMethodId,
      date: date || new Date().toISOString().slice(0, 10),
      memo: memo || "",
      invoice_ids: invoiceId != null ? [[4, invoiceId, 0]] : [],
    },
  ]);

/** Post (confirm) an account.payment so it moves from Draft to Posted. Call after createPayment with the returned id. */
export const postPayment = (paymentId) =>
  callOdooArgs("account.payment", "action_post", [[paymentId]]);

/* ---------------- Post payment and reconcile with invoice (payment_state = paid, amount_residual = 0) ---------------- */

const RECEIVABLE_DOMAIN = [
  ["account_type", "=", "asset_receivable"],
  ["reconciled", "=", false],
];
const LINE_FIELDS = { fields: ["id", "debit", "credit"] };

/** Get the receivable line id for an invoice (account.move). Invoice move_id = invoiceId. */
export const getInvoiceReceivableLine = async (invoiceMoveId) => {
  const rows = await callOdoo(
    "account.move.line",
    "search_read",
    [[["move_id", "=", invoiceMoveId], ...RECEIVABLE_DOMAIN]],
    LINE_FIELDS
  );
  const line = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return line?.id ?? null;
};

/** Get move_id of a posted payment (account.payment). Call after postPayment. */
export const getPaymentMoveId = async (paymentId) => {
  const rows = await callOdoo("account.payment", "read", [[paymentId]], {
    fields: ["move_id"],
  });
  const record = Array.isArray(rows) ? rows[0] : rows;
  const moveId = record?.move_id;
  return Array.isArray(moveId) ? moveId[0] : moveId ?? null;
};

/** Get the receivable line id for a payment move (account.move from the payment). */
export const getPaymentReceivableLine = async (paymentMoveId) => {
  const rows = await callOdoo(
    "account.move.line",
    "search_read",
    [[["move_id", "=", paymentMoveId], ...RECEIVABLE_DOMAIN]],
    LINE_FIELDS
  );
  const line = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return line?.id ?? null;
};

/** Reconcile two (or more) move lines so the invoice shows payment_state = paid and amount_residual = 0. */
export const reconcileMoveLines = (lineIds) =>
  callOdooArgs("account.move.line", "reconcile", [lineIds]);

/* ---------------- Payment register wizard (for sync: cash/cheque on posted invoice) ---------------- */

/** Step 5 — Create payment register wizard. Same as Postman: account.payment.register create [{ amount, journal_id, payment_date }], context active_ids [res_id]. Returns wizard id (e.g. 14). */
export const createPaymentRegisterWizard = (invoiceResId, { amount, journalId, paymentDate }) => {
  const dateStr = paymentDate && String(paymentDate).match(/^\d{4}-\d{2}-\d{2}/)
    ? String(paymentDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return callOdooArgsKwargs(
    "account.payment.register",
    "create",
    [
      [
        {
          amount: Number(amount),
          journal_id: Number(journalId),
          payment_date: dateStr,
        },
      ],
    ],
    {
      context: {
        active_model: "account.move",
        active_ids: [Number(invoiceResId)],
      },
    }
  );
};

/** Step 6 — Execute payment. Same as Postman: account.payment.register action_create_payments [[wizardId]]. */
export const executePaymentRegister = (wizardId) =>
  callOdooArgs("account.payment.register", "action_create_payments", [[Number(wizardId)]]);

/**
 * Post the payment and reconcile it with the invoice in one flow.
 * STEP 1: action_post on account.payment
 * STEP 2: Get invoice receivable line (move_id = invoiceId)
 * STEP 3: Get payment move_id, then get payment receivable line
 * STEP 4: account.move.line reconcile [invoiceLineId, paymentLineId]
 * Result: invoice payment_state = "paid", amount_residual = 0.0
 */
export const postPaymentAndReconcile = async (paymentId, invoiceId) => {
  await postPayment(paymentId);

  const invoiceLineId = await getInvoiceReceivableLine(invoiceId);
  if (invoiceLineId == null) {
    throw new Error(
      `Reconcile: no unreconciled receivable line found for invoice move_id=${invoiceId}`
    );
  }

  const paymentMoveId = await getPaymentMoveId(paymentId);
  if (paymentMoveId == null) {
    throw new Error(
      `Reconcile: payment id=${paymentId} has no move_id (post may have failed)`
    );
  }

  const paymentLineId = await getPaymentReceivableLine(paymentMoveId);
  if (paymentLineId == null) {
    throw new Error(
      `Reconcile: no unreconciled receivable line for payment move_id=${paymentMoveId}`
    );
  }

  await reconcileMoveLines([invoiceLineId, paymentLineId]);
};

/* ---------------- Invoices and payments by sale order (for sync + dashboard) ---------------- */

/** Get invoices by sale order origin (invoice_origin in orderNames). */
export const getInvoicesByOrigins = (orderNames) => {
  if (!Array.isArray(orderNames) || orderNames.length === 0) return Promise.resolve([]);
  return callOdoo(
    "account.move",
    "search_read",
    [[["invoice_origin", "in", orderNames]]],
    { fields: ["id", "name", "invoice_origin", "payment_state", "amount_total"], limit: 500 }
  );
};

/** Get payments linked to given invoice ids (reconciled). */
export const getPaymentsByInvoiceIds = (invoiceIds) => {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return Promise.resolve([]);
  return callOdoo(
    "account.payment",
    "search_read",
    [[["reconciled_invoice_ids", "in", invoiceIds]]],
    { fields: ["id", "amount", "journal_id", "reconciled_invoice_ids"], limit: 500 }
  );
};

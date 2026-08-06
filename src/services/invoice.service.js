import { callOdoo, callOdooArgs, callOdooArgsKwargs, callOdooJson2 } from "./index.service";

/** Legacy: direct create invoice action (use wizard flow for full control) */
export const createInvoice = (saleOrderId) =>
  callOdooArgs("sale.order", "action_create_invoice", [[saleOrderId]]);

export const assignJournal = (invoiceId, journalId) =>
  callOdooArgs("account.move", "write", [[invoiceId], { journal_id: journalId }]);

/** Step 3 — Post the invoice. Same as Postman: account.move action_post [[res_id]]. */
export const postInvoice = (invoiceId) =>
  callOdooArgs("account.move", "action_post", [[Number(invoiceId)]]);

/**
 * Driver's customer-SMS choice for this invoice.
 * Same as Postman: POST /json/2/account.move/write with { ids, vals: { send_invoice_sms } }.
 * The back office sends the SMS on confirmation, so this must land before action_post.
 *
 * Sends a real JSON boolean, never the string "false" — Python treats any non-empty string
 * as truthy, so a stringified "false" would switch the SMS on instead of off.
 */
export const setInvoiceSmsEnabled = (invoiceId, enabled) =>
  callOdooJson2("account.move", "write", {
    ids: [Number(invoiceId)],
    vals: { send_invoice_sms: enabled === true },
  });

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

/** Read invoice state (draft/posted), payment_state, and residual (for sync / payment targeting). */
export const getInvoiceState = (invoiceId) =>
  callOdoo("account.move", "read", [[invoiceId]], {
    fields: ["id", "name", "state", "payment_state", "amount_residual", "move_type"],
  }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Normalize sale.order invoice_ids to numeric ids. */
export const normalizeSaleOrderInvoiceIds = (invoiceIds) => {
  if (!Array.isArray(invoiceIds)) return [];
  return invoiceIds
    .map((x) => (Array.isArray(x) ? x[0] : x))
    .map((n) => Number(n))
    .filter((n) => n > 0 && !Number.isNaN(n));
};

const isPostedUnpaidCustomerInvoice = (m) => {
  if (!m || (m.move_type || "") !== "out_invoice") return false;
  const st = (m.state || "").toLowerCase();
  if (st !== "posted") return false;
  const ps = (m.payment_state || "").toLowerCase();
  return ps === "not_paid" || ps === "partial" || ps === "in_payment";
};

/**
 * Pick which posted (unpaid) invoice should receive a single cash/cheque line.
 * Prefers the smallest residual that still covers the amount; otherwise the largest unpaid residual.
 */
export const pickInvoiceIdForPaymentAmount = (postedUnpaidInvoices, amount) => {
  const amt = round2(amount);
  const tol = 0.02;
  const list = (postedUnpaidInvoices || []).filter(
    (i) => round2(Number(i.amount_residual) || 0) > tol
  );
  if (!list.length) return null;
  const fits = list.filter((i) => round2(Number(i.amount_residual) || 0) >= amt - tol);
  const pool = fits.length ? fits : list;
  if (fits.length) {
    pool.sort((a, b) => round2(a.amount_residual) - round2(b.amount_residual));
  } else {
    pool.sort((a, b) => round2(b.amount_residual) - round2(a.amount_residual));
  }
  return pool[0]?.id ?? null;
};

/** Load customer invoices for SO that are posted and still have a receivable balance. */
export const loadPostedUnpaidInvoicesForSaleOrder = async (saleOrderId) => {
  const ids = normalizeSaleOrderInvoiceIds(await getSaleOrderInvoiceIds(saleOrderId));
  if (!ids.length) return [];
  const rows = await callOdoo("account.move", "read", [ids], {
    fields: ["id", "name", "state", "payment_state", "amount_residual", "move_type"],
  });
  const list = Array.isArray(rows) ? rows : [];
  return list.filter(
    (m) => isPostedUnpaidCustomerInvoice(m) && round2(Number(m.amount_residual) || 0) > 0.02
  );
};

/**
 * Choose invoice id for payment sync: never prefer a fully paid posted invoice when unpaid ones exist.
 * - Posted + unpaid: best match on amount_residual vs expectedPaymentTotal, else largest residual.
 * - Else newest draft (highest id).
 * - Else null → caller runs advance-payment wizard when SO can still invoice.
 */
export const resolveInitialInvoiceIdForPaymentSync = async (
  saleOrderId,
  { expectedPaymentTotal, orderInfo: orderInfoArg } = {}
) => {
  const soNum = Number(saleOrderId);
  if (!soNum) return { resId: null, invoiceAlreadyPosted: false };

  const orderInfo =
    orderInfoArg ||
    (await callOdoo("sale.order", "read", [[soNum]], {
      fields: ["id", "invoice_ids", "invoice_status", "amount_total"],
    }).then((rows) => (Array.isArray(rows) ? rows[0] : rows)));

  const idList = normalizeSaleOrderInvoiceIds(orderInfo?.invoice_ids);
  const expected =
    expectedPaymentTotal != null && Number.isFinite(Number(expectedPaymentTotal))
      ? round2(Number(expectedPaymentTotal))
      : null;

  if (!idList.length) {
    return { resId: null, invoiceAlreadyPosted: false };
  }

  const moves = await callOdoo("account.move", "read", [idList], {
    fields: ["id", "state", "payment_state", "amount_total", "amount_residual", "move_type"],
  });
  const all = Array.isArray(moves) ? moves : [];
  const outInv = all.filter((m) => (m.move_type || "") === "out_invoice");

  const postedUnpaid = outInv.filter((m) => isPostedUnpaidCustomerInvoice(m));
  const drafts = outInv.filter((m) => (m.state || "").toLowerCase() === "draft");
  drafts.sort((a, b) => Number(b.id) - Number(a.id));

  if (postedUnpaid.length) {
    let chosen = postedUnpaid[0];
    if (expected != null && expected > 0) {
      let best = null;
      let bestDiff = Infinity;
      for (const m of postedUnpaid) {
        const res = round2(Number(m.amount_residual) || 0);
        const diff = Math.abs(res - expected);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = m;
        }
      }
      const tol = Math.max(2, expected * 0.02);
      if (best != null && (bestDiff <= tol || postedUnpaid.length === 1)) {
        chosen = best;
      } else {
        postedUnpaid.sort(
          (a, b) => round2(Number(b.amount_residual) || 0) - round2(Number(a.amount_residual) || 0)
        );
        chosen = postedUnpaid[0];
      }
    } else {
      postedUnpaid.sort(
        (a, b) => round2(Number(b.amount_residual) || 0) - round2(Number(a.amount_residual) || 0)
      );
      chosen = postedUnpaid[0];
    }
    return { resId: chosen.id, invoiceAlreadyPosted: true };
  }

  if (drafts.length) {
    return { resId: drafts[0].id, invoiceAlreadyPosted: false };
  }

  const invStatus = (orderInfo?.invoice_status || "").toLowerCase();
  const onlyPaidPosted =
    outInv.length > 0 &&
    outInv.every((m) => {
      const st = (m.state || "").toLowerCase();
      const ps = (m.payment_state || "").toLowerCase();
      return st === "posted" && (ps === "paid" || ps === "reversed");
    });

  if (onlyPaidPosted && (invStatus === "to invoice" || invStatus === "upselling")) {
    return { resId: null, invoiceAlreadyPosted: false };
  }

  return { resId: null, invoiceAlreadyPosted: false };
};

const QTY_INVOICE_TOL = 0.02;

const roundQty3 = (q) => Math.round(Number(q) * 1000) / 1000;

/**
 * Expected qty per sale.order.line from mobile checkout snapshot.
 * @param {Array<{ lineId?: number, qty_delivered?: number, qty?: number }>} deliveredUpdates
 */
export function buildExpectedQtyMapFromDeliveredUpdates(deliveredUpdates) {
  const map = new Map();
  for (const u of deliveredUpdates || []) {
    const lid = Number(u?.lineId);
    const q = roundQty3(u?.qty_delivered ?? u?.qty);
    if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(q)) continue;
    map.set(lid, q);
  }
  return map;
}

/**
 * Compare Odoo sale.order.line qty_delivered / qty_invoiced to the mobile snapshot.
 * Used before posting invoices so stale draft or race-condition qty cannot ship to accounting.
 */
export async function verifySaleOrderDeliveredAndInvoicedQty(deliveredUpdates, options = {}) {
  const {
    checkDelivered = true,
    checkInvoiced = false,
    tolerance = QTY_INVOICE_TOL,
  } = options;
  const expected = buildExpectedQtyMapFromDeliveredUpdates(deliveredUpdates);
  if (expected.size === 0) return { ok: true, mismatches: [] };

  const lineIds = [...expected.keys()];
  const rows =
    (await callOdoo("sale.order.line", "read", [lineIds], {
      fields: ["id", "product_id", "qty_delivered", "qty_invoiced"],
    })) || [];
  const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [Number(r.id), r]));
  const mismatches = [];

  for (const [lid, expQty] of expected) {
    const row = byId.get(lid);
    if (!row) {
      mismatches.push({ lineId: lid, field: "missing_line", expected: expQty, actual: null });
      continue;
    }
    if (checkDelivered) {
      const actual = roundQty3(row.qty_delivered);
      if (!Number.isFinite(actual) || Math.abs(actual - expQty) > tolerance) {
        mismatches.push({
          lineId: lid,
          field: "qty_delivered",
          expected: expQty,
          actual,
          productId: Array.isArray(row.product_id) ? row.product_id[0] : row.product_id,
        });
      }
    }
    if (checkInvoiced) {
      const actualInv = roundQty3(row.qty_invoiced);
      if (!Number.isFinite(actualInv) || Math.abs(actualInv - expQty) > tolerance) {
        mismatches.push({
          lineId: lid,
          field: "qty_invoiced",
          expected: expQty,
          actual: actualInv,
          productId: Array.isArray(row.product_id) ? row.product_id[0] : row.product_id,
        });
      }
    }
  }

  const ok = mismatches.length === 0;
  return {
    ok,
    mismatches,
    reason: ok
      ? null
      : mismatches
          .slice(0, 4)
          .map((m) => `line ${m.lineId} ${m.field}: want ${m.expected} got ${m.actual}`)
          .join("; "),
  };
}

/** Remove a draft customer invoice so sync can recreate from corrected delivered qty. */
export async function unlinkDraftCustomerInvoice(invoiceId) {
  const invNum = Number(invoiceId);
  if (!Number.isFinite(invNum) || invNum <= 0) return { ok: false, reason: "invalid invoice id" };
  const st = await getInvoiceState(invNum).catch(() => ({}));
  const state = String(st?.state || "").toLowerCase();
  if (state === "posted") {
    return { ok: false, reason: "cannot unlink posted invoice" };
  }
  if (state !== "draft" && state !== "cancel") {
    return { ok: false, reason: `invoice state ${state || "unknown"}` };
  }
  await callOdoo("account.move", "unlink", [[invNum]]);
  return { ok: true };
}

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

/** Get invoices by sale order origin (invoice_origin in orderNames). Matches API: account.move search_read. */
export const getInvoicesByOrigins = (orderNames) => {
  if (!Array.isArray(orderNames) || orderNames.length === 0) return Promise.resolve([]);
  const domain = [
    ["invoice_origin", "in", orderNames],
    ["move_type", "=", "out_invoice"],
  ];
  return callOdoo(
    "account.move",
    "search_read",
    [domain],
    {
      fields: ["id", "name", "invoice_origin", "payment_state", "amount_total", "amount_residual"],
      limit: 500,
    }
  );
};

const READ_CHUNK = 80;

/** Resolve sale.order ids for a batch of order names (for collection totals / payment refresh). */
export async function searchSaleOrderIdsByNames(orderNames) {
  const names = Array.isArray(orderNames)
    ? [...new Set(orderNames.map((n) => String(n || "").trim()).filter(Boolean))]
    : [];
  if (names.length === 0) return [];
  const ids = [];
  for (let i = 0; i < names.length; i += READ_CHUNK) {
    const chunk = names.slice(i, i + READ_CHUNK);
    const rows = await callOdoo("sale.order", "search_read", [[["name", "in", chunk]]], {
      fields: ["id", "name"],
      limit: READ_CHUNK,
    });
    for (const r of rows || []) {
      const id = Number(r.id);
      if (Number.isFinite(id) && id > 0) ids.push(id);
    }
  }
  return ids;
}

/**
 * Merge invoices found by invoice_origin with those linked on sale.order.invoice_ids.
 * Fixes new devices when origin text does not match SO name (formatting / localization) so payments still resolve.
 * @param {string[]} orderNames - sale order names (e.g. S00185)
 * @param {number[]} saleOrderIds - sale.order database ids for invoiced orders
 * @returns {Promise<Array<{ id: number, name?: string, invoice_origin: string, payment_state?: string, amount_total?: number, amount_residual?: number }>>}
 */
export async function getInvoicesForPaymentRefresh(orderNames, saleOrderIds) {
  const names = Array.isArray(orderNames) ? [...new Set(orderNames.map((n) => String(n || "").trim()).filter(Boolean))] : [];
  const soIds = [...new Set((saleOrderIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];

  const byOrigin = names.length ? await getInvoicesByOrigins(names) : [];
  const map = new Map();
  for (const inv of byOrigin || []) {
    if (inv?.id != null) map.set(Number(inv.id), { ...inv });
  }

  const invIdToSoName = {};
  for (let i = 0; i < soIds.length; i += READ_CHUNK) {
    const chunk = soIds.slice(i, i + READ_CHUNK);
    const rows = await callOdoo("sale.order", "read", [chunk], {
      fields: ["id", "name", "invoice_ids"],
    });
    for (const so of rows || []) {
      const nm = String(so.name || "").trim();
      for (const iid of normalizeSaleOrderInvoiceIds(so.invoice_ids)) {
        if (!invIdToSoName[iid]) invIdToSoName[iid] = nm;
      }
    }
  }

  const missingIds = Object.keys(invIdToSoName)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0 && !map.has(id));

  for (let i = 0; i < missingIds.length; i += READ_CHUNK) {
    const chunk = missingIds.slice(i, i + READ_CHUNK);
    const moves = await callOdoo("account.move", "read", [chunk], {
      fields: ["id", "name", "invoice_origin", "payment_state", "amount_total", "amount_residual", "move_type"],
    });
    for (const m of moves || []) {
      if ((m.move_type || "") !== "out_invoice") continue;
      const fallbackName = invIdToSoName[m.id] || "";
      const originRaw = m.invoice_origin != null ? String(m.invoice_origin).trim() : "";
      const invoice_origin = originRaw || fallbackName;
      map.set(Number(m.id), {
        id: m.id,
        name: m.name,
        invoice_origin,
        payment_state: m.payment_state,
        amount_total: m.amount_total,
        amount_residual: m.amount_residual,
      });
    }
  }

  for (const inv of map.values()) {
    if (!inv.invoice_origin || !String(inv.invoice_origin).trim()) {
      const fill = invIdToSoName[inv.id];
      if (fill) inv.invoice_origin = fill;
    }
  }

  return Array.from(map.values()).filter((inv) => inv.invoice_origin && String(inv.invoice_origin).trim());
}

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

/** Update invoice's incoterm_location with locally generated invoice number (mobile invoice no). */
export const updateInvoiceIncotermLocation = (invoiceId, localInvoiceNumber) => {
  if (invoiceId == null || localInvoiceNumber == null) return Promise.resolve(false);
  const idNum = Number(invoiceId);
  const text = String(localInvoiceNumber).trim();
  if (!idNum || !text) return Promise.resolve(false);
  return (async () => {
    let candidate = text;
    for (let i = 0; i < 25; i++) {
      const existing = await callOdoo(
        "account.move",
        "search_read",
        [[["incoterm_location", "=", candidate], ["id", "!=", idNum]]],
        { fields: ["id"], limit: 1 }
      );
      if (!Array.isArray(existing) || existing.length === 0) break;
      candidate = `${text}.${i + 1}`;
    }
    return callOdooArgs("account.move", "write", [[idNum], { incoterm_location: candidate }]);
  })();
};

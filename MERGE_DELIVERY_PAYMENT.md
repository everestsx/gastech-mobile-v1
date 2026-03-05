# Merge: Delivery & Payment from dev-v8 (keep other UI)

When merging **dev-v8** into another branch (e.g. `dev`), use this so **delivery and payment** (proceed to payment, cash/cheque/credit) come from **dev-v8**, while **other UI** (dashboard, vehicle stock, theme, etc.) stays from the target branch.

## From dev-v8 (delivery + payment – merge these)

- **`src/screens/ProceedPaymentScreen.jsx`**  
  Full payment screen: Cash / Cheque / Credit, split amounts, bank selection, cheque number, evidence of delivery photos, signature, queue payload with `invoiceNumber`, `payments`, `chequeBankName`, `checkNumber`.

- **`src/services/sync.service.js`**  
  `processSyncQueue()`: delivery queue (order line qtys, move updates, validate picking) and **payment queue** (create advance payment wizard, create/post invoice, create/post/reconcile cash & cheque payments, credit-only = post invoice only, payment proof chatter + attachments from `offline_attachments`).

- **`src/services/invoice.service.js`**  
  All invoice and payment APIs used by sync: `createAdvancePaymentWizard`, `createInvoicesFromWizard`, `postInvoice`, `createPayment`, `postPaymentAndReconcile`, `getSaleOrderForPayment`, `getSaleOrderInvoiceIds`, `getInvoiceState`, etc.

- **`src/database/syncQueue.js`**  
  `ACTION_DELIVERY`, `ACTION_PAYMENT`, and (if the other branch uses it) `ACTION_INVENTORY_UPDATE`.

- **SaleOrderDetailsScreen – payment flow only**  
  Keep the logic that:  
  1. Calls `applyQtyDoneAndValidate(effectiveQtys, true)`.  
  2. Then navigates to `ProceedPayment` with `{ saleOrderId, total, deliveryDone: true }`.  
  You can **keep** the target branch’s UI and vehicle inventory logic (e.g. `updateVehicleInventory`, stock warnings, `getCachedVehicleInventoryByLocation`); just ensure the “Proceed to payment” button still does the two steps above (and optionally vehicle inventory update before navigate).

## Keep from target branch (other UI – do not overwrite)

- Dashboard, menu, theme, login, settings.
- Vehicle stock screen and vehicle inventory UI in **SaleOrderDetailsScreen** (stock warnings, “Available Stock”, inventory update and any `ACTION_INVENTORY_UPDATE` enqueue) – unless you explicitly want to drop them.

## Quick checklist

1. **ProceedPaymentScreen.jsx** – use dev-v8 version (payment methods, amounts, bank, cheque#, evidence photos, signature, queue + InvoiceScreen navigation).
2. **sync.service.js** – use dev-v8’s `processSyncQueue` (delivery + payment processing, including proof attachments).
3. **invoice.service.js** – use dev-v8 version.
4. **syncQueue.js** – ensure `ACTION_DELIVERY`, `ACTION_PAYMENT`, and (if needed) `ACTION_INVENTORY_UPDATE` are defined.
5. **SaleOrderDetailsScreen** – keep target branch’s UI and inventory logic; ensure “Proceed to payment” still runs delivery update then `navigation.navigate('ProceedPayment', { saleOrderId, total, deliveryDone: true })`.

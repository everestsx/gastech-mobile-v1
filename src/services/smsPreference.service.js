/**
 * Driver-selected customer SMS preference for one checkout.
 *
 * The back office sends the delivery SMS when the invoice is confirmed. The driver sets this
 * with a toggle on the invoice screen; the choice rides on the pending payment queue payload,
 * and this module tells sync.service whether to stamp `sms_enabled` on the invoice before posting.
 */

/**
 * Flip to true once `sms_enabled` exists on account.move in the back office.
 * While false the choice is still collected and stored, but no extra Odoo call is made —
 * payment sync behaves exactly as it did before this feature.
 */
export const SMS_PREFERENCE_BACKEND_READY = false;

/** No choice recorded means no message: an order that skipped the toggle must not text the customer. */
export const DEFAULT_SMS_ENABLED = false;

/**
 * Read the flag back off a queue payload or navigation params.
 * Queue payloads round-trip through JSON and older rows predate this field, so accept the
 * loose forms and treat anything unrecognised as "do not send".
 */
export function normalizeSmsEnabled(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return DEFAULT_SMS_ENABLED;
}

/** True when sync should write `sms_enabled` on the invoice before action_post. */
export function shouldWriteInvoiceSmsFlag() {
  return SMS_PREFERENCE_BACKEND_READY === true;
}

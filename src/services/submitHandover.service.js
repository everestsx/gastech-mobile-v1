import { callOdooJson2 } from './index.service';

/**
 * gastech.bulk.sale.summary — End Day Handover summary sync (Post Check submit).
 * Same JSON 2 / Bearer pattern as commission.service.js: host comes from ODOO_URL
 * (env/session), never hardcoded here.
 */
const BULK_SALE_SUMMARY_MODEL = 'gastech.bulk.sale.summary';

/**
 * Submit the End Day Handover summary to the back office.
 * @param {object} p
 * @param {string} p.date - yyyy-mm-dd
 * @param {number} p.vehicleId
 * @param {number} p.driverId
 * @param {string} p.route
 * @param {number} p.cashAmount
 * @param {number} p.chequeAmount
 * @param {number} p.creditAmount
 * @param {string} p.handedOver - accountant name the cash/cheque was handed to
 * @param {string} p.handedOverLocation
 * @returns {Promise<object>} the created record (throws on failure — caller decides how to handle)
 */
export const recordBulkSaleSummary = async ({
  date,
  vehicleId,
  driverId,
  route,
  cashAmount,
  chequeAmount,
  creditAmount,
  handedOver,
  handedOverLocation,
}) => {
  return callOdooJson2(BULK_SALE_SUMMARY_MODEL, 'record_summary', {
    date,
    vehicle_id: vehicleId,
    driver_id: driverId,
    route: route || '',
    cash_amount: Number(cashAmount) || 0,
    cheque_amount: Number(chequeAmount) || 0,
    credit_amount: Number(creditAmount) || 0,
    handed_over: handedOver || '',
    handed_over_location: handedOverLocation || '',
  });
};

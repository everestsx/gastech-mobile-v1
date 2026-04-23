import { callOdooJson2 } from './index.service';

function localYyyyMmDd(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMonthDateRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    dateFrom: localYyyyMmDd(from),
    dateTo: localYyyyMmDd(now),
  };
}

export async function getDeliverySummaryByEmployeeByDate({ dateFrom, dateTo, employeeIds = [] }) {
  const domain = [
    ['date', '>=', String(dateFrom)],
    ['date', '<=', String(dateTo)],
  ];
  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    domain.push(['employee_id', 'in', employeeIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))]);
  }
  const fields = [
    'date',
    'employee_id',
    'employee_type',
    'bulk_sale_order_id',
    'vehicle_id',
    'qty_gas_24',
    'qty_gas_5',
    'qty_gas_125',
    'qty_gas_375',
    'total_qty',
  ];
  try {
    const rows = await callOdooJson2('daily.delivery.summary', 'search_read', { domain, fields });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[Commission New] delivery summary failed', e?.message || e);
    return [];
  }
}

export async function getCommissionByEmployeeByDate({ dateFrom, dateTo, employeeIds = [] }) {
  const domain = [
    ['date', '>=', String(dateFrom)],
    ['date', '<=', String(dateTo)],
  ];
  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    domain.push(['employee_id', 'in', employeeIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))]);
  }
  const fields = [
    'date',
    'employee_id',
    'employee_type',
    'plan',
    'commission_route1',
    'commission_route2',
    'total_commission',
  ];
  try {
    const rows = await callOdooJson2('delivery.commission', 'search_read', { domain, fields });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[Commission New] commission rows failed', e?.message || e);
    return [];
  }
}

function ensureEmployeeEntry(map, employeeId, fallbackName = '', fallbackType = '') {
  if (!map.has(employeeId)) {
    map.set(employeeId, {
      employeeId,
      employeeName: fallbackName || `Employee ${employeeId}`,
      employeeType: fallbackType || '',
      qty24: 0,
      qty5: 0,
      qty125: 0,
      qty375: 0,
      totalQty: 0,
      commissionRoute1: 0,
      commissionRoute2: 0,
      totalCommission: 0,
      plans: [],
      lastDate: '',
    });
  }
  return map.get(employeeId);
}

export function mergeCommissionRowsByEmployee(deliveryRows, commissionRows) {
  const map = new Map();

  for (const row of deliveryRows || []) {
    const empRel = Array.isArray(row?.employee_id) ? row.employee_id : [row?.employee_id, ''];
    const empId = Number(empRel?.[0]);
    if (!Number.isFinite(empId)) continue;
    const entry = ensureEmployeeEntry(map, empId, String(empRel?.[1] || ''), String(row?.employee_type || ''));
    entry.qty24 += Number(row?.qty_gas_24) || 0;
    entry.qty5 += Number(row?.qty_gas_5) || 0;
    entry.qty125 += Number(row?.qty_gas_125) || 0;
    entry.qty375 += Number(row?.qty_gas_375) || 0;
    entry.totalQty += Number(row?.total_qty) || 0;
    entry.lastDate = String(row?.date || entry.lastDate || '');
  }

  for (const row of commissionRows || []) {
    const empRel = Array.isArray(row?.employee_id) ? row.employee_id : [row?.employee_id, ''];
    const empId = Number(empRel?.[0]);
    if (!Number.isFinite(empId)) continue;
    const entry = ensureEmployeeEntry(map, empId, String(empRel?.[1] || ''), String(row?.employee_type || ''));
    entry.commissionRoute1 += Number(row?.commission_route1) || 0;
    entry.commissionRoute2 += Number(row?.commission_route2) || 0;
    entry.totalCommission += Number(row?.total_commission) || 0;
    if (row?.plan != null) {
      const p = String(row.plan).trim();
      if (p && !entry.plans.includes(p)) entry.plans.push(p);
    }
    entry.lastDate = String(row?.date || entry.lastDate || '');
  }

  return Array.from(map.values()).sort((a, b) => b.totalCommission - a.totalCommission);
}

/** Local calendar YYYY-MM-DD (avoid UTC day-shift from toISOString().slice(0,10)). */
export function formatLocalYyyyMmDd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Map ISO / SQLite timestamp to local calendar date key. */
export function localDateKeyFromTimestamp(raw) {
  if (raw == null || raw === '') return '';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isNaN(d.getTime())) return formatLocalYyyyMmDd(d);
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

export function invoiceMatchesLocalDate(inv, dateStr) {
  if (!dateStr) return false;
  const raw = inv?.created_at ?? inv?.dateOrder ?? inv?.date_order ?? '';
  return localDateKeyFromTimestamp(raw) === dateStr;
}

export function isLocalToday(d) {
  return formatLocalYyyyMmDd(d) === formatLocalYyyyMmDd(new Date());
}

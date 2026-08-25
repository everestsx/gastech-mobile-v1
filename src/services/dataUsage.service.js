import AsyncStorage from '@react-native-async-storage/async-storage';

const EVENTS_KEY = '@gastech_data_usage_events_v1';
const PREFS_KEY = '@gastech_data_usage_prefs_v1';
const MAX_EVENTS = 500;
/** Keep history for 2 calendar months, then prune automatically. */
export const DATA_USAGE_RETENTION_MONTHS = 2;

const SESSION_TYPE_MASTER_SYNC = 'master_data_sync';
const SESSION_TYPE_ORDER_SYNC = 'order_completion_sync';
const SESSION_TYPE_PRECHECK_SYNC = 'precheck_sync';

const activeSessions = [];

function nowIso() {
  return new Date().toISOString();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toBytes(payload) {
  if (payload == null) return 0;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    return new TextEncoder().encode(text).length;
  } catch (_) {
    try {
      return unescape(encodeURIComponent(text)).length;
    } catch (_) {
      return String(text).length;
    }
  }
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonths(d, months) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function parseYmd(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getPeriodRange(period, custom = {}) {
  const now = new Date();
  if (period === 'today') {
    return { from: startOfLocalDay(now), to: endOfLocalDay(now), label: 'Today' };
  }
  if (period === 'week') {
    return {
      from: startOfLocalDay(addDays(now, -6)),
      to: endOfLocalDay(now),
      label: 'Last 7 days',
    };
  }
  if (period === 'month') {
    const from = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { from, to: endOfLocalDay(now), label: 'This month' };
  }
  if (period === 'custom_month') {
    const base = parseYmd(custom?.monthYmd) || now;
    const from = startOfLocalDay(new Date(base.getFullYear(), base.getMonth(), 1));
    const to = endOfLocalDay(new Date(base.getFullYear(), base.getMonth() + 1, 0));
    const label = from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return { from, to, label };
  }
  // custom date range
  let from = parseYmd(custom?.dateFrom);
  let to = parseYmd(custom?.dateTo);
  if (!from || !to) {
    from = startOfLocalDay(now);
    to = endOfLocalDay(now);
  }
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return {
    from: startOfLocalDay(from),
    to: endOfLocalDay(to),
    label: `${toYmd(from)} → ${toYmd(to)}`,
  };
}

function eventTime(event) {
  const raw = event?.endedAt || event?.startedAt;
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export function filterEventsByRange(events, from, to) {
  const list = Array.isArray(events) ? events : [];
  const fromMs = from?.getTime?.() ?? 0;
  const toMs = to?.getTime?.() ?? Date.now();
  return list.filter((e) => {
    const t = eventTime(e);
    if (!t) return false;
    const ms = t.getTime();
    return ms >= fromMs && ms <= toMs;
  });
}

export function summarizeUsage(events) {
  const list = Array.isArray(events) ? events : [];
  const byType = {};
  const totals = list.reduce(
    (acc, item) => {
      const up = Math.max(0, safeNum(item?.upBytes));
      const down = Math.max(0, safeNum(item?.downBytes));
      const total = Math.max(0, safeNum(item?.totalBytes) || up + down);
      acc.up += up;
      acc.down += down;
      acc.total += total;
      acc.count += 1;
      const key = item?.type || 'generic_sync';
      if (!byType[key]) byType[key] = { up: 0, down: 0, total: 0, count: 0 };
      byType[key].up += up;
      byType[key].down += down;
      byType[key].total += total;
      byType[key].count += 1;
      return acc;
    },
    { up: 0, down: 0, total: 0, count: 0 }
  );
  return { ...totals, byType };
}

function retentionCutoffDate(now = new Date()) {
  return startOfLocalDay(addMonths(now, -DATA_USAGE_RETENTION_MONTHS));
}

function pruneEventsOlderThanRetention(events, now = new Date()) {
  const cutoff = retentionCutoffDate(now).getTime();
  const list = Array.isArray(events) ? events : [];
  return list.filter((e) => {
    const t = eventTime(e);
    if (!t) return false;
    return t.getTime() >= cutoff;
  });
}

async function readEventsRaw() {
  try {
    const raw = await AsyncStorage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function writeEvents(events) {
  try {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch (_) {
    // non-fatal
  }
}

/** Prune history older than 2 months. Called on read so cleanup is automatic. */
async function readEvents() {
  const current = await readEventsRaw();
  const pruned = pruneEventsOlderThanRetention(current);
  if (pruned.length !== current.length) {
    await writeEvents(pruned);
  }
  return pruned;
}

export async function getUsagePrefs() {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) {
      return {
        period: 'today',
        dateFrom: toYmd(new Date()),
        dateTo: toYmd(new Date()),
        monthYmd: toYmd(new Date()),
      };
    }
    const parsed = JSON.parse(raw);
    return {
      period: parsed?.period || 'today',
      dateFrom: parsed?.dateFrom || toYmd(new Date()),
      dateTo: parsed?.dateTo || toYmd(new Date()),
      monthYmd: parsed?.monthYmd || toYmd(new Date()),
    };
  } catch (_) {
    return {
      period: 'today',
      dateFrom: toYmd(new Date()),
      dateTo: toYmd(new Date()),
      monthYmd: toYmd(new Date()),
    };
  }
}

export async function saveUsagePrefs(prefs = {}) {
  try {
    const current = await getUsagePrefs();
    const next = {
      ...current,
      ...(prefs && typeof prefs === 'object' ? prefs : {}),
    };
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  } catch (_) {
    return prefs;
  }
}

export function createUsageSession(type, meta = {}) {
  const normalizedType =
    type === SESSION_TYPE_MASTER_SYNC ||
    type === SESSION_TYPE_ORDER_SYNC ||
    type === SESSION_TYPE_PRECHECK_SYNC
      ? type
      : 'generic_sync';
  const id = `${normalizedType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  activeSessions.push({
    id,
    type: normalizedType,
    meta: meta && typeof meta === 'object' ? { ...meta } : {},
    startedAt: nowIso(),
    upBytes: 0,
    downBytes: 0,
  });
  return id;
}

export function trackNetworkUsage(upBytes, downBytes, meta = {}) {
  if (activeSessions.length === 0) return;
  const target = activeSessions[activeSessions.length - 1];
  if (!target) return;
  target.upBytes += Math.max(0, safeNum(upBytes));
  target.downBytes += Math.max(0, safeNum(downBytes));
  if (meta && typeof meta === 'object') {
    target.meta = { ...target.meta, lastCall: meta };
  }
}

export async function finishUsageSession(sessionId, extra = {}) {
  const idx = activeSessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return null;
  const [session] = activeSessions.splice(idx, 1);
  const endedAt = nowIso();
  const upBytes = Math.max(0, safeNum(session.upBytes));
  const downBytes = Math.max(0, safeNum(session.downBytes));
  const totalBytes = upBytes + downBytes;
  const shouldSave = totalBytes > 0 || extra?.forceSave === true;
  if (!shouldSave) return null;

  const event = {
    id: session.id,
    type: session.type,
    startedAt: session.startedAt,
    endedAt,
    upBytes,
    downBytes,
    totalBytes,
    meta: {
      ...(session.meta || {}),
      ...(extra && typeof extra === 'object' ? extra : {}),
    },
  };
  const current = await readEvents();
  const next = pruneEventsOlderThanRetention([event, ...current]).slice(0, MAX_EVENTS);
  await writeEvents(next);
  return event;
}

export async function listUsageEvents() {
  return readEvents();
}

export async function clearUsageEvents() {
  await writeEvents([]);
}

/** Force prune now (same as automatic 2-month cleanup). */
export async function pruneExpiredUsageEvents() {
  const current = await readEventsRaw();
  const pruned = pruneEventsOlderThanRetention(current);
  await writeEvents(pruned);
  return { before: current.length, after: pruned.length, removed: current.length - pruned.length };
}

export function usageBytes(value) {
  return toBytes(value);
}

export const DATA_USAGE_SESSION_TYPES = {
  MASTER_SYNC: SESSION_TYPE_MASTER_SYNC,
  ORDER_SYNC: SESSION_TYPE_ORDER_SYNC,
  PRECHECK_SYNC: SESSION_TYPE_PRECHECK_SYNC,
};

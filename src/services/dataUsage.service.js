import AsyncStorage from '@react-native-async-storage/async-storage';

const EVENTS_KEY = '@gastech_data_usage_events_v1';
const MAX_EVENTS = 300;
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

async function readEvents() {
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
  const next = [event, ...current].slice(0, MAX_EVENTS);
  await writeEvents(next);
  return event;
}

export async function listUsageEvents() {
  return readEvents();
}

export async function clearUsageEvents() {
  await writeEvents([]);
}

export function usageBytes(value) {
  return toBytes(value);
}

export const DATA_USAGE_SESSION_TYPES = {
  MASTER_SYNC: SESSION_TYPE_MASTER_SYNC,
  ORDER_SYNC: SESSION_TYPE_ORDER_SYNC,
  PRECHECK_SYNC: SESSION_TYPE_PRECHECK_SYNC,
};

/**
 * Android OS progress notification + foreground service keep-alive for order upload.
 * Shows only while completed orders are actually being sent to the back office.
 * Does not enqueue, retry, or mutate delivery/payment data.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import i18n from '../i18n';

const Native = Platform.OS === 'android' ? NativeModules.BackgroundSyncNativeModule : null;

let _active = false;
let _completed = false;
let _sessionTotal = 0;
let _permissionAsked = false;
let _midnightTimer = null;
let _startedOnDayKey = '';

function t(key, fallback, vars) {
  try {
    return i18n.t(key, { defaultValue: fallback, ...(vars && typeof vars === 'object' ? vars : {}) });
  } catch (_) {
    return fallback;
  }
}

function nativeAvailable() {
  return Platform.OS === 'android' && Native != null;
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
  return Math.max(1000, next.getTime() - now.getTime());
}

function clearMidnightTimer() {
  if (_midnightTimer) {
    clearTimeout(_midnightTimer);
    _midnightTimer = null;
  }
}

function armMidnightDismiss() {
  clearMidnightTimer();
  _midnightTimer = setTimeout(() => {
    _midnightTimer = null;
    stopBackgroundOrderSyncNotification();
  }, msUntilNextLocalMidnight());
}

export function isBackgroundOrderSyncNotificationActive() {
  return _active && !_completed;
}

async function ensureNotificationPermission() {
  if (Platform.OS !== 'android') return true;
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (granted) return true;
    if (_permissionAsked) return false;
    _permissionAsked = true;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
      title: t('sync.notificationPermissionTitle', 'Allow sync notifications'),
      message: t(
        'sync.notificationPermissionBody',
        'Gas Tech can show upload progress in the notification area so you can leave the app while orders sync.'
      ),
      buttonPositive: t('common.ok', 'OK'),
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (_) {
    return false;
  }
}

function customerLabel(job) {
  const name = String(job?.customerName || '').trim();
  if (name) return name;
  const orderName = String(job?.orderName || '').trim();
  if (orderName) return orderName;
  const soId = Number(job?.soId);
  return Number.isFinite(soId) && soId > 0 ? `Order ${soId}` : t('sync.notifyCustomerFallback', 'Customer');
}

function buildCopy(jobs, remaining, total) {
  const list = Array.isArray(jobs) ? jobs : [];
  const left = Math.max(0, Number(remaining) || list.length || 0);
  const max = Math.max(1, Number(total) || left || 1);
  const done = Math.min(max, Math.max(0, max - left));

  if (left <= 0) {
    return {
      title: t('sync.notifyCompleteTitle', 'Upload complete'),
      text: t('sync.notifyCompleteBody', 'Order has been synced to the back office.'),
      lines: [],
      max,
      current: max,
      indeterminate: false,
    };
  }

  const lines = list.slice(0, 7).map((job, index) => {
    const label = customerLabel(job);
    const orderName = String(job?.orderName || '').trim();
    const sending = index === 0;
    const status = sending
      ? t('sync.notifyLineSending', 'sending to back office')
      : t('sync.notifyLineWaiting', 'waiting');
    return orderName ? `${label} · ${orderName} — ${status}` : `${label} — ${status}`;
  });

  if (list.length <= 1) {
    const job = list[0] || {};
    const label = customerLabel(job);
    const orderName = String(job?.orderName || '').trim();
    return {
      title: label,
      text: orderName
        ? t('sync.notifySingleBodyNamed', 'Sending {{order}} to the back office', { order: orderName })
        : t('sync.notifySingleBody', 'Sending this order to the back office'),
      lines: [],
      max,
      current: done,
      indeterminate: done <= 0,
    };
  }

  return {
    title: t('sync.notifyBulkTitle', 'Syncing {{count}} orders', { count: left }),
    text: t('sync.notifyBulkBody', '{{done}} of {{total}} sent to the back office', {
      done,
      total: max,
    }),
    lines,
    max,
    current: done,
    indeterminate: false,
  };
}

function callNative(method, payload) {
  if (!nativeAvailable() || typeof Native[method] !== 'function') return;
  try {
    const result = payload === undefined ? Native[method]() : Native[method](payload);
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
    }
  } catch (_) {
    /* native keep-alive is best-effort */
  }
}

async function lookupSaleOrderJob(soIdRaw) {
  const soId = Number(soIdRaw);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  try {
    const saleOrdersDb = await import('../database/saleOrders.js');
    const so = await saleOrdersDb.getSaleOrderById(soId);
    if (!so) return { soId, customerName: '', orderName: '' };
    const partnerName =
      String(so.partner_name || '').trim() ||
      (Array.isArray(so.partner_id) ? String(so.partner_id[1] || '').trim() : '');
    return {
      soId,
      customerName: partnerName,
      orderName: String(so.name || '').trim(),
    };
  } catch (_) {
    return { soId, customerName: '', orderName: '' };
  }
}

/** Completed orders whose delivery/payment still needs to reach the back office. */
export async function loadBackOfficeOrderSyncJobs(extraSaleOrderId) {
  const jobs = new Map();
  try {
    const syncQueueDb = await import('../database/syncQueue.js');
    const pending = await syncQueueDb.getPending().catch(() => []);
    for (const row of pending || []) {
      if (
        row.action_type !== syncQueueDb.ACTION_PAYMENT &&
        row.action_type !== syncQueueDb.ACTION_DELIVERY
      ) {
        continue;
      }
      const p = row.payload || {};
      if (p.holdUntilPayment === true || p.holdUntilComplete === true) continue;
      const soId = Number(p.saleOrderId ?? p.sale_order_id ?? p.sale_id);
      if (!Number.isFinite(soId) || soId <= 0) continue;
      const existing = jobs.get(soId) || { soId, customerName: '', orderName: '' };
      existing.orderName = existing.orderName || String(p.orderName || p.order_name || '').trim();
      existing.customerName =
        existing.customerName ||
        String(p.partnerName || p.partner_name || p.customerName || p.customer_name || '').trim();
      jobs.set(soId, existing);
    }
  } catch (_) {
    /* ignore */
  }

  const extraId = Number(extraSaleOrderId);
  if (Number.isFinite(extraId) && extraId > 0 && !jobs.has(extraId)) {
    jobs.set(extraId, { soId: extraId, customerName: '', orderName: '' });
  }

  const out = [...jobs.values()];
  await Promise.all(
    out.map(async (job) => {
      if (job.customerName && job.orderName) return;
      const looked = await lookupSaleOrderJob(job.soId);
      if (!looked) return;
      job.customerName = job.customerName || looked.customerName;
      job.orderName = job.orderName || looked.orderName;
    })
  );
  return out;
}

function applyNativePayload(copy) {
  return {
    title: copy.title,
    text: copy.text,
    lines: Array.isArray(copy.lines) ? copy.lines : [],
    max: Math.max(1, Number(copy.max) || 1),
    current: Math.max(0, Number(copy.current) || 0),
    indeterminate: copy.indeterminate === true,
  };
}

export async function startBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable()) return false;
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
  }
  void ensureNotificationPermission();
  const extraSoId = options.saleOrderId;
  const jobs =
    Array.isArray(options.jobs) && options.jobs.length > 0
      ? options.jobs
      : await loadBackOfficeOrderSyncJobs(extraSoId);
  if (jobs.length === 0 && extraSoId == null && options.allowEmpty !== true) {
    return false;
  }
  const remaining = Math.max(jobs.length, Number(options.remaining) || 0, extraSoId != null ? 1 : 0);
  if (remaining <= 0) return false;
  _sessionTotal = Math.max(_sessionTotal, remaining, Number(options.total) || 0);
  _active = true;
  _completed = false;
  _startedOnDayKey = localDayKey();
  armMidnightDismiss();
  const copy = buildCopy(jobs, remaining, _sessionTotal);
  callNative('start', applyNativePayload(copy));
  return true;
}

export function updateBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable() || !_active || _completed) return;
  const jobs = Array.isArray(options.jobs) ? options.jobs : [];
  const remaining = Math.max(jobs.length, Number(options.remaining) || 0);
  if (remaining > _sessionTotal) _sessionTotal = remaining;
  if (remaining <= 0) {
    completeBackgroundOrderSyncNotification();
    return;
  }
  const copy = buildCopy(jobs, remaining, _sessionTotal);
  callNative('update', applyNativePayload(copy));
}

export function completeBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable()) return;
  if (!_active && !_completed) return;
  _completed = true;
  _active = false;
  clearMidnightTimer();
  const copy = buildCopy([], 0, Math.max(1, _sessionTotal));
  callNative('complete', {
    ...applyNativePayload({
      ...copy,
      title: options.title || copy.title,
      text: options.text || copy.text,
    }),
  });
  _sessionTotal = 0;
  _startedOnDayKey = '';
}

export function stopBackgroundOrderSyncNotification() {
  _active = false;
  _completed = false;
  _sessionTotal = 0;
  _startedOnDayKey = '';
  clearMidnightTimer();
  callNative('stop');
}

/**
 * Keep the existing tray alive while a real back-office order upload is running.
 * Does not start a tray just because leftover inventory/odometer rows exist.
 */
export async function ensureBackgroundOrderSyncKeepAlive(remainingHint, options = {}) {
  if (!nativeAvailable()) return;
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const jobs = await loadBackOfficeOrderSyncJobs(options.saleOrderId);
  const remaining = jobs.length > 0 ? jobs.length : Number(remainingHint);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    if (_active && !_completed) completeBackgroundOrderSyncNotification();
    return;
  }
  if (_active && !_completed) {
    updateBackgroundOrderSyncNotification({ jobs, remaining });
    return;
  }
  if (options.allowStart === false) return;
  await startBackgroundOrderSyncNotification({ jobs, remaining, saleOrderId: options.saleOrderId });
}

/** Update an already-visible tray; start only when allowStart and real BO order jobs exist. */
export async function refreshBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable()) return;
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const jobs = await loadBackOfficeOrderSyncJobs(options.saleOrderId);
  const remaining = jobs.length;
  if (remaining <= 0) {
    if (_active && !_completed) completeBackgroundOrderSyncNotification();
    return;
  }
  if (_active && !_completed) {
    updateBackgroundOrderSyncNotification({ jobs, remaining });
    return;
  }
  if (options.allowStart === true) {
    await startBackgroundOrderSyncNotification({ jobs, remaining, saleOrderId: options.saleOrderId });
  }
}

/** Hide leftover tray when the user is in the app and nothing is uploading to the back office. */
export async function hideBackgroundOrderSyncNotificationIfIdle(isUploadRunning) {
  if (!nativeAvailable()) return;
  if (isUploadRunning === true) {
    await refreshBackgroundOrderSyncNotification({ allowStart: false });
    return;
  }
  if (_active || _completed) {
    stopBackgroundOrderSyncNotification();
  }
}

/** @deprecated Use refreshBackgroundOrderSyncNotification — kept for older call sites. */
export function syncBackgroundOrderSyncNotificationWithPending(remainingRaw) {
  const remaining = Math.max(0, Number(remainingRaw) || 0);
  if (remaining <= 0) {
    if (_active && !_completed) completeBackgroundOrderSyncNotification();
    return;
  }
  void refreshBackgroundOrderSyncNotification({ allowStart: false });
}

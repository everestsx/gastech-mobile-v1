/**
 * Android OS progress notification + foreground service keep-alive for order upload.
 * Shows only while completed orders are actually being sent to the back office.
 * Does not enqueue, retry, or mutate delivery/payment data.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import i18n from '../i18n';
import { formatLocalYyyyMmDd, localDateKeyFromTimestamp } from '../utils/localDate.js';

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
  return formatLocalYyyyMmDd(date instanceof Date ? date : new Date());
}

function jobDeliveredOnLocalDay(job, dayKey) {
  const created = localDateKeyFromTimestamp(job?.queueCreatedAt);
  if (created) return created === dayKey;
  const orderDay =
    localDateKeyFromTimestamp(job?.commitmentDate) || localDateKeyFromTimestamp(job?.dateOrder);
  return orderDay === dayKey;
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
  return t('sync.notifyCustomerFallback', 'Customer');
}

function buildCopy(jobs, remaining) {
  const list = Array.isArray(jobs) ? jobs : [];
  const left = Math.max(0, Number(remaining) || list.length || 0);
  const names = list.map((job) => customerLabel(job)).filter(Boolean);

  if (left <= 0) {
    return {
      title: names[0] || t('sync.notifyCustomerFallback', 'Customer'),
      text: t('sync.notifyUploadingBody', 'Uploading to the back office'),
      lines: [],
      max: 1,
      current: 0,
      indeterminate: true,
    };
  }

  if (list.length <= 1) {
    return {
      title: names[0] || t('sync.notifyCustomerFallback', 'Customer'),
      text: t('sync.notifyUploadingBody', 'Uploading to the back office'),
      lines: [],
      max: 1,
      current: 0,
      indeterminate: true,
    };
  }

  return {
    title: names[0] || t('sync.notifyCustomerFallback', 'Customer'),
    text: t('sync.notifyUploadingBody', 'Uploading to the back office'),
    lines: names.slice(0, 7),
    max: 1,
    current: 0,
    indeterminate: true,
  };
}

function isOnlineForOrderSyncNotification() {
  try {
    const { isUploadSyncNetworkAvailable } = require('./networkStatus.service.js');
    return isUploadSyncNetworkAvailable() !== false;
  } catch (_) {
    return true;
  }
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
      dateOrder: so.date_order,
      commitmentDate: so.commitment_date,
      vehicleId: Number(Array.isArray(so.vehicle_id) ? so.vehicle_id[0] : so.vehicle_id) || null,
    };
  } catch (_) {
    return { soId, customerName: '', orderName: '' };
  }
}

/** Completed orders whose delivery/payment still needs to reach the back office. */
export async function loadBackOfficeOrderSyncJobs(extraSaleOrderId, options = {}) {
  const jobs = new Map();
  const todayKey = localDayKey();
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
      existing.queueCreatedAt = existing.queueCreatedAt || row.created_at;
      existing.paymentDate = existing.paymentDate || p.paymentDate;
      existing.commitmentDate = existing.commitmentDate || p.commitmentDateRaw || p.commitment_date;
      existing.dateOrder = existing.dateOrder || p.dateOrder || p.date_order;
      existing.vehicleId =
        existing.vehicleId || syncQueueDb.vehicleIdFromQueuePayload(p);
      jobs.set(soId, existing);
    }
  } catch (_) {
    /* ignore */
  }

  const extraId = Number(extraSaleOrderId);
  if (
    options.keepAliveIfEmpty === true &&
    Number.isFinite(extraId) &&
    extraId > 0 &&
    !jobs.has(extraId) &&
    jobs.size === 0
  ) {
    jobs.set(extraId, {
      soId: extraId,
      customerName: '',
      orderName: '',
      queueCreatedAt: new Date().toISOString(),
    });
  }

  let out = [...jobs.values()];
  await Promise.all(
    out.map(async (job) => {
      if (job.customerName && job.orderName && job.dateOrder && job.commitmentDate && job.vehicleId) return;
      const looked = await lookupSaleOrderJob(job.soId);
      if (!looked) return;
      job.customerName = job.customerName || looked.customerName;
      job.orderName = job.orderName || looked.orderName;
      job.dateOrder = job.dateOrder || looked.dateOrder;
      job.commitmentDate = job.commitmentDate || looked.commitmentDate;
      job.vehicleId = job.vehicleId || looked.vehicleId;
    })
  );
  // Display only: older pending rows stay in sync_queue and still upload in background.
  out = out.filter((job) => jobDeliveredOnLocalDay(job, todayKey));
  try {
    const { getUserSession } = await import('./sync.service.js');
    const session = await getUserSession().catch(() => null);
    if (session && session.isAdmin !== true) {
      const vid = Number(session.vehicleId);
      if (Number.isFinite(vid) && vid > 0) {
        out = out.filter(
          (job) => Number(job.soId) === extraId || Number(job.vehicleId) === vid
        );
      }
    }
  } catch (_) {
    /* keep today's jobs if session read fails */
  }
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
  if (!isOnlineForOrderSyncNotification()) {
    stopBackgroundOrderSyncNotification();
    return false;
  }
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
  }
  // Already showing — do not native-start again per order (resets remaining to 1
  // and can re-prompt POST_NOTIFICATIONS). Hydrate the full job list instead.
  if (_active && !_completed) {
    void hydrateBackgroundOrderSyncNotification(options);
    return true;
  }
  void ensureNotificationPermission();
  const extraSoId = options.saleOrderId;
  const hintName = String(options.customerName || '').trim();
  const hintJobs =
    Array.isArray(options.jobs) && options.jobs.length > 0
      ? options.jobs
      : extraSoId != null
        ? [{ soId: Number(extraSoId), customerName: hintName }]
        : [];
  const remaining = Math.max(
    hintJobs.length,
    Number(options.remaining) || 0,
    extraSoId != null ? 1 : 0,
    hintJobs.length > 0 ? 1 : 0
  );
  if (remaining <= 0 && options.allowEmpty !== true) {
    stopBackgroundOrderSyncNotification();
    return false;
  }
  _sessionTotal = Math.max(_sessionTotal, remaining, Number(options.total) || 0, 1);
  _active = true;
  _completed = false;
  _startedOnDayKey = localDayKey();
  armMidnightDismiss();
  callNative('start', applyNativePayload(buildCopy(hintJobs, Math.max(1, remaining))));
  void hydrateBackgroundOrderSyncNotification(options);
  return true;
}

async function hydrateBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable() || !_active || _completed) return;
  try {
    const jobs = await loadBackOfficeOrderSyncJobs(options.saleOrderId, {
      keepAliveIfEmpty: options.allowEmpty === true,
    });
    if (!nativeAvailable() || !_active || _completed) return;
    if (jobs.length === 0) return;
    updateBackgroundOrderSyncNotification({ jobs, remaining: jobs.length });
  } catch (_) {
    /* keep the instant tray */
  }
}

export function updateBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable() || !_active || _completed) return;
  if (!isOnlineForOrderSyncNotification()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const jobs = Array.isArray(options.jobs) ? options.jobs : [];
  const remaining = Math.max(jobs.length, Number(options.remaining) || 0);
  if (remaining > _sessionTotal) _sessionTotal = remaining;
  if (remaining <= 0) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const copy = buildCopy(jobs, remaining);
  callNative('update', applyNativePayload(copy));
}

export function completeBackgroundOrderSyncNotification() {
  stopBackgroundOrderSyncNotification();
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
  if (!isOnlineForOrderSyncNotification()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const jobs = await loadBackOfficeOrderSyncJobs(options.saleOrderId);
  const remaining = jobs.length > 0 ? jobs.length : Number(remainingHint);
  if (remaining <= 0) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  if (_active && !_completed && options.forceStart !== true) {
    updateBackgroundOrderSyncNotification({ jobs, remaining });
    return;
  }
  if (options.allowStart === false) return;
  await startBackgroundOrderSyncNotification({ jobs, remaining, saleOrderId: options.saleOrderId });
}

/**
 * Offline dismisses the OS tray. Call this as soon as the radio is back so the
 * notification returns without waiting for the user to leave and reopen the app.
 */
export async function restoreBackgroundOrderSyncNotificationAfterOnline(saleOrderId) {
  if (!nativeAvailable()) return;
  if (!isOnlineForOrderSyncNotification()) return;
  await ensureBackgroundOrderSyncKeepAlive(undefined, {
    allowStart: true,
    forceStart: true,
    saleOrderId,
  });
}

/** Update an already-visible tray; start only when allowStart and real BO order jobs exist. */
export async function refreshBackgroundOrderSyncNotification(options = {}) {
  if (!nativeAvailable()) return;
  if (!isOnlineForOrderSyncNotification()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  if (_startedOnDayKey && _startedOnDayKey !== localDayKey()) {
    stopBackgroundOrderSyncNotification();
    return;
  }
  const jobs = await loadBackOfficeOrderSyncJobs(options.saleOrderId);
  const remaining = jobs.length;
  if (remaining <= 0) {
    stopBackgroundOrderSyncNotification();
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
    await refreshBackgroundOrderSyncNotification({ allowStart: true });
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
    stopBackgroundOrderSyncNotification();
    return;
  }
  void refreshBackgroundOrderSyncNotification({ allowStart: false });
}

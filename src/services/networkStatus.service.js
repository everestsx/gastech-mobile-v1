/**
 * NetInfo wrapper — quality classification + stable-online flush trigger (does not change sync RPC logic).
 */
import NetInfo from '@react-native-community/netinfo';
import {
  PENDING_QUEUE_ACTIVE_RETRY_MS,
  PENDING_QUEUE_FAST_RETRY_MS,
  PENDING_QUEUE_BACKGROUND_RETRY_MS,
} from './sync.service.js';

export const NetworkQuality = {
  GOOD: 'good',
  WEAK: 'weak',
  OFFLINE: 'offline',
};

let lastQuality = NetworkQuality.OFFLINE;
let lastConnected = false;
let lastFlushAt = 0;
let hasObservedNetworkState = false;
const STABLE_FLUSH_COOLDOWN_MS = 400;

try {
  // Native radio events are fast. The default HTTP reachability probe (15–60s) was
  // delaying "we're online" by ~40s on many Android devices after airplane-mode off.
  NetInfo.configure({
    reachabilityShouldRun: false,
    reachabilityLongTimeout: 4000,
    reachabilityShortTimeout: 1000,
    reachabilityRequestTimeout: 2500,
  });
} catch (_) {
  /* older netinfo builds may not expose configure */
}

function classify(state) {
  if (!state) return NetworkQuality.OFFLINE;
  if (state.isConnected === false) return NetworkQuality.OFFLINE;

  const details = state.details && typeof state.details === 'object' ? state.details : {};
  const downlinkMbps = Number(details.downlink);
  const effectiveType = String(details.effectiveType || '').toLowerCase();
  const isWifi = state.type === 'wifi' || state.type === 'ethernet';

  // Many OEM Androids report isInternetReachable=false while the radio is up.
  // Treating that as OFFLINE blocked uploads on those phones only.
  if (state.isInternetReachable === false) {
    return isWifi ? NetworkQuality.GOOD : NetworkQuality.WEAK;
  }

  if (state.isInternetReachable === true) {
    if (Number.isFinite(downlinkMbps)) {
      if (downlinkMbps >= 1.2) return NetworkQuality.GOOD;
      if (downlinkMbps > 0) return NetworkQuality.WEAK;
    }
    if (effectiveType === '4g' || effectiveType === '5g') return NetworkQuality.GOOD;
    if (effectiveType === '3g' || effectiveType === '2g' || effectiveType === 'slow-2g') {
      return NetworkQuality.WEAK;
    }
    if (isWifi) return NetworkQuality.GOOD;
    if (state.type === 'cellular') return NetworkQuality.WEAK;
    return NetworkQuality.GOOD;
  }

  if (state.isConnected === true) {
    return isWifi ? NetworkQuality.GOOD : NetworkQuality.WEAK;
  }

  return NetworkQuality.OFFLINE;
}

function perfNet(event) {
  try {
    console.log(`[SyncPerf] ${event}`);
  } catch (_) {
    /* ignore */
  }
}

export function getLastNetworkQuality() {
  return lastQuality;
}

/** Background queue upload + dashboard upload spinner — only when not fully offline. */
export function isUploadSyncNetworkAvailable() {
  if (!hasObservedNetworkState) return true;
  return lastQuality !== NetworkQuality.OFFLINE;
}

export async function fetchNetworkSnapshot() {
  const state = await NetInfo.fetch();
  const quality = classify(state);
  return {
    quality,
    isConnected: !!state?.isConnected,
    isInternetReachable: state?.isInternetReachable ?? null,
    type: state?.type ?? 'unknown',
    details: state?.details ?? null,
    state,
  };
}

async function flushQueueOnStableConnection(reason = 'online') {
  const now = Date.now();
  if (now - lastFlushAt < STABLE_FLUSH_COOLDOWN_MS) return;
  try {
    const m = await import('./sync.service.js');
    const shouldRun =
      typeof m.shouldRunPendingUploadRetryLoop === 'function'
        ? await m.shouldRunPendingUploadRetryLoop()
        : await m.hasActionablePendingUploadWork();
    if (!shouldRun) return;
    lastFlushAt = now;
    perfNet(`flush-trigger reason=${reason} quality=${lastQuality}`);
    m.wakePendingUploadSyncNow({ queuePasses: 8, includeAttachments: true, chainRetry: false });
  } catch (_) {
    /* non-fatal */
  }
}

function applyNetworkState(state, listener) {
  const quality = classify(state);
  const connected = !!state?.isConnected;
  const prev = lastQuality;
  const wasConnected = lastConnected;
  hasObservedNetworkState = true;
  lastQuality = quality;
  lastConnected = connected;
  if (typeof listener === 'function') {
    listener({
      quality,
      isConnected: connected,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? 'unknown',
      details: state?.details ?? null,
    });
  }
  const cameOnline = (!wasConnected && connected) || (prev === NetworkQuality.OFFLINE && quality !== NetworkQuality.OFFLINE);
  const becameGood = quality === NetworkQuality.GOOD && prev !== NetworkQuality.GOOD;
  if (cameOnline || becameGood) {
    if (cameOnline) perfNet(`online ${prev}→${quality} type=${state?.type || 'unknown'}`);
    void flushQueueOnStableConnection(cameOnline ? 'came-online' : 'became-good');
  }
}

/**
 * Re-read native connectivity when the listener may have missed a radio change.
 * Used by the pending-upload poll while still classified OFFLINE.
 */
export async function probeNetworkAndFlushIfOnline() {
  try {
    const state = await NetInfo.fetch();
    applyNetworkState(state, null);
    return {
      quality: lastQuality,
      isConnected: lastConnected,
    };
  } catch (_) {
    return { quality: lastQuality, isConnected: lastConnected };
  }
}

/**
 * @param {(snap: { quality: string, isConnected: boolean, isInternetReachable: boolean|null, type: string }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeNetworkStatus(listener) {
  if (typeof listener !== 'function') return () => {};

  const onState = (state) => applyNetworkState(state, listener);
  const unsub = NetInfo.addEventListener(onState);
  void NetInfo.fetch().then(onState);
  return () => unsub();
}

/** Poll interval hint for AppNavigator fast-pending loop from connection quality. */
export function getPendingRetryDelayMsForQuality(quality) {
  if (quality === NetworkQuality.GOOD) return PENDING_QUEUE_ACTIVE_RETRY_MS;
  if (quality === NetworkQuality.WEAK) return Math.max(PENDING_QUEUE_FAST_RETRY_MS, 1000);
  return 1000;
}

/** Poll interval for pending-upload loop (foreground vs background / screen off). */
export function getPendingRetryDelayMsForAppState(appState, quality) {
  const base = getPendingRetryDelayMsForQuality(quality);
  if (appState === 'active') return base;
  return Math.min(3000, Math.max(PENDING_QUEUE_BACKGROUND_RETRY_MS, base));
}

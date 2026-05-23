/**
 * NetInfo wrapper — quality classification + stable-online flush trigger (does not change sync RPC logic).
 */
import NetInfo from '@react-native-community/netinfo';
import { PENDING_QUEUE_ACTIVE_RETRY_MS, PENDING_QUEUE_FAST_RETRY_MS } from './sync.service.js';

export const NetworkQuality = {
  GOOD: 'good',
  WEAK: 'weak',
  OFFLINE: 'offline',
};

let lastQuality = NetworkQuality.OFFLINE;
let lastFlushAt = 0;
const STABLE_FLUSH_COOLDOWN_MS = 600;

function classify(state) {
  if (!state) return NetworkQuality.OFFLINE;
  if (state.isConnected === false) return NetworkQuality.OFFLINE;
  if (state.isInternetReachable === false) return NetworkQuality.OFFLINE;

  const details = state.details && typeof state.details === 'object' ? state.details : {};
  const downlinkMbps = Number(details.downlink);
  const effectiveType = String(details.effectiveType || '').toLowerCase();

  if (state.isInternetReachable === true) {
    if (Number.isFinite(downlinkMbps)) {
      if (downlinkMbps >= 1.2) return NetworkQuality.GOOD;
      if (downlinkMbps > 0) return NetworkQuality.WEAK;
    }
    if (effectiveType === '4g' || effectiveType === '5g') return NetworkQuality.GOOD;
    if (effectiveType === '3g' || effectiveType === '2g' || effectiveType === 'slow-2g') {
      return NetworkQuality.WEAK;
    }
    if (state.type === 'wifi' || state.type === 'ethernet') return NetworkQuality.GOOD;
    if (state.type === 'cellular') return NetworkQuality.WEAK;
    return NetworkQuality.GOOD;
  }

  if (state.isConnected === true && state.isInternetReachable == null) {
    if (state.type === 'wifi' || state.type === 'ethernet') return NetworkQuality.WEAK;
    return NetworkQuality.WEAK;
  }

  return NetworkQuality.OFFLINE;
}

export function getLastNetworkQuality() {
  return lastQuality;
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

async function flushQueueOnStableConnection() {
  const now = Date.now();
  if (now - lastFlushAt < STABLE_FLUSH_COOLDOWN_MS) return;
  try {
    const m = await import('./sync.service.js');
    if (!(await m.hasActionablePendingUploadWork())) return;
    lastFlushAt = now;
    m.schedulePendingUploadSync({
      immediate: true,
      aggressive: true,
      queuePasses: 24,
      includeAttachments: true,
    });
    m.ensurePendingUploadRetryLoop();
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * @param {(snap: { quality: string, isConnected: boolean, isInternetReachable: boolean|null, type: string }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeNetworkStatus(listener) {
  if (typeof listener !== 'function') return () => {};

  const onState = (state) => {
    const quality = classify(state);
    const prev = lastQuality;
    lastQuality = quality;
    listener({
      quality,
      isConnected: !!state?.isConnected,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? 'unknown',
      details: state?.details ?? null,
    });
    if (quality === NetworkQuality.GOOD && prev !== NetworkQuality.GOOD) {
      void flushQueueOnStableConnection();
    }
  };

  const unsub = NetInfo.addEventListener(onState);
  void NetInfo.fetch().then(onState);
  return () => unsub();
}

/** Poll interval hint for AppNavigator fast-pending loop from connection quality. */
export function getPendingRetryDelayMsForQuality(quality) {
  if (quality === NetworkQuality.GOOD) return PENDING_QUEUE_ACTIVE_RETRY_MS;
  if (quality === NetworkQuality.WEAK) return Math.max(PENDING_QUEUE_FAST_RETRY_MS, 3000);
  return 12000;
}

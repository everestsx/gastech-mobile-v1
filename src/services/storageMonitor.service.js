/**
 * Storage Management: measures Android AsyncStorage usage and keeps a history of real cleanup runs.
 *
 * Measurement — never opens or reads the AsyncStorage SQLite file (RKStorage) directly:
 * a second SQLite copy (expo-sqlite) or any open()/close() on that file in the same process can
 * drop the POSIX locks held by AsyncStorage's own connection and corrupt it. Instead:
 *  - dataBytes: exact UTF-8 size of every key + value, read through the AsyncStorage API.
 *  - fileBytes: RKStorage file size via stat (FileSystem.getInfoAsync, no file handle opened).
 *
 * History lives in gastech.db (app_cache), not AsyncStorage, so it can still be written when
 * AsyncStorage itself is full.
 */
import { Platform } from 'react-native';

/** @react-native-async-storage default (android/gradle.properties has no AsyncStorage_db_size_in_MB). */
export const ASYNC_STORAGE_LIMIT_BYTES = 6 * 1024 * 1024;
export const STORAGE_CLEANUP_HISTORY_MAX = 50;
const HISTORY_CACHE_KEY = 'storage_cleanup_history_v1';
const MULTIGET_CHUNK = 50;

export function utf8ByteLength(str) {
  if (str == null) return 0;
  const s = String(str);
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

async function getAsyncStorage() {
  return (await import('@react-native-async-storage/async-storage')).default;
}

/** RKStorage lives in <dataDir>/databases; expo-sqlite's default dir is <dataDir>/files/SQLite. */
async function readRkStorageFileBytes() {
  if (Platform.OS !== 'android') return null;
  try {
    const SQLite = await import('expo-sqlite');
    const base = String(SQLite.defaultDatabaseDirectory || '');
    const m = base.match(/^(.*)\/files\/SQLite\/?$/);
    if (!m) return null;
    const FileSystemLegacy = await import('expo-file-system/legacy');
    let total = 0;
    let found = false;
    for (const suffix of ['', '-wal', '-journal']) {
      const info = await FileSystemLegacy.getInfoAsync(`file://${m[1]}/databases/RKStorage${suffix}`);
      if (info?.exists && Number.isFinite(Number(info.size))) {
        total += Number(info.size);
        if (suffix === '') found = true;
      }
    }
    return found ? total : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ includeFile?: boolean }} [opts]
 * @returns {Promise<{ dataBytes:number, keyCount:number, unreadableKeys:string[], fileBytes:number|null,
 *   limitBytes:number, measuredAt:string }>}
 */
export async function measureAsyncStorageUsage({ includeFile = true } = {}) {
  const AsyncStorage = await getAsyncStorage();
  const keys = (await AsyncStorage.getAllKeys()) || [];
  let dataBytes = 0;
  const unreadableKeys = [];
  const add = (k, v) => {
    dataBytes += utf8ByteLength(k) + utf8ByteLength(v);
  };
  for (let i = 0; i < keys.length; i += MULTIGET_CHUNK) {
    const chunk = keys.slice(i, i + MULTIGET_CHUNK);
    try {
      const pairs = await AsyncStorage.multiGet(chunk);
      for (const [k, v] of pairs || []) add(k, v);
    } catch (_) {
      // A row > ~2 MB cannot be read on Android; find which one(s) per key.
      for (const k of chunk) {
        try {
          add(k, await AsyncStorage.getItem(k));
        } catch (_e) {
          unreadableKeys.push(k);
          dataBytes += utf8ByteLength(k);
        }
      }
    }
  }
  return {
    dataBytes,
    keyCount: keys.length,
    unreadableKeys,
    fileBytes: includeFile ? await readRkStorageFileBytes() : null,
    limitBytes: ASYNC_STORAGE_LIMIT_BYTES,
    measuredAt: new Date().toISOString(),
  };
}

let _historyChain = Promise.resolve();

/** Append one real cleanup result. Never throws (monitoring must not break cleanup). */
export function appendCleanupHistory(entry) {
  _historyChain = _historyChain
    .then(async () => {
      const { getAppCache, setAppCache } = await import('../database/appCache.js');
      const prev = await getAppCache(HISTORY_CACHE_KEY);
      const list = Array.isArray(prev) ? prev : [];
      const next = [{ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...entry }, ...list].slice(
        0,
        STORAGE_CLEANUP_HISTORY_MAX
      );
      await setAppCache(HISTORY_CACHE_KEY, next);
    })
    .catch((e) => {
      console.warn('[storageMonitor] history append failed', e?.message ?? e);
    });
  return _historyChain;
}

export async function getCleanupHistory() {
  try {
    const { getAppCache } = await import('../database/appCache.js');
    const list = await getAppCache(HISTORY_CACHE_KEY);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

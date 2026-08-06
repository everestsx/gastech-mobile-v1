import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, ROOT_FOLDER_ID } from '@env';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Google Drive payment proof upload service.
 *
 * SETUP REQUIRED — add these to your local .env (never commit real values):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, ROOT_FOLDER_ID
 *
 *  Step 1: Go to https://console.cloud.google.com
 *          Create/select a project → APIs & Services → Enable "Google Drive API"
 *
 *  Step 2: APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
 *          Application type: "Desktop app"  →  Copy the Client ID and Client Secret.
 *
 *  Step 3: Get a refresh token (one-time):
 *          a) Open https://developers.google.com/oauthplayground
 *          b) Click the gear icon (top-right) → check "Use your own OAuth credentials"
 *             → paste your Client ID & Client Secret
 *          c) Under "Select & authorize APIs" choose:
 *             "Drive API v3"  →  https://www.googleapis.com/auth/drive.file
 *          d) Click "Authorize APIs" and sign in with the Google account
 *             that OWNS the "Gas Tech Payment Proof" Drive folder.
 *          e) Click "Exchange authorization code for tokens"
 *          f) Copy the "Refresh token" value into .env
 *
 *  Step 4: Make sure the "Gas Tech Payment Proof" Drive folder is owned by
 *          (or shared with full access to) the Google account used in Step 3.
 */

// ─────────────────────────────────────────────────────────────
// Internal caches (reset on app restart — that's fine)
// ─────────────────────────────────────────────────────────────
let _cachedToken = null;
let _tokenExpiresAt = 0;
/** Map of "parentId::folderName" → folderId to avoid duplicate Drive API calls */
const _folderCache = new Map();
let _folderCacheLoaded = false;
let _folderCacheLoadPromise = null;
let _folderCacheSaveTimer = null;

const DRIVE_FOLDER_CACHE_KEY = '@gastech_drive_folder_cache_v1';
const DRIVE_TIMEOUT_SHORT_MS = 25_000;
const DRIVE_TIMEOUT_UPLOAD_MS = 120_000;
const DRIVE_MAX_RETRIES = 3;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isConfigured() {
  return (
    GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE' &&
    GOOGLE_CLIENT_SECRET !== 'YOUR_GOOGLE_CLIENT_SECRET_HERE' &&
    GOOGLE_REFRESH_TOKEN !== 'YOUR_GOOGLE_REFRESH_TOKEN_HERE'
  );
}

/** Replace characters that are unsafe in Drive filenames or folder names. */
function sanitize(str, maxLen = 30) {
  return String(str || '')
    .trim()
    .replace(/[^\w\s.()\-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, maxLen) || 'Unknown';
}

/** Escape a string for use inside Google Drive API `q` query literals. */
function escapeDriveQueryLiteral(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Folder names for year → month → day hierarchy (local device date).
 * Year:  "2026"
 * Month: "July"
 * Day:   "Day 04 - Fri"
 */
function buildDriveFolderNames(date = new Date()) {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const monthName = MONTH_NAMES[monthIndex];
  const yearFolderName = String(year);
  const monthFolderName = monthName;
  const dayPadded = String(day).padStart(2, '0');
  const weekday = WEEKDAY_SHORT[date.getDay()] || '';
  const dayFolderName = weekday ? `Day ${dayPadded} - ${weekday}` : `Day ${dayPadded}`;
  const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${dayPadded}`;
  return { yearFolderName, monthFolderName, dayFolderName, dateStr };
}

function shouldRetryStatus(status) {
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

function toBackoffMs(attempt) {
  if (attempt <= 0) return 1_000;
  if (attempt === 1) return 2_000;
  return 4_000;
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DRIVE_TIMEOUT_SHORT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Drive request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, { timeoutMs = DRIVE_TIMEOUT_SHORT_MS, maxRetries = DRIVE_MAX_RETRIES } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.ok) return res;
      if (!shouldRetryStatus(res.status) || attempt === maxRetries - 1) return res;
      const body = await res.text().catch(() => '');
      lastErr = new Error(`Drive HTTP ${res.status}${body ? `: ${body}` : ''}`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries - 1) throw err;
    }
    await sleep(toBackoffMs(attempt));
  }
  if (lastErr) throw lastErr;
  throw new Error('Drive request failed');
}

async function ensureFolderCacheLoaded() {
  if (_folderCacheLoaded) return;
  if (_folderCacheLoadPromise) {
    await _folderCacheLoadPromise;
    return;
  }
  _folderCacheLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(DRIVE_FOLDER_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof k === 'string' && typeof v === 'string' && k && v) {
              _folderCache.set(k, v);
            }
          }
        }
      }
    } catch (_) {
      // Ignore cache hydration failures.
    } finally {
      _folderCacheLoaded = true;
      _folderCacheLoadPromise = null;
    }
  })();
  await _folderCacheLoadPromise;
}

function schedulePersistFolderCache() {
  if (_folderCacheSaveTimer) clearTimeout(_folderCacheSaveTimer);
  _folderCacheSaveTimer = setTimeout(() => {
    _folderCacheSaveTimer = null;
    const obj = {};
    for (const [k, v] of _folderCache.entries()) {
      obj[k] = v;
    }
    AsyncStorage.setItem(DRIVE_FOLDER_CACHE_KEY, JSON.stringify(obj)).catch(() => {
      // Ignore cache save failures.
    });
  }, 400);
}

// ─────────────────────────────────────────────────────────────
// OAuth 2.0 — token refresh
// ─────────────────────────────────────────────────────────────

async function getAccessToken() {
  // Return cached token if still valid (with 60 s buffer)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: [
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
      `client_secret=${encodeURIComponent(GOOGLE_CLIENT_SECRET)}`,
      `refresh_token=${encodeURIComponent(GOOGLE_REFRESH_TOKEN)}`,
      'grant_type=refresh_token',
    ].join('&'),
  }, DRIVE_TIMEOUT_SHORT_MS);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in Drive token response');

  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

// ─────────────────────────────────────────────────────────────
// Drive folder management
// ─────────────────────────────────────────────────────────────

async function findFolder(name, parentId, token) {
  const safeN = escapeDriveQueryLiteral(name);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safeN}' and '${parentId}' in parents and trashed=false`;
  const res = await fetchWithRetry(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
    { timeoutMs: DRIVE_TIMEOUT_SHORT_MS, maxRetries: DRIVE_MAX_RETRIES }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name, parentId, token) {
  const res = await fetchWithRetry(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    },
    { timeoutMs: DRIVE_TIMEOUT_SHORT_MS, maxRetries: DRIVE_MAX_RETRIES }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive createFolder failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.id) throw new Error('No id in Drive createFolder response');
  return data.id;
}

/** Find existing folder or create it; results are cached in-memory. */
async function getOrCreateFolder(name, parentId, token) {
  await ensureFolderCacheLoaded();
  const key = `${parentId}::${name}`;
  if (_folderCache.has(key)) return _folderCache.get(key);
  const existing = await findFolder(name, parentId, token);
  const id = existing ?? (await createFolder(name, parentId, token));
  _folderCache.set(key, id);
  schedulePersistFolderCache();
  return id;
}

// ─────────────────────────────────────────────────────────────
// Drive file upload  (multipart/related with base64 media part)
// ─────────────────────────────────────────────────────────────

/** Byte size of a local file, or null when it cannot be determined. */
async function getLocalFileSize(fileUri) {
  try {
    const FileSystem = await import('expo-file-system');
    const file = new FileSystem.File(fileUri);
    const size = Number(file?.size);
    return Number.isFinite(size) && size > 0 ? size : null;
  } catch (_) {
    return null;
  }
}

/**
 * Open a resumable upload session and return its URI.
 * Google keeps a session URI valid for about a week, so the same URI is reused by
 * every retry below instead of restarting the upload from scratch.
 */
async function startResumableSession(mimeType, fileName, parentFolderId, token, fileSize) {
  const metadata = JSON.stringify({ name: fileName, parents: [parentFolderId] });
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  };
  if (fileSize) headers['X-Upload-Content-Length'] = String(fileSize);

  const res = await fetchWithRetry(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name',
    { method: 'POST', headers, body: metadata },
    { timeoutMs: DRIVE_TIMEOUT_SHORT_MS, maxRetries: DRIVE_MAX_RETRIES }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive resumable session failed (${res.status}): ${text}`);
  }
  const sessionUri = res.headers?.get?.('location') || res.headers?.get?.('Location');
  if (!sessionUri) throw new Error('Drive resumable session returned no Location header');
  return sessionUri;
}

/**
 * Ask Drive how much of the file already landed.
 * Returns { done, fileId, received } — `done` when Drive reports the upload complete.
 */
async function queryResumableStatus(sessionUri, fileSize) {
  const res = await fetchWithRetry(
    sessionUri,
    {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${fileSize || '*'}` },
    },
    { timeoutMs: DRIVE_TIMEOUT_SHORT_MS, maxRetries: 1 }
  );
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return { done: true, fileId: data?.id ?? null, received: fileSize || 0 };
  }
  if (res.status === 308) {
    const range = res.headers?.get?.('range') || res.headers?.get?.('Range') || '';
    const match = /bytes=0-(\d+)/i.exec(range);
    return { done: false, fileId: null, received: match ? Number(match[1]) + 1 : 0 };
  }
  const text = await res.text().catch(() => '');
  throw new Error(`Drive resumable status failed (${res.status}): ${text}`);
}

/**
 * Stream the file straight from disk into a resumable session.
 *
 * uploadAsync sends raw bytes, which avoids the base64 round trip the multipart
 * upload needed (~33% more bytes on the wire plus several full-size copies of the
 * image in the JS heap). It has no abort option, so the wait is bounded by a race —
 * on timeout we fall through to the status query, which tells us whether the bytes
 * actually arrived before deciding to resend.
 */
async function putFileToSession(sessionUri, fileUri, mimeType, fileSize) {
  const FileSystemLegacy = await import('expo-file-system/legacy');
  const headers = { 'Content-Type': mimeType };
  if (fileSize) headers['Content-Range'] = `bytes 0-${fileSize - 1}/${fileSize}`;

  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Drive upload timed out after ${DRIVE_TIMEOUT_UPLOAD_MS}ms`)),
      DRIVE_TIMEOUT_UPLOAD_MS
    );
  });
  const uploadPromise = FileSystemLegacy.uploadAsync(sessionUri, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  // When the timeout wins the race this promise still settles later; swallow its
  // rejection so it never surfaces as an unhandled rejection.
  uploadPromise.catch(() => {});
  try {
    const result = await Promise.race([uploadPromise, timeout]);
    const status = Number(result?.status ?? 0);
    if (status >= 200 && status < 300) {
      try {
        const data = JSON.parse(result?.body || '{}');
        return data?.id ?? null;
      } catch (_) {
        return null;
      }
    }
    throw new Error(`Drive upload failed (${status}): ${String(result?.body || '').slice(0, 200)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function uploadFileResumable(fileUri, mimeType, fileName, parentFolderId, token) {
  const fileSize = await getLocalFileSize(fileUri);
  const sessionUri = await startResumableSession(mimeType, fileName, parentFolderId, token, fileSize);

  let lastErr = null;
  for (let attempt = 0; attempt < DRIVE_MAX_RETRIES; attempt += 1) {
    try {
      const fileId = await putFileToSession(sessionUri, fileUri, mimeType, fileSize);
      if (fileId) return fileId;
      // 2xx without a parsable id — confirm through the session before giving up.
      const status = await queryResumableStatus(sessionUri, fileSize);
      if (status.done) return status.fileId;
      lastErr = new Error('Drive upload returned no file id');
    } catch (err) {
      lastErr = err;
      // The bytes may have landed even though we stopped waiting; only resend if not.
      try {
        const status = await queryResumableStatus(sessionUri, fileSize);
        if (status.done) return status.fileId;
      } catch (_) {
        /* fall through to retry */
      }
    }
    if (attempt < DRIVE_MAX_RETRIES - 1) await sleep(toBackoffMs(attempt));
  }
  throw lastErr || new Error('Drive upload failed');
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Upload a payment proof photo to the "Gas Tech Payment Proof" Google Drive folder.
 *
 * Folder structure created automatically:
 *   Gas Tech Payment Proof/
 *     └── {Year}                          e.g.  "2026"
 *         └── {Month}                     e.g.  "July"
 *             └── Day {DD} - {Weekday}    e.g.  "Day 04 - Fri"
 *                 └── {Vehicle}_{Driver}  e.g.  "ABC123_John_Doe"
 *                     └── {OrderId}_{Customer}  e.g.  "S00042_Acme_Corp"
 *                         └── filename.jpg      e.g.  "payment_proof_2026-07-04_1.jpg"
 *
 * Note: only **new** uploads after this update use this layout. Older files stay in previous folders.
 *
 * @param {string} fileUri     Local file URI/path of the image to upload (streamed from disk)
 * @param {string} mimeType    'image/jpeg' | 'image/png'
 * @param {object} meta
 * @param {string} [meta.orderName]    Sale order name, e.g. "S00042"
 * @param {number} [meta.saleOrderId]  Sale order ID for folder organization
 * @param {string} [meta.customerName] Customer/company name for folder organization
 * @param {string} [meta.driverName]   Driver's full name
 * @param {string} [meta.licensePlate] Vehicle license plate / number
 * @param {number} [meta.photoIndex]   1-based index when multiple photos per order
 * @returns {Promise<string|null>} Google Drive file ID, or null on any failure
 */
export async function uploadPaymentProofToDrive(fileUri, mimeType, meta = {}) {
  if (!isConfigured()) {
    console.warn('[GoogleDrive] Credentials not configured — skipping Drive upload. See src/services/googleDrive.service.js for setup instructions.');
    return null;
  }

  if (!fileUri || typeof fileUri !== 'string') {
    console.warn('[GoogleDrive] no file URI supplied — skipping upload');
    return null;
  }

  try {
    const token = await getAccessToken();

    const { yearFolderName, monthFolderName, dayFolderName, dateStr } = buildDriveFolderNames(new Date());

    // ── Sub-folder: "ABC123_John_Doe"
    const vehiclePart = sanitize(meta.licensePlate || 'Vehicle', 20);
    const driverPart = sanitize(meta.driverName || 'Driver', 25);
    const vehicleDriverFolderName = `${vehiclePart}_${driverPart}`;

    // ── Sub-sub-folder: "S00042_Acme_Corp"
    const orderPart = sanitize(meta.orderName || `Order_${meta.saleOrderId || 'Unknown'}`, 15);
    const customerPart = sanitize(meta.customerName || 'Customer', 30);
    const saleOrderFolderName = `${orderPart}_${customerPart}`;

    const yearFolderId = await getOrCreateFolder(yearFolderName, ROOT_FOLDER_ID, token);
    const monthFolderId = await getOrCreateFolder(monthFolderName, yearFolderId, token);
    const dayFolderId = await getOrCreateFolder(dayFolderName, monthFolderId, token);
    const vehicleFolderId = await getOrCreateFolder(vehicleDriverFolderName, dayFolderId, token);
    const saleOrderFolderId = await getOrCreateFolder(saleOrderFolderName, vehicleFolderId, token);

    console.log(
      `[GoogleDrive] Folder path: ${yearFolderName} / ${monthFolderName} / ${dayFolderName} / ${vehicleDriverFolderName} / ${saleOrderFolderName}`
    );

    // ── Filename (date in filename for search/sort)
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const idx = Number.isFinite(meta.photoIndex) && meta.photoIndex > 0 ? meta.photoIndex : 1;
    const fileName = `payment_proof_${dateStr}_${idx}.${ext}`;

    const fileId = await uploadFileResumable(fileUri, mimeType, fileName, saleOrderFolderId, token);
    console.log(
      `[GoogleDrive] Uploaded: ${yearFolderName}/${monthFolderName}/${dayFolderName}/${saleOrderFolderName}/${fileName} → id:${fileId}`
    );
    return fileId;
  } catch (err) {
    console.warn('[GoogleDrive] Upload failed (non-blocking):', err?.message || err);
    return null;
  }
}

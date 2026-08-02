import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  ROOT_FOLDER_ID,
} from '@env';

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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isConfigured() {
  return (
    Boolean(GOOGLE_CLIENT_ID) &&
    Boolean(GOOGLE_CLIENT_SECRET) &&
    Boolean(GOOGLE_REFRESH_TOKEN) &&
    Boolean(ROOT_FOLDER_ID) &&
    GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE' &&
    GOOGLE_CLIENT_SECRET !== 'YOUR_GOOGLE_CLIENT_SECRET_HERE' &&
    GOOGLE_REFRESH_TOKEN !== 'YOUR_GOOGLE_REFRESH_TOKEN_HERE' &&
    ROOT_FOLDER_ID !== 'YOUR_DRIVE_FOLDER_ID_HERE'
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

// ─────────────────────────────────────────────────────────────
// OAuth 2.0 — token refresh
// ─────────────────────────────────────────────────────────────

async function getAccessToken() {
  // Return cached token if still valid (with 60 s buffer)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: [
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
      `client_secret=${encodeURIComponent(GOOGLE_CLIENT_SECRET)}`,
      `refresh_token=${encodeURIComponent(GOOGLE_REFRESH_TOKEN)}`,
      'grant_type=refresh_token',
    ].join('&'),
  });

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
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name, parentId, token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
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
  });
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
  const key = `${parentId}::${name}`;
  if (_folderCache.has(key)) return _folderCache.get(key);
  const existing = await findFolder(name, parentId, token);
  const id = existing ?? (await createFolder(name, parentId, token));
  _folderCache.set(key, id);
  return id;
}

// ─────────────────────────────────────────────────────────────
// Drive file upload  (multipart/related with base64 media part)
// ─────────────────────────────────────────────────────────────

async function uploadBase64File(base64Data, mimeType, fileName, parentFolderId, token) {
  const metadata = JSON.stringify({ name: fileName, parents: [parentFolderId] });
  const boundary = `gtpayproof_${Date.now()}`;

  // RFC 2045 multipart/related — Google Drive v3 upload accepts base64 content-transfer-encoding
  const body = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    `${metadata}\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n`,
    'Content-Transfer-Encoding: base64\r\n\r\n',
    `${base64Data}\r\n`,
    `--${boundary}--`,
  ].join('');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive file upload failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id ?? null;
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
 * @param {string} base64Data  Normalized base64 string (no data-URL prefix)
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
export async function uploadPaymentProofToDrive(base64Data, mimeType, meta = {}) {
  if (!isConfigured()) {
    console.warn('[GoogleDrive] Credentials not configured — skipping Drive upload. See src/services/googleDrive.service.js for setup instructions.');
    return null;
  }

  if (!base64Data || base64Data.length < 50) {
    console.warn('[GoogleDrive] base64 data too short — skipping upload');
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

    const fileId = await uploadBase64File(base64Data, mimeType, fileName, saleOrderFolderId, token);
    console.log(
      `[GoogleDrive] Uploaded: ${yearFolderName}/${monthFolderName}/${dayFolderName}/${saleOrderFolderName}/${fileName} → id:${fileId}`
    );
    return fileId;
  } catch (err) {
    console.warn('[GoogleDrive] Upload failed (non-blocking):', err?.message || err);
    return null;
  }
}

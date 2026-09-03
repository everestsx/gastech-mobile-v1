/**
 * Resolves Odoo/Drive config for Expo Go, local Gradle, and EAS APKs.
 * Local Metro inlines @env from .env. EAS bakes the same keys into expo extra.
 */
import Constants from 'expo-constants';
import {
  ODOO_URL as FILE_ODOO_URL,
  ODOO_DB as FILE_ODOO_DB,
  ODOO_API_KEY as FILE_ODOO_API_KEY,
  UID as FILE_UID,
  GOOGLE_CLIENT_ID as FILE_GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET as FILE_GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN as FILE_GOOGLE_REFRESH_TOKEN,
  ROOT_FOLDER_ID as FILE_ROOT_FOLDER_ID,
} from '@env';

function extraBlob() {
  return (
    Constants.expoConfig?.extra ||
    Constants.manifest2?.extra ||
    Constants.manifest?.extra ||
    {}
  );
}

function normalizeEnvString(v) {
  if (v == null) return '';
  let s = String(v).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function pick(...vals) {
  for (const v of vals) {
    const s = normalizeEnvString(v);
    if (s) return s;
  }
  return '';
}

const extra = extraBlob();

export const ODOO_URL = pick(extra.ODOO_URL, extra.odooUrl, FILE_ODOO_URL);
export const ODOO_DB = pick(extra.ODOO_DB, extra.odooDb, FILE_ODOO_DB);
export const ODOO_API_KEY = pick(extra.ODOO_API_KEY, extra.odooApiKey, FILE_ODOO_API_KEY);
export const UID = pick(extra.UID, extra.odooUid, FILE_UID);
export const GOOGLE_CLIENT_ID = pick(extra.GOOGLE_CLIENT_ID, extra.googleClientId, FILE_GOOGLE_CLIENT_ID);
export const GOOGLE_CLIENT_SECRET = pick(
  extra.GOOGLE_CLIENT_SECRET,
  extra.googleClientSecret,
  FILE_GOOGLE_CLIENT_SECRET
);
export const GOOGLE_REFRESH_TOKEN = pick(
  extra.GOOGLE_REFRESH_TOKEN,
  extra.googleRefreshToken,
  FILE_GOOGLE_REFRESH_TOKEN
);
export const ROOT_FOLDER_ID = pick(extra.ROOT_FOLDER_ID, extra.rootFolderId, FILE_ROOT_FOLDER_ID);

export function describeOdooEnvForLog() {
  const url = ODOO_URL;
  let host = '(empty)';
  try {
    if (url) host = new URL(url).host;
  } catch {
    host = '(invalid url)';
  }
  return {
    hasUrl: !!url,
    host,
    hasDb: !!ODOO_DB,
    hasApiKey: !!ODOO_API_KEY,
    uidOk: Number.isFinite(parseInt(UID, 10)),
    extraHasOdooUrl: !!normalizeEnvString(extra.ODOO_URL || extra.odooUrl),
    fileHasOdooUrl: !!normalizeEnvString(FILE_ODOO_URL),
  };
}

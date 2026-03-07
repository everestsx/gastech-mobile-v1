// services/index.service.js
import { ODOO_URL, ODOO_DB, ODOO_API_KEY, UID } from '@env';

const REQUEST_TIMEOUT_MS = 35000;

let API_KEY = ODOO_API_KEY;
let USE_SESSION = false;

export const setApiSession = (uid, apiKey) => {
  API_KEY = apiKey;
  USE_SESSION = false;
};

export const setEmployeeSession = (uid) => {
  API_KEY = null;
  USE_SESSION = true;
};

/** Resolve Odoo credentials (env is inlined at bundle time; restart with cache clear after .env change). */
function getOdooConfig() {
  const url = typeof ODOO_URL === 'string' ? ODOO_URL.trim() : '';
  const db = typeof ODOO_DB === 'string' ? ODOO_DB.trim() : '';
  const apiKey = typeof ODOO_API_KEY === 'string' ? ODOO_API_KEY.trim() : (API_KEY || '');
  const uid = UID != null && UID !== '' ? parseInt(String(UID), 10) : NaN;
  if (!url || !db || !apiKey || Number.isNaN(uid)) {
    const missing = [];
    if (!url) missing.push('ODOO_URL');
    if (!db) missing.push('ODOO_DB');
    if (!apiKey) missing.push('ODOO_API_KEY');
    if (Number.isNaN(uid)) missing.push('UID (must be a number)');
    throw new Error(
      `Odoo env not set or invalid: ${missing.join(', ')}. Check .env and restart the app with cache clear (e.g. npx expo start -c).`
    );
  }
  return { url, db, uid, apiKey };
}

function getHostFromUrl(u) {
  try {
    const parsed = typeof u === 'string' ? new URL(u) : null;
    return parsed ? parsed.host : '(unknown)';
  } catch {
    return '(invalid url)';
  }
}

if (__DEV__) {
  try {
    const c = getOdooConfig();
    console.log('[Odoo] Using server:', getHostFromUrl(c.url));
  } catch (_) {}
}

/** fetch with a real timeout (React Native fetch ignores timeout option). */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    if (__DEV__) {
      const host = getHostFromUrl(url);
      console.warn(`[Odoo] Request failed to ${host}:`, e?.message || e);
    }
    throw e;
  }
}

export const callOdoo = async (model, method, domain = [], options = {}) => {
  const { url, db, uid, apiKey } = getOdooConfig();
  const args = USE_SESSION
    ? [db, uid, null, model, method, domain, options]
    : [db, uid, apiKey, model, method, domain, options];

  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args,
    },
    id: Date.now(),
  };

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: USE_SESSION ? 'include' : 'omit',
    });
  } catch (networkErr) {
    const msg = networkErr?.message || String(networkErr);
    const host = getHostFromUrl(url);
    const isAbort = msg.includes('abort') || networkErr?.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Request timed out (${REQUEST_TIMEOUT_MS / 1000}s). Check your connection and try again.`
        : `Cannot reach server (${host}). ${msg}. Try another network (e.g. WiFi vs mobile data) or check if the URL is reachable from this device.`
    );
  }

  const json = await response.json();
  // console.log(`[Odoo Response] ${model}.${method}:`, JSON.stringify(json, null, 2));
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || 'Odoo error';
    const debug = json.error.data?.debug;
    throw new Error(debug ? `${msg}\n${debug}` : msg);
  }
  return json.result ?? [];
};

/**
 * Call Odoo with explicit positional args (e.g. create(vals), process([id])).
 * positionalArgs = array of positional arguments for the method.
 */
export const callOdooArgs = async (model, method, positionalArgs) => {
  const { url, db, uid, apiKey } = getOdooConfig();
  const args = USE_SESSION
    ? [db, uid, null, model, method, positionalArgs]
    : [db, uid, apiKey, model, method, positionalArgs];

  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args,
    },
    id: Date.now(),
  };

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: USE_SESSION ? 'include' : 'omit',
    });
  } catch (networkErr) {
    const msg = networkErr?.message || String(networkErr);
    const host = getHostFromUrl(url);
    const isAbort = msg.includes('abort') || networkErr?.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Request timed out (${REQUEST_TIMEOUT_MS / 1000}s). Check your connection and try again.`
        : `Cannot reach server (${host}). ${msg} Try another network or check if the URL is reachable from this device.`
    );
  }

  const json = await response.json();
  // console.log(`[Odoo Response] ${model}.${method}:`, JSON.stringify(json, null, 2));
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || 'Odoo error';
    const debug = json.error.data?.debug;
    throw new Error(debug ? `${msg}\n${debug}` : msg);
  }
  return json.result;
};

/**
 * Call Odoo with positional args and kwargs (e.g. wizard create_invoices with context).
 * positionalArgs = array of method positional args (e.g. [[wizardId]]).
 * kwargs = object passed as keyword arguments (e.g. { context: { active_model, active_ids } }).
 */
export const callOdooArgsKwargs = async (model, method, positionalArgs, kwargs = {}) => {
  const { url, db, uid, apiKey } = getOdooConfig();
  const args = USE_SESSION
    ? [db, uid, null, model, method, positionalArgs, kwargs]
    : [db, uid, apiKey, model, method, positionalArgs, kwargs];

  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: { service: "object", method: "execute_kw", args },
    id: Date.now(),
  };

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: USE_SESSION ? 'include' : 'omit',
    });
  } catch (networkErr) {
    const msg = networkErr?.message || String(networkErr);
    const host = getHostFromUrl(url);
    const isAbort = msg.includes('abort') || networkErr?.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Request timed out (${REQUEST_TIMEOUT_MS / 1000}s). Check your connection and try again.`
        : `Cannot reach server (${host}). ${msg} Try another network or check if the URL is reachable from this device.`
    );
  }

  const json = await response.json();
  // console.log(`[Odoo Response] ${model}.${method}:`, JSON.stringify(json, null, 2));
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || 'Odoo error';
    const debug = json.error.data?.debug;
    throw new Error(debug ? `${msg}\n${debug}` : msg);
  }
  return json.result;
};

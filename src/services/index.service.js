// services/index.service.js
import { ODOO_URL, ODOO_DB, ODOO_API_KEY, UID } from '@env';

const REQUEST_TIMEOUT_MS = 35000;

/**
 * Odoo round-trip counter for sync benchmarking. Every RPC helper below goes through
 * fetchWithTimeout, so this counts all of them. Diagnostics only — never gates behaviour.
 */
let _odooRpcCount = 0;

export function getOdooRpcCount() {
  return _odooRpcCount;
}

export function resetOdooRpcCount() {
  _odooRpcCount = 0;
}

/**
 * True only when the transport could not reach the server at all.
 *
 * Callers use this to skip fallbacks that cannot possibly succeed while there is no
 * connection. It deliberately does NOT include timeouts: a request that exceeded
 * REQUEST_TIMEOUT_MS means the server is reachable but slow, and the retry / heal /
 * sequential paths can still succeed on a later attempt. Treating a timeout as
 * "offline" would skip those repairs and strand the queue item.
 *
 * Anything unrecognised is reported as NOT a network error, so existing fallback
 * behaviour is preserved whenever there is any doubt.
 */
export function isOdooNetworkError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('cannot reach server') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch')
  );
}

/** Strip BOM/CRLF, trim, remove optional wrapping quotes (common .env / Windows issues). */
function normalizeEnvString(v) {
  if (v == null) return '';
  let s = String(v).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

let API_KEY = normalizeEnvString(ODOO_API_KEY);
let USE_SESSION = false;

export const setApiSession = (uid, apiKey) => {
  API_KEY = normalizeEnvString(apiKey);
  USE_SESSION = false;
};

export const setEmployeeSession = (uid) => {
  API_KEY = null;
  USE_SESSION = true;
};

/** Resolve Odoo credentials (env is inlined at bundle time; restart with cache clear after .env change). */
function getOdooConfig() {
  const url = normalizeEnvString(ODOO_URL);
  const db = normalizeEnvString(ODOO_DB);
  const fromEnv = normalizeEnvString(ODOO_API_KEY);
  const apiKey = fromEnv || normalizeEnvString(API_KEY);
  const uid = UID != null && UID !== '' ? parseInt(normalizeEnvString(UID), 10) : NaN;
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
    console.log('[Odoo] Using server:', getHostFromUrl(c.url), '| db:', c.db, '| uid:', c.uid, '| apiKeyLen:', c.apiKey?.length ?? 0);
  } catch (_) {}
}

/** fetch with a real timeout (React Native fetch ignores timeout option). */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  _odooRpcCount += 1;
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
 * Odoo JSON 2 API (Bearer), same style as /json/2/.../search_read used by commission.
 * Uses current env/session API key from getOdooConfig().
 */
export const callOdooJson2 = async (model, method, params = {}) => {
  const { url, apiKey } = getOdooConfig();
  const baseUrl = url.replace(/\/jsonrpc\/?$/i, "").replace(/\/$/, "");
  const path = `${baseUrl}/json/2/${model}/${method}`;

  const response = await fetchWithTimeout(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });

  const json = await response.json();
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || "Odoo JSON 2 error";
    throw new Error(msg);
  }
  return json.result ?? json;
};

/**
 * POST a plain JSON body to a custom Odoo controller route (not the /json/2/ model API,
 * e.g. a one-off @http.route endpoint). Same host resolution and Bearer auth as
 * callOdooJson2 — always follows ODOO_URL from env/session, never a hardcoded host.
 * @param {string} path - route path starting with '/', e.g. "/gastech/driver_login_history/route"
 */
export const postOdooRoute = async (path, body = {}) => {
  const { url, apiKey } = getOdooConfig();
  const baseUrl = url.replace(/\/jsonrpc\/?$/i, "").replace(/\/$/, "");
  const fullUrl = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetchWithTimeout(fullUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  if (json?.error) {
    const msg = json.error.data?.message || json.error.message || "Odoo route error";
    throw new Error(msg);
  }
  return json?.result ?? json;
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

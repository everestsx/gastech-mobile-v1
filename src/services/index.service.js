// services/index.service.js
import { ODOO_URL, ODOO_DB, ODOO_API_KEY, UID } from '@env';

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: USE_SESSION ? 'include' : 'omit',
  });

  const json = await response.json();
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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: USE_SESSION ? 'include' : 'omit',
  });

  const json = await response.json();
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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: USE_SESSION ? 'include' : 'omit',
  });

  const json = await response.json();
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || 'Odoo error';
    const debug = json.error.data?.debug;
    throw new Error(debug ? `${msg}\n${debug}` : msg);
  }
  return json.result;
};

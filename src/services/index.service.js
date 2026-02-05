// services/index.service.js
import { ODOO_URL, ODOO_DB, ODOO_API_KEY, UID } from '@env';

let API_KEY = ODOO_API_KEY;
let USE_SESSION = false;

const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

export const setApiSession = (uid, apiKey) => {
  UID = uid;
  API_KEY = apiKey;
  USE_SESSION = false;
};

export const setEmployeeSession = (uid) => {
  UID = uid;
  API_KEY = null;
  USE_SESSION = true;
};

function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error('Request timeout'));
    }, timeoutMs);
    const init = controller ? { ...options, signal: controller.signal } : options;
    fetch(url, init)
      .then((res) => {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

export const callOdoo = async (model, method, domain = [], options = {}) => {
  const args = USE_SESSION
    ? [ODOO_DB, UID, null, model, method, domain, options]
    : [ODOO_DB, UID, API_KEY, model, method, domain, options];

  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args,
    },
    id: Date.now(),
  };

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(
        ODOO_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: USE_SESSION ? 'include' : 'omit',
        },
        REQUEST_TIMEOUT_MS
      );

      const json = await response.json();
      if (!response.ok) {
        const msg = json.error?.data?.message || json.error?.message || `HTTP ${response.status}`;
        throw new Error(msg);
      }
      if (json.error) {
        throw new Error(json.error?.data?.message || json.error?.message || 'API error');
      }
      return json.result ?? [];
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError;
};

// services/index.service.js
import {ODOO_URL,ODOO_DB,ODOO_API_KEY,UID} from '@env'

let API_KEY = ODOO_API_KEY;
let USE_SESSION = false;

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

export const callOdoo = async (model, method, domain = [], options = {}) => {
    console.log("ENV FILES CALLS : ",ODOO_DB,ODOO_API_KEY,ODOO_URL)
  const args = USE_SESSION
    ? [ODOO_DB, UID, null, model, method, domain, options]
    : [ODOO_DB, UID, API_KEY, model, method, domain, options];

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

  const response = await fetch(ODOO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: USE_SESSION ? "include" : "omit",
  });

  const json = await response.json();
  return json.result || [];
};

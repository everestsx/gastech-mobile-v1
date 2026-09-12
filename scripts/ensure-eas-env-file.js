/**
 * EAS Build: if the upload did not include .env but the worker has Odoo/Drive
 * keys in process.env (dashboard / eas.json environment), materialize a file
 * so react-native-dotenv can inline the same values as local Metro.
 */
const fs = require("fs");
const path = require("path");
const { ENV_KEYS, resolveExistingEnvPath } = require("./loadBuildEnv");

const dest = resolveExistingEnvPath();
if (fs.existsSync(dest)) {
  console.log("[ensure-eas-env] env file already present:", path.basename(dest));
  process.exit(0);
}

const lines = [];
for (const key of ENV_KEYS) {
  const value = process.env[key];
  if (value == null || String(value).trim() === "") continue;
  lines.push(`${key}=${value}`);
}

if (!lines.length) {
  console.log(
    "[ensure-eas-env] no env file and no process.env keys; app.config extra must supply values"
  );
  process.exit(0);
}

fs.writeFileSync(dest, `${lines.join("\n")}\n`, "utf8");
console.log("[ensure-eas-env] wrote", path.basename(dest), "keys:", lines.map((line) => line.split("=")[0]).join(","));

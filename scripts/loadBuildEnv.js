/**
 * Shared build-time env resolution for app.config.js and babel.config.js.
 * Paths are always project-root absolute so EAS/Gradle cwd does not matter.
 */
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const ENV_KEYS = [
  "ODOO_URL",
  "ODOO_DB",
  "ODOO_API_KEY",
  "UID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "ROOT_FOLDER_ID",
];

function getCurrentGitBranch() {
  try {
    return require("child_process")
      .execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" })
      .toString()
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

function resolvePreferredEnvName() {
  const easProfile = String(process.env.EAS_BUILD_PROFILE || "").toLowerCase().trim();
  if (easProfile === "preview" || easProfile === "development") return ".env.stage";
  if (easProfile === "production") return ".env.production";

  const explicitVariant = String(process.env.APP_VARIANT || "").toLowerCase().trim();
  if (explicitVariant === "stage" || explicitVariant === "staging") return ".env.stage";
  if (explicitVariant === "prod" || explicitVariant === "production") return ".env.production";

  const gitBranch = getCurrentGitBranch();
  if (gitBranch.includes("stage") || gitBranch.includes("staging")) return ".env.stage";
  if (
    gitBranch.includes("prod") ||
    gitBranch.includes("production") ||
    gitBranch === "main" ||
    gitBranch === "master"
  ) {
    return ".env.production";
  }

  return ".env";
}

function resolveExistingEnvPath() {
  const preferredName = resolvePreferredEnvName();
  const preferred = path.join(PROJECT_ROOT, preferredName);
  const fallback = path.join(PROJECT_ROOT, ".env");
  if (fs.existsSync(preferred)) return preferred;
  if (preferred !== fallback && fs.existsSync(fallback)) {
    console.log(`[env] ${preferredName} not found. Falling back to .env`);
    return fallback;
  }
  return preferred;
}

function parseEnvFileFallback(contents) {
  const out = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath);
  try {
    const dotenv = require("dotenv");
    return dotenv.parse(raw);
  } catch {
    return parseEnvFileFallback(raw.toString("utf8"));
  }
}

function applyEnvFileToProcess({ override = true } = {}) {
  const envPath = resolveExistingEnvPath();
  const parsed = parseEnvFile(envPath);
  for (const [key, value] of Object.entries(parsed)) {
    if (!override && process.env[key]) continue;
    process.env[key] = value;
  }
  return { envPath, exists: fs.existsSync(envPath) };
}

function getPublicEnvExtra() {
  applyEnvFileToProcess({ override: true });
  const extra = {};
  for (const key of ENV_KEYS) {
    extra[key] = process.env[key] || "";
  }
  return extra;
}

function describeEnvForLog(extra = getPublicEnvExtra()) {
  const url = extra.ODOO_URL || "";
  let host = "(empty)";
  try {
    if (url) host = new URL(url).host;
  } catch {
    host = "(invalid url)";
  }
  return {
    envFileExists: fs.existsSync(resolveExistingEnvPath()),
    hasUrl: !!url,
    host,
    hasDb: !!extra.ODOO_DB,
    hasApiKey: !!extra.ODOO_API_KEY,
    uidOk: !!extra.UID,
    hasDrive: !!(extra.GOOGLE_CLIENT_ID && extra.GOOGLE_REFRESH_TOKEN && extra.ROOT_FOLDER_ID),
  };
}

module.exports = {
  PROJECT_ROOT,
  ENV_KEYS,
  resolveExistingEnvPath,
  applyEnvFileToProcess,
  getPublicEnvExtra,
  describeEnvForLog,
};

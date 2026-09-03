const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = __dirname;

function getCurrentGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' })
      .toString()
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

function resolveEnvFileName() {
  const explicitVariant = String(process.env.APP_VARIANT || '').toLowerCase().trim();
  if (explicitVariant === 'stage' || explicitVariant === 'staging') return '.env.stage';
  if (explicitVariant === 'prod' || explicitVariant === 'production') return '.env.production';

  const gitBranch = getCurrentGitBranch();
  if (gitBranch.includes('stage') || gitBranch.includes('staging')) return '.env.stage';
  if (
    gitBranch.includes('prod') ||
    gitBranch.includes('production') ||
    gitBranch === 'main' ||
    gitBranch === 'master'
  ) {
    return '.env.production';
  }

  return '.env';
}

function resolveExistingEnvPath() {
  const preferredName = resolveEnvFileName();
  const preferred = path.join(PROJECT_ROOT, preferredName);
  const fallback = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(fallback)) {
    console.log(`[babel] ${preferredName} not found. Falling back to .env`);
    return fallback;
  }
  console.log(`[babel] ${preferredName} not found and .env not found.`);
  return preferred;
}

module.exports = function (api) {
  const envPath = resolveExistingEnvPath();
  let envStamp = 'missing';
  try {
    if (fs.existsSync(envPath)) envStamp = String(fs.statSync(envPath).mtimeMs);
  } catch (_) {
    /* ignore */
  }
  api.cache.using(() => `${envPath}:${envStamp}`);
  console.log(`[babel] Using env file: ${envPath} exists=${fs.existsSync(envPath)}`);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: envPath,
          allowUndefined: true,
        },
      ],
    ],
  };
};

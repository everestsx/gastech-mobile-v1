const { execSync } = require('child_process');
const fs = require('fs');

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

function resolveEnvPath() {
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

  return '.env.production';
}

function resolveExistingEnvPath() {
  const preferred = resolveEnvPath();
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  if (fs.existsSync('.env')) {
    console.log(`[babel] ${preferred} not found. Falling back to .env`);
    return '.env';
  }
  console.log(`[babel] ${preferred} not found and .env not found. Using ${preferred}`);
  return preferred;
}

module.exports = function (api) {
  api.cache(true);
  const envPath = resolveExistingEnvPath();
  console.log(`[babel] Using env file: ${envPath}`);

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

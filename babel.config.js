const fs = require('fs');
const { resolveExistingEnvPath } = require('./scripts/loadBuildEnv');

module.exports = function (api) {
  const envPath = resolveExistingEnvPath();
  let envStamp = 'missing';
  try {
    if (fs.existsSync(envPath)) envStamp = String(fs.statSync(envPath).mtimeMs);
  } catch {
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

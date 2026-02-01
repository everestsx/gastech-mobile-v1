const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Use legacy "main" resolution so some packages (e.g. pretty-format) resolve correctly.
config.resolver = config.resolver || {};
config.resolver.unstable_enablePackageExports = false;

module.exports = config;

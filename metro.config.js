const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Use legacy "main" resolution so some packages (e.g. pretty-format) resolve correctly.
// Add additional resolver for React Native
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native': require.resolve('react-native'),
};

// Add support for Hermes
config.transformer.unstable_allowRequireContext = true;

module.exports = config;


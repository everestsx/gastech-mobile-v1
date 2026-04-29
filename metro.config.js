const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

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

// Exclude .gradle directories from file watching.
// On Windows, Metro throws ENOENT errors trying to watch .gradle paths
// inside node_modules (e.g. expo-modules-core gradle plugin). This
// blockList prevents those crashes when running Playwright web tests.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\/g, '\\\\');
const projectRoot = escapeRegExp(__dirname);
config.resolver.blockList = [
  new RegExp(`${projectRoot}[\\\\/]node_modules[\\\\/].*[\\\\/]\\.gradle[\\\\/].*`),
];

module.exports = config;



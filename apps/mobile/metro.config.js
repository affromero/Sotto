const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for shared packages (@sotto/shared)
config.watchFolders = [monorepoRoot];

// Resolve modules from both the mobile workspace and the monorepo root,
// but prefer the mobile workspace's node_modules first.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// react-native 0.81.5 ships a renderer compiled for react@19.1.0, but
// the monorepo root has react@19.2.4 for the web app. Force ALL react
// imports to resolve from the mobile workspace's copy (19.1.0).
const mobileReact = path.resolve(projectRoot, 'node_modules/react');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') {
    return { type: 'sourceFile', filePath: require.resolve('react', { paths: [projectRoot] }) };
  }
  if (moduleName.startsWith('react/')) {
    const subpath = moduleName.slice('react/'.length);
    return { type: 'sourceFile', filePath: require.resolve(`react/${subpath}`, { paths: [projectRoot] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

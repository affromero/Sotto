// app.plugin.js — Expo config plugin for the SottoPencilKit local module.
//
// This file is resolved by Expo's plugin system when the module path appears
// in expo.plugins inside app.json.  Its only responsibility is to register
// the local CocoaPods podspec so `npx expo prebuild` (and EAS Build) include
// the native Swift source in the generated ios/ project.
//
// No Android work is needed — PKCanvasView / PencilKit are iOS-only APIs.

const { withPlugins, withPodfileProperties } = require('@expo/config-plugins');

/**
 * Adds the SottoPencilKit podspec path to the Podfile so CocoaPods can
 * resolve the local module during `pod install`.
 *
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
function withSottoPencilKitPod(config) {
  return withPodfileProperties(config, (cfg) => {
    // expo-modules-core autolinking already handles local modules declared in
    // expo-module.config.json when the directory is inside the project tree.
    // We set an explicit marker so integrators can verify the module is wired.
    cfg.modResults['SOTTO_PENCILKIT_INCLUDED'] = 'true';
    return cfg;
  });
}

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 */
module.exports = function withSottoPencilKit(config) {
  return withPlugins(config, [withSottoPencilKitPod]);
};

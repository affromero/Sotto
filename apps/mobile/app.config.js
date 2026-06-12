// Dynamic Expo config — extends app.json with build-time environment variables.
// Reason: Google iOS OAuth clients require the reversed client ID registered as a URL scheme
// so that iOS can route the OAuth callback back to the app.
// e.g., 123456789.apps.googleusercontent.com → com.googleusercontent.apps.123456789://

const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const apiUrl = process.env.EXPO_PUBLIC_API_URL;

// Derive reversed client ID from the iOS client ID format:
// "{numeric_id}.apps.googleusercontent.com" → "com.googleusercontent.apps.{numeric_id}"
const reversedGoogleClientId = googleClientId
  ? `com.googleusercontent.apps.${googleClientId.split('.')[0]}`
  : null;

function getDeploymentHost() {
  // A runtime-config ("scan to connect") build has no baked-in server — the user
  // pairs one in-app. Only derive a fixed host (for universal/app links) when
  // EXPO_PUBLIC_API_URL is provided; otherwise return null and skip those links.
  if (!apiUrl) {
    return null;
  }

  const parsed = new URL(apiUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use http or https.');
  }
  return parsed.hostname;
}

const deploymentHost = getDeploymentHost();

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(deploymentHost ? { associatedDomains: [`applinks:${deploymentHost}`] } : {}),
    infoPlist: {
      ...config.ios?.infoPlist,
      CFBundleURLTypes: reversedGoogleClientId
        ? [{ CFBundleURLSchemes: [reversedGoogleClientId] }]
        : [],
    },
  },
  android: {
    ...config.android,
    intentFilters: deploymentHost
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              { scheme: 'https', host: deploymentHost, pathPrefix: '/episode' },
              { scheme: 'https', host: deploymentHost, pathPrefix: '/user' },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : [],
  },
});

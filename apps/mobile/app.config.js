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
  if (!apiUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is required for mobile builds. Set it to your Sotto deployment API URL, for example http://localhost:3000/api.'
    );
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
    associatedDomains: [`applinks:${deploymentHost}`],
    infoPlist: {
      ...config.ios?.infoPlist,
      CFBundleURLTypes: reversedGoogleClientId
        ? [{ CFBundleURLSchemes: [reversedGoogleClientId] }]
        : [],
    },
  },
  android: {
    ...config.android,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: deploymentHost, pathPrefix: '/podcast' },
          { scheme: 'https', host: deploymentHost, pathPrefix: '/user' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
});

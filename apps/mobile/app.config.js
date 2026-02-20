// Dynamic Expo config — extends app.json with build-time environment variables.
// Reason: Google iOS OAuth clients require the reversed client ID registered as a URL scheme
// so that iOS can route the OAuth callback back to the app.
// e.g., 123456789.apps.googleusercontent.com → com.googleusercontent.apps.123456789://

const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

// Derive reversed client ID from the iOS client ID format:
// "{numeric_id}.apps.googleusercontent.com" → "com.googleusercontent.apps.{numeric_id}"
const reversedGoogleClientId = googleClientId
  ? `com.googleusercontent.apps.${googleClientId.split('.')[0]}`
  : null;

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      CFBundleURLTypes: reversedGoogleClientId
        ? [{ CFBundleURLSchemes: [reversedGoogleClientId] }]
        : [],
    },
  },
});

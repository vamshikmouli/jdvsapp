import { ExpoConfig } from 'expo/config';

// API base URL for the app. Override per-environment with EXPO_PUBLIC_API_URL
// (e.g. https://your-prod-host). Defaults to the local Next.js dev server.
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

const config: ExpoConfig = {
  name: 'Jnana Deepika — Parent',
  slug: 'jnana-parent-app',
  owner: 'vamshik123', // EAS account that owns the project (change to a team if needed)
  scheme: 'jnanaparent',
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'in.jnanadeepika.parent',
    infoPlist: {
      NSFaceIDUsageDescription: 'Unlock the app with Face ID.',
    },
  },
  android: {
    package: 'in.jnanadeepika.parent',
    // Firebase/FCM (push) is optional: only wired when GOOGLE_SERVICES_JSON is
    // provided (EAS file env var). Without it the app still builds and runs — push
    // just stays off. Avoids prebuild failing on a missing file.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#7c3aed',
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-local-authentication',
    'expo-asset',
    'expo-font',
    'expo-image',
    'expo-sharing',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#7c3aed',
      },
    ],
    [
      'expo-notifications',
      { icon: './assets/notification-icon.png', color: '#7c3aed' },
    ],
  ],
  extra: {
    apiUrl: API_URL,
    eas: {
      // EAS project @vamshik123/jnana-parent-app. Required for push tokens + builds.
      projectId: process.env.EAS_PROJECT_ID || 'bb705350-b248-4165-8af8-dbe3c7ab93c9',
    },
  },
};

export default config;

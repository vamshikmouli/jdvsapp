import Constants from 'expo-constants';

// Base URL of the Next.js backend. Set via EXPO_PUBLIC_API_URL (see app.config.ts).
export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string) || 'http://localhost:3000';

export const TOKEN_KEY = 'parent.authToken';
export const BIOMETRIC_KEY = 'parent.biometricEnabled';

/** Turn a stored media path into a loadable URL (absolute URLs pass through). */
export function resolveMediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

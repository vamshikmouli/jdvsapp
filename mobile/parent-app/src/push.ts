import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from '@/api/client';

/**
 * Native push notifications.
 *
 * NOTE: remote push requires a development/standalone build with EAS push
 * credentials (FCM for Android, APNs for iOS) — it does NOT work in Expo Go on
 * SDK 53+. Everything here fails gracefully (no-ops) when push isn't available
 * so the app keeps working regardless.
 */

/** Foreground display behaviour — call once at app start. */
export function configurePushHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission, get the Expo push token, and register it with the backend. */
export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#7C3AED',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : (undefined as any));
    const token = resp?.data;
    if (!token) return;

    await api('/api/push/register', {
      method: 'POST',
      body: { token, platform: Platform.OS, deviceName: (Constants as any).deviceName ?? undefined },
    }).catch(() => {});
  } catch (e: any) {
    // Expo Go (SDK 53+), emulator, or missing EAS projectId → push unavailable.
    console.log('[push] registration skipped:', e?.message);
  }
}

/** Tell the backend to forget this device's token (on sign-out). */
export async function unregisterPush(): Promise<void> {
  try {
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : (undefined as any));
    const token = resp?.data;
    if (token) await api('/api/push/register', { method: 'POST', body: { token }, auth: false }).catch(() => {});
  } catch {
    // no-op
  }
}

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '@/api/client';

/**
 * Native push notifications.
 *
 * expo-notifications' native modules are NOT present in Expo Go (SDK 53+), and
 * remote push needs a development/standalone build anyway. So we load the module
 * LAZILY and skip everything in Expo Go — otherwise merely importing it crashes
 * with "Cannot find native module 'ExpoTopicSubscriptionModule'". In a real
 * build the module is present and push works normally.
 */

const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants as any).executionEnvironment === 'storeClient';

function loadNotifications(): any | null {
  if (isExpoGo) return null;
  try {
    // Lazy require so Expo Go never evaluates the native module.
    return require('expo-notifications');
  } catch {
    return null;
  }
}

function getProjectId(): string | undefined {
  return (
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId
  );
}

/** Foreground display behaviour — call once at app start. No-op in Expo Go. */
export function configurePushHandler() {
  const N = loadNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* ignore */
  }
}

/** Ask permission, get the Expo push token, and register it with the backend. */
export async function registerForPush(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: N.AndroidImportance.DEFAULT,
        lightColor: '#7C3AED',
      });
    }

    const current = await N.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await N.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId = getProjectId();
    const resp = await N.getExpoPushTokenAsync(projectId ? { projectId } : (undefined as any));
    const token = resp?.data;
    if (!token) return;

    await api('/api/push/register', {
      method: 'POST',
      body: { token, platform: Platform.OS, deviceName: (Constants as any).deviceName ?? undefined },
    }).catch(() => {});
  } catch (e: any) {
    console.log('[push] registration skipped:', e?.message);
  }
}

/** Tell the backend to forget this device's token (on sign-out). */
export async function unregisterPush(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    const projectId = getProjectId();
    const resp = await N.getExpoPushTokenAsync(projectId ? { projectId } : (undefined as any));
    const token = resp?.data;
    if (token) await api('/api/push/register', { method: 'DELETE', body: { token }, auth: false }).catch(() => {});
  } catch {
    /* no-op */
  }
}

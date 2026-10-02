// Which browser is this, and can it run every feature (voice marks entry above all)?
// Used by the notice bar in the admin shell and by the 🎤 button, so staff are told
// exactly what to update or switch to instead of a feature silently not working.

export const MIN_CHROME = 108; // phone-screen layout (dvh) + everything else

export interface BrowserInfo {
  name: string;            // "Chrome", "Edge", "Safari", "Firefox", "Samsung Internet", "Chrome (iPhone)"…
  version: number | null;  // major version
  os: 'android' | 'ios' | 'desktop';
  iosVersion: number | null; // e.g. 16.4
  label: string;           // "Chrome 96 on Android"
}

export function detectBrowser(ua: string, maxTouchPoints = 0): BrowserInfo {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const os: BrowserInfo['os'] = ios ? 'ios' : android ? 'android' : 'desktop';
  const num = (re: RegExp) => { const m = ua.match(re); return m ? parseInt(m[1], 10) : null; };
  let iosVersion: number | null = null;
  if (ios) {
    const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
    if (m) iosVersion = parseFloat(`${m[1]}.${m[2]}`);
  }
  let name = 'your browser', version: number | null = null;
  if (ios) {
    if (/CriOS\//.test(ua)) { name = 'Chrome (iPhone)'; version = num(/CriOS\/(\d+)/); }
    else if (/EdgiOS\//.test(ua)) { name = 'Edge (iPhone)'; version = num(/EdgiOS\/(\d+)/); }
    else if (/FxiOS\//.test(ua)) { name = 'Firefox (iPhone)'; version = num(/FxiOS\/(\d+)/); }
    else { name = 'Safari'; version = num(/Version\/(\d+)/); }
  } else if (/Edg\//.test(ua)) { name = 'Edge'; version = num(/Edg\/(\d+)/); }
  else if (/SamsungBrowser\//.test(ua)) { name = 'Samsung Internet'; version = num(/SamsungBrowser\/(\d+)/); }
  else if (/OPR\//.test(ua)) { name = 'Opera'; version = num(/OPR\/(\d+)/); }
  else if (/Firefox\//.test(ua)) { name = 'Firefox'; version = num(/Firefox\/(\d+)/); }
  else if (/Chrome\//.test(ua)) { name = 'Chrome'; version = num(/Chrome\/(\d+)/); }
  else if (/Safari\//.test(ua)) { name = 'Safari'; version = num(/Version\/(\d+)/); }
  const where = os === 'ios' ? `iPhone (iOS ${iosVersion ?? '?'})` : os === 'android' ? 'Android' : 'computer';
  return { name, version, os, iosVersion, label: `${name}${version ? ` ${version}` : ''} on ${where}` };
}

export interface BrowserIssue { key: string; text: string }

/** Things that won't work well in this browser, in plain words, with what to do. */
export function browserIssues(b: BrowserInfo, env: { secure: boolean; hasVoice: boolean }): BrowserIssue[] {
  const out: BrowserIssue[] = [];
  const chromium = b.name === 'Chrome' || b.name === 'Edge';
  if (chromium && b.version !== null && b.version < MIN_CHROME) {
    out.push({ key: 'old', text: `Your ${b.name} is version ${b.version} — please update ${b.name} to the latest version (${MIN_CHROME} or newer) from the ${b.os === 'android' ? 'Play Store' : 'browser menu → Help → About'}. Some screens may not work properly until then.` });
  }
  if (b.os === 'ios' && b.iosVersion !== null && b.iosVersion < 15) {
    out.push({ key: 'oldios', text: `This iPhone is on iOS ${b.iosVersion}. Please update iOS (Settings → General → Software Update) for everything to work.` });
  }
  if (!env.secure) {
    out.push({ key: 'https', text: 'This site is open without https:// — the camera and voice entry are blocked by the browser. Open the school app with its https:// address.' });
  }
  return out;
}

/** Why voice marks entry can't run here (null = it should work). */
export function voiceProblem(b: BrowserInfo, env: { secure: boolean; hasVoice: boolean; online: boolean }): string | null {
  if (!env.secure) return 'Voice needs the site to be opened with https:// — open the school app with its https:// address.';
  if (!env.hasVoice) {
    if (b.os === 'ios') {
      if (b.name !== 'Safari') return `Voice entry doesn't work in ${b.name}. On iPhone, open the app in Safari to use voice.`;
      return `Voice entry needs iOS 14.5 or newer (this iPhone has iOS ${b.iosVersion ?? 'older'}). Update iOS in Settings → General → Software Update.`;
    }
    if (b.name === 'Firefox' || b.name === 'Opera' || b.name === 'Samsung Internet') {
      return `Voice entry doesn't work in ${b.name}. Open the app in Google Chrome (latest version) to use voice.`;
    }
    return `Voice entry isn't available in ${b.label}. Use the latest Google Chrome (Android / computer) or Safari (iPhone).`;
  }
  if (!env.online) return 'Voice needs an internet connection — you seem to be offline.';
  return null;
}

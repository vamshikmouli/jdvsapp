// Tiny user-agent parser — turns a raw UA string into a friendly device label.
// Good enough for an admin "who installed the app" list; not a full UA library.

export interface ParsedUA {
  device: string;  // e.g. "iPhone", "Android phone", "Windows PC"
  os: string;      // e.g. "iOS 18.7", "Android 14", "Windows"
  browser: string; // e.g. "Safari", "Chrome", "Edge"
  label: string;   // combined, e.g. "iPhone · Safari"
}

export function parseUA(ua: string | null | undefined): ParsedUA {
  const s = ua || '';
  let device = 'Unknown device';
  let os = '';
  let browser = 'Browser';

  // OS / device
  if (/iPhone/i.test(s)) {
    device = 'iPhone';
    const m = s.match(/iPhone OS (\d+[_\d]*)/i);
    os = 'iOS' + (m ? ' ' + m[1].replace(/_/g, '.') : '');
  } else if (/iPad/i.test(s)) {
    device = 'iPad';
    const m = s.match(/OS (\d+[_\d]*)/i);
    os = 'iPadOS' + (m ? ' ' + m[1].replace(/_/g, '.') : '');
  } else if (/Android/i.test(s)) {
    device = /Mobile/i.test(s) ? 'Android phone' : 'Android tablet';
    const m = s.match(/Android (\d+(?:\.\d+)?)/i);
    os = 'Android' + (m ? ' ' + m[1] : '');
    const model = s.match(/;\s?([^;)]+)\sBuild\//i);
    if (model && model[1]) device = model[1].trim();
  } else if (/Windows NT/i.test(s)) {
    device = 'Windows PC';
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(s)) {
    device = 'Mac';
    os = 'macOS';
  } else if (/Linux/i.test(s)) {
    device = 'Linux';
    os = 'Linux';
  }

  // Browser (order matters)
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/CriOS/i.test(s)) browser = 'Chrome';
  else if (/FxiOS|Firefox/i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Version\/.*Safari/i.test(s) || /Safari/i.test(s)) browser = 'Safari';

  const label = [device, browser].filter(Boolean).join(' · ');
  return { device, os, browser, label };
}

import { describe, it, expect } from 'vitest';
import { detectBrowser, browserIssues, voiceProblem } from '@/lib/browserCheck';

const UA = {
  oldAndroidChrome: 'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36',
  newAndroidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
};
const ok = { secure: true, hasVoice: true, online: true };

describe('browser check', () => {
  it('names the browser and version', () => {
    expect(detectBrowser(UA.oldAndroidChrome).label).toBe('Chrome 96 on Android');
    expect(detectBrowser(UA.edge).label).toBe('Edge 126 on computer');
    expect(detectBrowser(UA.iosSafari).label).toBe('Safari 17 on iPhone (iOS 17.4)');
    expect(detectBrowser(UA.iosChrome).name).toBe('Chrome (iPhone)');
    expect(detectBrowser(UA.samsung).name).toBe('Samsung Internet');
  });
  it('asks old Chrome to update; new Chrome is fine', () => {
    expect(browserIssues(detectBrowser(UA.oldAndroidChrome), ok).map((i) => i.key)).toEqual(['old']);
    expect(browserIssues(detectBrowser(UA.newAndroidChrome), ok)).toEqual([]);
    expect(browserIssues(detectBrowser(UA.newAndroidChrome), { ...ok, secure: false }).map((i) => i.key)).toEqual(['https']);
  });
  it('explains why voice cannot run', () => {
    expect(voiceProblem(detectBrowser(UA.newAndroidChrome), ok)).toBeNull();
    expect(voiceProblem(detectBrowser(UA.firefox), { ...ok, hasVoice: false })).toMatch(/Google Chrome/);
    expect(voiceProblem(detectBrowser(UA.iosChrome), { ...ok, hasVoice: false })).toMatch(/Safari/);
    expect(voiceProblem(detectBrowser(UA.newAndroidChrome), { ...ok, online: false })).toMatch(/internet/);
    expect(voiceProblem(detectBrowser(UA.newAndroidChrome), { ...ok, secure: false })).toMatch(/https/);
  });
});

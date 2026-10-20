import { Platform } from 'react-native';
import { api } from '@/api/client';

export interface ParentUser {
  id: string;
  name: string;
  surface: 'PARENT';
  roleKey: string;
}

export interface OtpAccount {
  email: string;
  displayName: string;
  roleName: string;
  surface?: string;
}

// Everyday PIN sign-in (parent-only Bearer bridge).
export function mobileLogin(identifier: string, pin: string) {
  return api<{ token: string; user: ParentUser }>('/api/auth/mobile/login', {
    method: 'POST',
    auth: false,
    body: { identifier, pin, platform: Platform.OS },
  });
}

export function mobileLogout() {
  return api<{ ok: boolean }>('/api/auth/mobile/logout', { method: 'POST' }).catch(() => ({ ok: true }));
}

// First-login / forgot-PIN — reuses the existing web WhatsApp-OTP endpoints.
export function requestOtp(phone: string) {
  return api<{ ok: boolean }>('/api/auth/otp/request', { method: 'POST', auth: false, body: { phone } });
}
export function verifyOtp(phone: string, code: string) {
  return api<{ grantToken: string }>('/api/auth/otp/verify', { method: 'POST', auth: false, body: { phone, code } });
}
export function setPin(phone: string, grantToken: string, pin: string) {
  return api<{ ok: boolean; accounts: OtpAccount[] }>('/api/auth/set-pin', {
    method: 'POST',
    auth: false,
    body: { phone, grantToken, pin },
  });
}

// Public school branding for the login screen.
export function fetchBranding(): Promise<{ schoolName?: string; logoUrl?: string }> {
  return api<{ schoolName?: string; logoUrl?: string }>('/api/branding', { auth: false }).catch(() => ({}));
}

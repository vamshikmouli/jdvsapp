// OTP first-login / forgot-PIN over WhatsApp, integrated with the existing
// User + passwordHash + NextAuth flow. Two phases:
//   1. requestOtp  → send a 6-digit code (only to a phone that owns an active User)
//   2. verifyOtp   → check the code, mint a one-time SET_PIN grant token
// The grant is spent by POST /api/auth/set-pin (grant path) to set the PIN, after
// which the user signs in normally with phone + PIN via NextAuth.
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { normalizePhone } from '@/lib/auth/provision';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { anyAccountForPhone } from '@/lib/auth/accounts';
import { sendAuthTemplate, toWaNumber } from '@/lib/services/whatsapp';

const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN) || 5;
const GRANT_TTL_MIN = Number(process.env.OTP_GRANT_TTL_MIN) || 10;
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const RESEND_THROTTLE_SEC = Number(process.env.OTP_RESEND_THROTTLE_SEC) || 30;
const OTP_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'login_otp';
const OTP_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

export class OtpError extends Error {
  code: 'invalid_input' | 'otp_invalid' | 'otp_expired' | 'rate_limited';
  status: number;
  constructor(code: OtpError['code'], message: string) {
    super(message);
    this.code = code;
    this.status = code === 'rate_limited' ? 429 : code === 'otp_expired' ? 410 : code === 'invalid_input' ? 400 : 401;
  }
}

function minutesFromNow(min: number) {
  return new Date(Date.now() + min * 60_000);
}

/** Phase 1 — send an OTP. Silent no-op for numbers with no active account. */
export async function requestOtp(phoneRaw: string): Promise<{ ok: true }> {
  const phone = normalizePhone(phoneRaw);
  const wa = toWaNumber(phone);
  if (!wa) throw new OtpError('invalid_input', 'Enter a valid phone number.');

  // Never reveal whether a number is registered.
  if (!(await anyAccountForPhone(phone))) return { ok: true };

  // Throttle resends.
  const recent = await prisma.otpChallenge.findFirst({
    where: { phone, purpose: 'LOGIN', createdAt: { gt: new Date(Date.now() - RESEND_THROTTLE_SEC * 1000) } },
    select: { id: true },
  });
  if (recent) throw new OtpError('rate_limited', 'Please wait a moment before requesting another code.');

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await hashPassword(code);

  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({ where: { phone, purpose: 'LOGIN' } }),
    prisma.otpChallenge.create({
      data: { phone, purpose: 'LOGIN', codeHash, expiresAt: minutesFromNow(OTP_TTL_MIN) },
    }),
  ]);

  const res = await sendAuthTemplate({ to: wa, templateName: OTP_TEMPLATE, lang: OTP_LANG, code });
  if (!res.ok) {
    // Don't leave a live challenge the user can never satisfy.
    await prisma.otpChallenge.deleteMany({ where: { phone, purpose: 'LOGIN' } });
    console.error('[otp] WhatsApp send failed:', res.error);
    throw new OtpError('rate_limited', 'Could not send the code right now. Try again shortly.');
  }
  return { ok: true };
}

/** Phase 2 — verify the OTP, return a one-time grant token for set-pin. */
export async function verifyOtp(phoneRaw: string, code: string): Promise<{ grantToken: string; phone: string }> {
  const phone = normalizePhone(phoneRaw);
  if (!/^\d{6}$/.test(String(code || ''))) throw new OtpError('invalid_input', 'Enter the 6-digit code.');

  const row = await prisma.otpChallenge.findFirst({
    where: { phone, purpose: 'LOGIN' },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt < new Date()) {
    if (row) await prisma.otpChallenge.delete({ where: { id: row.id } });
    throw new OtpError('otp_expired', 'Code expired. Request a new one.');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.otpChallenge.delete({ where: { id: row.id } });
    throw new OtpError('otp_invalid', 'Too many attempts. Request a new code.');
  }
  if (!(await verifyPassword(String(code), row.codeHash))) {
    await prisma.otpChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new OtpError('otp_invalid', 'Incorrect code.');
  }

  // Correct — burn the OTP, mint a 10-min single-use grant.
  const grantToken = crypto.randomBytes(32).toString('base64url');
  const codeHash = await hashPassword(grantToken);
  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({ where: { phone, purpose: { in: ['LOGIN', 'SET_PIN'] } } }),
    prisma.otpChallenge.create({
      data: { phone, purpose: 'SET_PIN', codeHash, expiresAt: minutesFromNow(GRANT_TTL_MIN) },
    }),
  ]);

  return { grantToken, phone };
}

/** Spend a SET_PIN grant. Returns the normalized phone if valid, else throws. */
export async function consumeSetPinGrant(phoneRaw: string, grantToken: string): Promise<string> {
  const phone = normalizePhone(phoneRaw);
  if (!grantToken) throw new OtpError('otp_invalid', 'Verification required.');

  const row = await prisma.otpChallenge.findFirst({
    where: { phone, purpose: 'SET_PIN' },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt < new Date()) {
    if (row) await prisma.otpChallenge.delete({ where: { id: row.id } });
    throw new OtpError('otp_expired', 'Verification expired. Please verify again.');
  }
  if (!(await verifyPassword(grantToken, row.codeHash))) {
    throw new OtpError('otp_invalid', 'Verification failed. Please verify again.');
  }
  await prisma.otpChallenge.delete({ where: { id: row.id } });
  return phone;
}

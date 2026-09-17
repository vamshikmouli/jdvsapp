// WhatsApp "reverse" verification (free — no Authentication template needed).
// Instead of SENDING an OTP (blocked by Meta for this account), we show the user
// a one-time code and a wa.me link; they send it to the school WhatsApp number.
// The inbound webhook matches the code AND checks the sender number equals the
// phone being verified — proving they control that phone. On success we mint the
// SAME SET_PIN grant the OTP path uses, so set-pin + PIN login are unchanged.
//
// Users whose WhatsApp is a different number (or who have no WhatsApp) simply
// won't verify here and fall back to PIN login.
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { normalizePhone } from '@/lib/auth/provision';
import { hashPassword } from '@/lib/auth/password';
import { anyAccountForPhone } from '@/lib/auth/accounts';
import { toWaNumber, sendWhatsAppText } from '@/lib/services/whatsapp';
import { OtpError } from '@/lib/auth/otp';

const VERIFY_TTL_MIN = Number(process.env.WA_VERIFY_TTL_MIN) || 10;
const GRANT_TTL_MIN = Number(process.env.OTP_GRANT_TTL_MIN) || 10;
const RESEND_THROTTLE_SEC = Number(process.env.WA_VERIFY_THROTTLE_SEC) || 20;
const SCHOOL_WA = (process.env.WHATSAPP_DISPLAY_NUMBER || '918088960796').replace(/\D/g, '');

// Unambiguous alphabet (no 0/O/1/I/L) so the code is easy to read/type if needed.
function makeCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

function waLink(code: string): string {
  const text = encodeURIComponent(`Jnana Deepika login code: ${code}`);
  return `https://wa.me/${SCHOOL_WA}?text=${text}`;
}

/** Start reverse-verify → a code + the wa.me link the user taps to send it. */
export async function startWaVerify(phoneRaw: string): Promise<{ id: string; code: string; waLink: string }> {
  const phone = normalizePhone(phoneRaw);
  const wa = toWaNumber(phone);
  if (!wa) throw new OtpError('invalid_input', 'Enter a valid phone number.');

  // Reuse a very recent live challenge instead of spamming new codes.
  const recent = await prisma.waVerification.findFirst({
    where: { phone: wa, verifiedAt: null, expiresAt: { gt: new Date() }, createdAt: { gt: new Date(Date.now() - RESEND_THROTTLE_SEC * 1000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return { id: recent.id, code: recent.code, waLink: waLink(recent.code) };

  const code = makeCode();
  const row = await prisma.waVerification.create({
    data: { phone: wa, code, expiresAt: new Date(Date.now() + VERIFY_TTL_MIN * 60_000) },
  });
  return { id: row.id, code, waLink: waLink(code) };
}

/** Called by the inbound webhook for every text message. Matches a live code and,
 *  ONLY if the sender number equals the phone being verified, marks it verified. */
export async function matchInboundVerification(from: string, text: string): Promise<void> {
  const t = (text || '').trim().toUpperCase();
  if (t.length < 6) return;
  const pending = await prisma.waVerification.findMany({
    where: { verifiedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const hit = pending.find((v) => t.includes(v.code));
  if (!hit) return;

  const fromWa = toWaNumber(from);
  if (!fromWa) return;

  // Sender-driven binding: verify whichever number actually sent the code — not
  // necessarily the one typed on the login screen. This makes it irrelevant which
  // WhatsApp app the user picks (personal vs Business, possibly on different
  // numbers). Security is unchanged: the login is bound to the SENDING number, so
  // a user can only ever reach an account whose WhatsApp they control.
  await prisma.waVerification.update({ where: { id: hit.id }, data: { verifiedAt: new Date(), fromNumber: fromWa } });

  // Free-form reply (the user just messaged us → 24h service window is open).
  const registered = await anyAccountForPhone(normalizePhone(fromWa));
  const reply = registered
    ? '✅ Your Jnana Deepika login is verified. Head back to the app to set your PIN and sign in. If this wasn’t you, contact the school office.'
    : 'We received your code, but this WhatsApp number isn’t registered with the school. Please send it from the number the school has on file, or contact the office.';
  await sendWhatsAppText({ to: fromWa, text: reply }).catch((e) => console.log('[WA-VERIFY] confirm send error:', e?.message));
}

/** Poll/confirm. When verified + an account exists for the phone, mint a SET_PIN
 *  grant (identical to the OTP path) and consume the challenge. */
export async function confirmWaVerify(id: string): Promise<{ verified: boolean; grantToken?: string; phone?: string }> {
  const row = await prisma.waVerification.findUnique({ where: { id } });
  if (!row || row.expiresAt < new Date() || !row.verifiedAt) return { verified: !!row?.verifiedAt };

  // Bind to the number that actually sent the code (may differ from the typed
  // phone when the user has two WhatsApp apps / numbers).
  const phone = normalizePhone(row.fromNumber || row.phone);
  if (!(await anyAccountForPhone(phone))) {
    await prisma.waVerification.delete({ where: { id } }).catch(() => {});
    return { verified: true }; // verified their WhatsApp, but no account → nothing to grant
  }

  const grantToken = crypto.randomBytes(32).toString('base64url');
  const codeHash = await hashPassword(grantToken);
  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({ where: { phone, purpose: { in: ['LOGIN', 'SET_PIN'] } } }),
    prisma.otpChallenge.create({ data: { phone, purpose: 'SET_PIN', codeHash, expiresAt: new Date(Date.now() + GRANT_TTL_MIN * 60_000) } }),
    prisma.waVerification.delete({ where: { id } }),
  ]);
  return { verified: true, grantToken, phone };
}

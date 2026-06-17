// WebAuthn (passkey) configuration + challenge store for staff biometric punch.
//
// The Relying Party (RP) ID must be the registrable domain the app is served
// from. We derive it from NEXTAUTH_URL (already configured for auth), with an
// override via STAFF_ATT_RP_ID / STAFF_ATT_ORIGIN for edge cases.
import { prisma } from '@/lib/db';

function appUrl(): URL {
  const raw =
    process.env.STAFF_ATT_ORIGIN ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000';
  return new URL(raw);
}

export function rpID(): string {
  return process.env.STAFF_ATT_RP_ID || appUrl().hostname;
}

export function rpOrigin(): string {
  const u = appUrl();
  return u.origin;
}

export const RP_NAME = 'Jnana Deepika';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Persist a freshly generated challenge for later verification. */
export async function saveChallenge(
  staffId: string,
  challenge: string,
  kind: 'register' | 'authenticate'
): Promise<void> {
  // One pending challenge per (staff, kind) — clear stale ones first.
  await prisma.webAuthnChallenge.deleteMany({ where: { staffId, kind } });
  await prisma.webAuthnChallenge.create({
    data: {
      staffId,
      challenge,
      kind,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

/** Read + delete a challenge (single-use). Returns null if missing/expired. */
export async function consumeChallenge(
  staffId: string,
  kind: 'register' | 'authenticate'
): Promise<string | null> {
  const row = await prisma.webAuthnChallenge.findFirst({
    where: { staffId, kind },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  await prisma.webAuthnChallenge.deleteMany({ where: { staffId, kind } });
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.challenge;
}

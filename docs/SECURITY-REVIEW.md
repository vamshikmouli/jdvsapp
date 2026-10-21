# Security Review (Pre-VAPT) — Jnana Deepika School ERP

**Date:** 2026-10-21
**Type:** Internal static review — code + configuration + dependency audit (SAST-grade).
**Not covered:** Live DAST (OWASP ZAP on staging), VM/network/port/TLS scanning, and a
human penetration tester's business-logic + retest cycle. A CERT-In empanelled auditor's
signed report is still required for payment-gateway go-live.

**Stack:** Next.js (App Router) · Prisma 5 + PostgreSQL (Supabase) · NextAuth v4 · PM2 on Oracle VM.

---

## Overall verdict: strong security posture

No critical or high **code** vulnerabilities were found. All dependency CVEs were
remediated (see below). Three low-severity hardening items were identified; finding #1
has been fixed in this review.

---

## OWASP Top 10 coverage

| # | Area | Verdict |
|---|------|---------|
| A01 Broken Access Control | PASS — all 161 API routes carry an auth guard (`requireSession`/`requirePermission`/`getServerSession`/`getRequestUserId`); crons use `CRON_SECRET`; webhooks verify signatures. Parent & payment routes enforce per-object ownership (`guardianUserId`) — no IDOR. The 5 routes with no guard are intentionally public and safe. |
| A02 Cryptographic Failures | PASS — passwords/PINs hashed with bcrypt (12 rounds); OTP codes generated with `crypto.randomInt` and stored hashed; 32-byte CSPRNG grant tokens; HSTS enforced. |
| A03 Injection | PASS — Prisma parameterizes all queries; the single `$executeRaw` is a safe tagged template; no `eval`/`child_process`; no `dangerouslySetInnerHTML`. |
| A04 Insecure Design | PASS — OTP flow is enumeration-safe, resend-throttled, attempt-capped (burn), TTL-bound, single-use grant. |
| A05 Security Misconfiguration | PASS — strict CSP + full security-header set (HSTS, X-Frame DENY, nosniff, Referrer-Policy, Permissions-Policy); Image Optimizer scoped to Supabase; no CORS exposure; no secrets in client bundles (`NEXT_PUBLIC_` is only the VAPID public key). |
| A06 Vulnerable & Outdated Components | RESOLVED — production `npm audit` reduced from 10 CVEs to 0 (see Dependency remediation). |
| A07 Authentication Failures | PASS — account lockout after N failed attempts (`lockedUntil`), failed-login auditing (IP/UA), counters reset on success, session revocation via `UserSession`. |
| A08 Software & Data Integrity | PASS — payment webhook verifies the provider signature AND re-checks the provider status API before fulfilling; payment amounts are recomputed server-side (no client tampering). |
| A09 Logging & Monitoring | PASS — login + activity auditing; OTP codes and secrets are never logged. |
| A10 SSRF | PASS — Image Optimizer locked to `**.supabase.co`; `brand-assets` lists a fixed server-side folder; no user-controlled outbound fetch. |

---

## Findings

### 1. Upload accepted files by declared MIME type (SVG stored-XSS) — LOW — FIXED
`app/api/upload/route.ts` validated uploads with `file.type.startsWith('image/')`. That
type is client-declared, so (a) any file could be spoofed as an image, and (b)
`image/svg+xml` passed — and an SVG can embed `<script>`. Because uploads are served from a
**public** bucket, a malicious SVG (uploaded by a user with `STUDENTS_MANAGE`/`SETTINGS_MANAGE`)
would execute script in-origin when opened → stored XSS.

**Fix applied:** validation now reads the file's **magic bytes** and accepts only genuine
raster formats (JPEG/PNG/WebP/GIF); the extension and stored content-type are derived from
the real bytes. SVG/HTML/spoofed files are rejected.

### 2. Weak secret minimum (PIN/password `minLength: 4`) — LOW — OPEN
`lib/auth/password.ts` defaults to a 4-character minimum (phone numbers are the initial
password). Mitigated by account lockout. **Recommendation:** raise the minimum length, or
tighten the lockout threshold/duration, for staff/admin roles.

### 3. Long session, no idle timeout (`maxAge` ~1 year) — LOW — OPEN
`lib/auth/authOptions.ts` uses a ~1-year JWT session with no idle timeout. Mitigated by
deliberate session revocation (`UserSession`). **Recommendation:** add an idle timeout for
privileged (admin/accountant) roles.

### 4. CSP allows `'unsafe-inline' 'unsafe-eval'` in `script-src` — INFO — OPEN
A known Next.js constraint (inline hydration). Auditors commonly flag it. **Hardening path:**
nonce-based CSP.

---

## Dependency remediation (completed in this review cycle)

Production `npm audit`: **10 → 0** vulnerabilities.

| Package | Issue | Action |
|---------|-------|--------|
| `xlsx` (SheetJS) | Prototype pollution + ReDoS (no npm fix) | Swapped to patched SheetJS build `0.20.3` (CDN tarball). |
| `next-auth` | Homoglyph email bypass | Patched within range. |
| `@simplewebauthn/server` | Attestation trust-anchor | Patched within range. |
| `nanoid`, `brace-expansion`, `source-map-js` | DoS | Patched (non-breaking). |
| `postcss` | XSS in CSS stringify | Forced to `8.5.31` via `overrides`. |
| `uuid` (via `exceljs`) | Buffer bounds check | Forced to `11.1.1` via `overrides` (exceljs verified working). |
| `next` | Image Optimizer DoS (fix only in 15+) | Vector mitigated by scoping `remotePatterns` to Supabase; full fix via the Next 15 + React 19 upgrade (done on branch `next15-upgrade`, pending staging test + merge). |

**Config hardening:** `next.config.js` `images.remotePatterns` changed from `'**'` (any host)
to `'**.supabase.co'` — the app uses no `next/image`, so this closes the optimizer
proxy/SSRF/DoS surface with no functional impact.

---

## Deploy note

The security fixes live in `package.json` + `package-lock.json`. The usual
`git checkout -- package-lock.json` step must **not** run on the next deploy, or it will
wipe them; the VM must `npm install` so the patched versions actually install.

---

## Recommended next steps

1. Fix findings #2–#3 (secret length / idle timeout) — low effort.
2. Complete the Next 15 + React 19 upgrade: staging regression test (auth, payments, parent
   APIs, crons, fees), then merge and deploy.
3. Run a live DAST scan (OWASP ZAP) against a staging instance.
4. Engage a CERT-In empanelled auditor for the formal signed VAPT required for payment go-live.

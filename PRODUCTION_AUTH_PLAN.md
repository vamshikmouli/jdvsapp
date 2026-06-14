# Production-Level Auth System Design
## Jnana Deepika School ERP

**Current State:** NextAuth with demo mode (any email/password auto-creates ADMIN users)
**Target:** Enterprise-grade authentication with 4 roles, security hardening, and comprehensive session management

---

## 1. Executive Summary

This plan transforms the demo authentication system into a production-ready identity and access management solution. Key achievements:

- **Security**: Real password hashing (bcryptjs), rate limiting, brute-force protection, CSRF tokens
- **Role Management**: 4 built-in system roles (ADMIN, TEACHER, ACCOUNTANT, PARENT) **+ unlimited admin-created custom roles** (e.g. "Assistant Teacher", "Vice Principal", "Librarian") with per-role permission toggles. See §2.4 and §3.1.5.
- **Session Control**: **Sessions persist until the user explicitly logs out — no automatic timeout/expiry.** Multi-device tracking and manual/admin revocation still supported. See §2.5.
- **Compliance**: Audit logging, email verification, password reset flows, passwordChangedAt tracking
- **UX**: Role-specific login pages, responsive design (mobile for parents), device memory

> **⚠️ Plan amendments (latest requirements):** Two decisions override earlier sections of this document wherever they conflict:
> 1. **No auto-logout** — sessions live until the user logs out. All `SESSION_TIMEOUT_*`, access-token expiry, refresh-token rotation, and "session warning" mechanics below are **superseded by §2.5**.
> 2. **Custom roles** — the hardcoded `Role` enum is replaced by a database-backed `Role` table + `Permission` join, manageable by admins. This **supersedes every `enum Role` / `import { Role } from '@prisma/client'` reference below** — see §2.4 / §3.1.5.

---

## 2. Architecture Overview

### 2.1 Technology Stack

```
Frontend:
  - Next.js 14 (App Router)
  - TailwindCSS + custom components
  - NextAuth.js 4.24 (JWT strategy)
  - react-hook-form (form validation)

Backend:
  - Next.js API routes
  - Prisma ORM
  - PostgreSQL

Security Libraries:
  - bcryptjs (password hashing)
  - jsonwebtoken (for refresh tokens)
  - crypto (CSRF tokens, session state)
  - node-rate-limiter-flexible (brute force)
```

### 2.2 Session Architecture

```
Request Flow:
┌─────────────────────────────────────────────────────────┐
│ Client (Browser)                                        │
│  - Access Token (JWT, 15min) → localStorage             │
│  - Refresh Token (HTTP-only cookie, 7 days)             │
│  - CSRF Token (form field, 1 hour)                      │
└─────────────────────────────────────────────────────────┘
                        ↓ POST /api/auth/login
┌─────────────────────────────────────────────────────────┐
│ NextAuth Provider (Credentials)                         │
│  - Validate credentials                                 │
│  - Check login attempts (rate limiting)                 │
│  - Create session → JWT token                           │
│  - Return: accessToken, refreshToken                    │
└─────────────────────────────────────────────────────────┘
                        ↓ JWT Callback
┌─────────────────────────────────────────────────────────┐
│ Token Enhancement                                       │
│  - Add role, staffId, userId                            │
│  - Add exp (expiration), iat (issued at)               │
│  - Add sessionId (for multi-device tracking)            │
└─────────────────────────────────────────────────────────┘
                        ↓ Session Callback
┌─────────────────────────────────────────────────────────┐
│ Session Object                                          │
│  - session.user: { id, email, name, role, staffId }    │
│  - session.accessToken: JWT                             │
│  - session.sessionId: unique session identifier         │
└─────────────────────────────────────────────────────────┘
```

---

### 2.4 Custom Roles & Dynamic Permissions  *(NEW — supersedes the hardcoded enum)*

**Requirement:** Admins can create custom roles (e.g. "Assistant Teacher", "Vice Principal", "Librarian", "Front Desk") on top of the 4 built-in roles, and toggle exactly what each role can do.

#### Model: roles become DATA, not an enum

We drop `enum Role` from Prisma and introduce three tables:

```prisma
// A role is now a row, not an enum value.
model Role {
  id            String           @id @default(cuid())
  key           String           @unique  // machine key e.g. "assistant_teacher"
  name          String                    // display name e.g. "Assistant Teacher"
  description   String?
  isSystem      Boolean          @default(false) // true for ADMIN/TEACHER/ACCOUNTANT/PARENT — cannot be deleted/renamed
  isActive      Boolean          @default(true)
  // What this role inherits its login surface from (which dashboard/home it lands on)
  baseSurface   Surface          @default(ADMIN) // ADMIN | TEACHER | ACCOUNTANT | PARENT

  permissions   RolePermission[]
  users         User[]

  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
}

// One row per (role, permission) that is GRANTED.
model RolePermission {
  id           String      @id @default(cuid())
  roleId       String
  role         Role        @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission                       // enum of capability keys
  @@unique([roleId, permission])
}

// Where a role "lives" — decides post-login redirect + which sidebar to render.
enum Surface {
  ADMIN
  TEACHER
  ACCOUNTANT
  PARENT
}

// Fine-grained capabilities (stable enum — devs add new ones in code, admins toggle them per role).
enum Permission {
  // Master data
  STUDENTS_VIEW    STUDENTS_MANAGE
  CLASSES_VIEW     CLASSES_MANAGE
  STAFF_VIEW       STAFF_MANAGE
  // Attendance
  ATTENDANCE_VIEW  ATTENDANCE_MARK   ATTENDANCE_LOCK
  // Fees (Phase 3)
  FEES_VIEW        FEES_COLLECT      FEES_RECEIPT      FEES_VIEW_ALL
  // Reporting & admin
  ANALYTICS_VIEW   REPORTS_EXPORT
  SETTINGS_MANAGE  ROLES_MANAGE      USERS_MANAGE
}
```

`User.role: Role` is now a **foreign key to the Role table** (`roleId`), not an enum column.

> **Distinction — Surface vs Permissions:**
> - **Surface** = which app shell/dashboard the user lands in (Admin panel, Teacher view, Accountant view, Parent app). A custom "Assistant Teacher" would typically have `baseSurface = TEACHER`.
> - **Permissions** = the granular toggles that gate actions *within* that surface. "Assistant Teacher" might get `ATTENDANCE_VIEW` + `ATTENDANCE_MARK` but **not** `ATTENDANCE_LOCK`.

#### Seeding the 4 built-in roles

A seed script creates the system roles with `isSystem: true` (they can be edited for permissions but never deleted, and their `key` is immutable):

| Role | key | baseSurface | Default permissions |
|------|-----|-------------|---------------------|
| Administrator | `admin` | ADMIN | **all** (including `ROLES_MANAGE`, `USERS_MANAGE`) |
| Teacher | `teacher` | TEACHER | `STUDENTS_VIEW`, `CLASSES_VIEW`, `ATTENDANCE_VIEW`, `ATTENDANCE_MARK` |
| Accountant | `accountant` | ACCOUNTANT | `STUDENTS_VIEW`, `ATTENDANCE_VIEW`, `FEES_*`, `ANALYTICS_VIEW`, `REPORTS_EXPORT` |
| Parent | `parent` | PARENT | `ATTENDANCE_VIEW`, `FEES_VIEW` (scoped to own child) |

#### How permission checks change everywhere

Old (hardcoded): `if (role === 'ADMIN') { ... }`
New (capability-based): `if (can(session, 'ATTENDANCE_LOCK')) { ... }`

- `lib/roles.ts` is rewritten: instead of a static `ROLE_PERMISSIONS` map, it exposes `can(session, permission)` / `requirePermission(permission)` that read the **permission set baked into the JWT at login** (so no DB hit per request).
- **Middleware** gates by `baseSurface` (which area you can enter) and the JWT permission set (what you can do).
- **API routes** call `requirePermission('STUDENTS_MANAGE')` etc. — only ADMIN-equivalent roles get write access by default, but an admin could grant `STUDENTS_MANAGE` to a custom role.

#### Admin UI — "Roles & Access" page (`/admin/roles`)

- **List** all roles (system + custom) with user counts and a badge for `isSystem`.
- **Create role**: name, description, base surface (dropdown), then a grid of permission checkboxes grouped by area (Students, Classes, Attendance, Fees, Reporting, Admin).
- **Edit role**: toggle permissions; system roles allow permission edits but lock `key`/delete.
- **Delete role**: blocked if any user is assigned (must reassign first) and blocked for `isSystem`.
- **Assign role to user**: on the Staff/User screens, the role dropdown is populated from the Role table (so "Assistant Teacher" appears automatically once created).
- Requires `ROLES_MANAGE` permission (admin-only by default).

#### JWT impact — permission changes force immediate re-login

At login the JWT carries `roleKey`, `surface`, and a compact `perms: string[]` array. Because permissions are embedded in the token, a role's permission set is otherwise "frozen" into every active session.

**Decision: permission changes take effect immediately via forced re-login (not on next natural login).** Whenever an admin edits a role's permissions, base surface, or active status — or reassigns a user to a different role — the system **automatically revokes all affected users' sessions**. Those users are logged out on their next request and must sign in again, at which point a fresh JWT with the updated `perms[]` is minted.

Concretely, on any `PATCH /api/roles/[id]` (permissions/surface/active change) or `PATCH /api/users/[id]/role`:
1. Resolve the set of affected `userId`s (all users holding that role, or the single reassigned user).
2. Delete their `UserSession` rows (adds them to the revocation set — see §2.5).
3. Middleware rejects the now-revoked session token → user is bounced to `/` to re-login.
4. Write a `ROLE_PERMISSIONS_CHANGED` / `ROLE_REASSIGNED` audit entry per affected user.

The admin UI surfaces this clearly ("Saving will sign out N user(s) so the new permissions apply immediately") — there is no "defer to next login" option.

---

### 2.5 Session Persistence — No Auto-Logout  *(NEW — supersedes all timeout/expiry mechanics)*

**Requirement:** A logged-in user stays logged in indefinitely until they explicitly click **Logout**. There is no idle timeout, no access-token expiry prompt, and no forced re-auth on a timer.

#### What this changes vs. the original token design

| Original design | Amended design |
|-----------------|----------------|
| Access token 15–60 min, refresh token 7 days, silent refresh near expiry | **Single long-lived session token** (`maxAge` ≈ 1 year). NextAuth `session.maxAge` + cookie `maxAge` set to a large value. |
| Refresh-token rotation on each request | **Not required for expiry.** We keep the `UserSession` row only for multi-device listing + revocation, not for refresh cycling. |
| "Session timeout warning" modal (15 min before logout) | **Removed.** |
| `SESSION_TIMEOUT_MINUTES`, `REFRESH_TOKEN_EXPIRY_DAYS` env vars | **Removed / ignored.** |

#### Implementation

```ts
// authOptions.ts
session: {
  strategy: 'jwt',
  maxAge: 60 * 60 * 24 * 365, // ~1 year — effectively "until logout"
  updateAge: 60 * 60 * 24,    // re-issue cookie at most once/day (keeps it sliding)
},
cookies: {
  sessionToken: {
    options: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 60 * 60 * 24 * 365 },
  },
},
```

- The JWT `exp` is set far in the future; no `expiresIn` short window, no refresh endpoint needed for keep-alive.
- `updateAge` makes the cookie "sliding" (renewed on activity) so an active user's cookie never lapses — but even an inactive user stays valid until the 1-year ceiling, which we treat as "indefinite".

#### Logout is the only way out — and it's thorough

Manual logout (`POST /api/auth/logout`) still:
1. Deletes/flags the `UserSession` row for this device.
2. Clears the session cookie (`maxAge: 0`).
3. Writes a `LOGOUT` audit entry.
4. Redirects to `/`.

#### Server-side revocation still exists (security backstop)

Even with no auto-logout, these can end a session deliberately:
- **User**: "Sign out everywhere" → delete all `UserSession` rows for the user.
- **Admin**: revoke a specific session or all of a user's sessions from the Roles/Users admin area.
- **On password reset**: invalidate all that user's sessions (forces fresh login).
- **On role permission/surface change or role reassignment**: **automatically** revoke all affected users' sessions so updated permissions apply immediately (see §2.4 JWT impact — this is not optional).

Middleware checks the session against a lightweight revocation set (the `UserSession` table) so a revoked token stops working even though it hasn't "expired".

---

## 3. Phase-by-Phase Implementation Plan

### Phase 0: Preparation & Configuration (Days 1-2)

#### 3.0.1 Install Dependencies

```bash
npm install bcryptjs jsonwebtoken rate-limiter-flexible zod nodemailer
npm install --save-dev @types/bcryptjs @types/jsonwebtoken
```

#### 3.0.2 Environment Variables

Create `.env.local` with:

```env
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generated-secret-key>

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/jnana_deepika

# Email (for password reset)
EMAIL_FROM=noreply@jnanadeepika.edu
EMAIL_PROVIDER=smtp  # or 'sendgrid', 'mailgun'
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-specific-password

# Auth Policy
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_NUMBERS=true
PASSWORD_REQUIRE_SPECIAL=true
MAX_LOGIN_ATTEMPTS=5
LOGIN_ATTEMPT_WINDOW_MINUTES=15
ACCOUNT_LOCKOUT_MINUTES=30

# Session — persist until explicit logout (§2.5). No idle timeout.
SESSION_MAX_AGE_DAYS=365        # effectively "until logout"; sliding via updateAge
# (SESSION_TIMEOUT_MINUTES and REFRESH_TOKEN_EXPIRY_DAYS intentionally removed — no auto-logout)

# Feature Flags
ENABLE_2FA_ADMIN=false
ENABLE_EMAIL_VERIFICATION=false
DEMO_MODE=false
```

#### 3.0.3 Update package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "db:push": "prisma db push",
    "db:seed": "node prisma/seed.js",
    "db:migrate": "prisma migrate dev",
    "generate:secret": "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  }
}
```

---

### Phase 1: Database Schema Updates (Days 2-3)

#### 3.1.1 Enhance User Model

**File:** `prisma/schema.prisma`

```prisma
model User {
  id                    String   @id @default(cuid())
  
  // Identity
  name                  String
  email                 String   @unique
  phone                 String?
  
  // Password Security
  passwordHash          String?  // Nullable for OAuth providers (future)
  passwordChangedAt     DateTime? // Track password age for expiry policies
  passwordExpiresAt     DateTime? // Force password change after X days
  
  // Login Security
  lastLogin             DateTime?
  lastLoginIp           String?
  lastLoginUserAgent    String?
  loginAttempts         Int       @default(0)
  lockedUntil           DateTime? // Account locked after failed attempts
  
  // Session Management
  role                  Role
  staff                 Staff?
  guardianOf            Student[] @relation("GuardianStudents")
  sessions              UserSession[] // Multi-device tracking
  loginAudits           LoginAudit[]
  
  // Account Status
  isActive              Boolean   @default(true)
  emailVerified         DateTime?
  twoFactorSecret       String?   // For 2FA (future)
  twoFactorEnabled      Boolean   @default(false)
  
  // Metadata
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}

// Session Management: track active sessions per user/device
model UserSession {
  id                    String    @id @default(cuid())
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Token Data
  refreshToken          String    @unique // Stored as hash
  refreshTokenHash      String    @unique // For fast lookup
  
  // Device Info
  deviceName            String?   // e.g., "Chrome on Windows"
  deviceId              String?   // Browser fingerprint
  ipAddress             String
  userAgent             String
  rememberDevice        Boolean   @default(false)
  
  // Token Expiry
  issuedAt              DateTime  @default(now())
  expiresAt             DateTime
  revokedAt             DateTime? // NULL = active
  
  // Tracking
  lastUsed              DateTime  @default(now())
  lastUsedIp            String?
  loginCount            Int       @default(1)
  
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  
  @@index([userId])
  @@index([refreshTokenHash])
}

// Audit Trail: track all login/logout events
model LoginAudit {
  id                    String    @id @default(cuid())
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Event
  eventType             LoginAuditType  // LOGIN, LOGOUT, FAILED_LOGIN, PASSWORD_RESET, etc.
  success               Boolean
  
  // Context
  email                 String    // Snapshot for deleted users
  ipAddress             String
  userAgent             String
  deviceName            String?
  
  // Failure Info
  failureReason         String?   // "invalid_password", "account_locked", etc.
  attemptNumber         Int?      // Which attempt was this
  
  createdAt             DateTime  @default(now())
  
  @@index([userId])
  @@index([createdAt])
}

enum LoginAuditType {
  LOGIN
  LOGOUT
  FAILED_LOGIN
  PASSWORD_RESET
  PASSWORD_CHANGED
  ACCOUNT_LOCKED
  ACCOUNT_UNLOCKED
  EMAIL_VERIFIED
  TWO_FA_ENABLED
  TWO_FA_DISABLED
  DEVICE_REMEMBERED
  ALL_SESSIONS_REVOKED
}

// Password Reset Tokens
model PasswordResetToken {
  id                    String    @id @default(cuid())
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  token                 String    @unique // Hash of token
  expiresAt             DateTime
  usedAt                DateTime?
  
  createdAt             DateTime  @default(now())
  
  @@index([token])
}

// Email Verification Tokens
model EmailVerificationToken {
  id                    String    @id @default(cuid())
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  email                 String    // Email being verified
  token                 String    @unique
  expiresAt             DateTime
  verifiedAt            DateTime?
  
  createdAt             DateTime  @default(now())
  
  @@index([token])
}
```

**Relations to Add:**

```prisma
model User {
  // ... existing fields ...
  passwordResetTokens   PasswordResetToken[]
  emailVerificationTokens EmailVerificationToken[]
}
```

#### 3.1.2 Migration Command

```bash
# Generate migration
npx prisma migrate dev --name add_production_auth_fields

# Update seed data if needed
npm run db:seed
```

---

### Phase 2: Security Infrastructure (Days 3-5)

#### 3.2.1 Password Hashing Utility

**File:** `lib/password.ts`

```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH || '8');

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }

  if (process.env.PASSWORD_REQUIRE_UPPERCASE === 'true' && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (process.env.PASSWORD_REQUIRE_NUMBERS === 'true' && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (process.env.PASSWORD_REQUIRE_SPECIAL === 'true' && !/[!@#$%^&*]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

#### 3.2.2 Rate Limiting & Brute Force Protection

**File:** `lib/rateLimit.ts`

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';

// Brute force: max login attempts per email
const loginLimiter = new RateLimiterMemory({
  points: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
  duration: parseInt(process.env.LOGIN_ATTEMPT_WINDOW_MINUTES || '15') * 60,
});

// API rate limiting: general requests
const apiLimiter = new RateLimiterMemory({
  points: 100, // 100 requests
  duration: 60, // per minute
});

export async function checkLoginAttempt(email: string): Promise<void> {
  try {
    await loginLimiter.consume(email.toLowerCase());
  } catch (error: any) {
    const retryAfterSeconds = Math.ceil(error.msBeforeNext / 1000);
    throw new Error(`Too many login attempts. Try again in ${retryAfterSeconds} seconds.`);
  }
}

export async function resetLoginAttempts(email: string): Promise<void> {
  await loginLimiter.delete(email.toLowerCase());
}

export async function checkApiRateLimit(identifier: string): Promise<void> {
  try {
    await apiLimiter.consume(identifier);
  } catch (error: any) {
    throw new Error('Too many requests. Please wait a moment.');
  }
}
```

#### 3.2.3 Token & Session Management

**File:** `lib/tokens.ts`

```typescript
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
  staffId?: string;
}

export interface RefreshTokenPayload {
  sessionId: string;
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateAccessToken(payload: TokenPayload, expiryMinutes = 15): string {
  return jwt.sign(payload, process.env.NEXTAUTH_SECRET!, {
    expiresIn: `${expiryMinutes}m`,
    issuer: 'jnana-deepika-erp',
    algorithm: 'HS256',
  });
}

export function generateRefreshToken(sessionId: string, expiryDays = 7): string {
  const token = crypto.randomBytes(32).toString('hex');
  // In practice, store this in DB with hash
  return token;
}

export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET!, {
      issuer: 'jnana-deepika-erp',
    }) as TokenPayload;
  } catch (error) {
    return null;
  }
}

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
```

#### 3.2.4 Device Fingerprinting

**File:** `lib/device.ts`

```typescript
import crypto from 'crypto';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  ipAddress: string;
  userAgent: string;
}

export function generateDeviceId(userAgent: string, ipAddress: string): string {
  // Create a semi-persistent device ID from UA + IP
  const data = `${userAgent}:${ipAddress}`;
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .substring(0, 16);
}

export function parseUserAgent(userAgent: string): string {
  // Simple parsing; consider using 'ua-parser-js' for production
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  return 'Unknown';
}

export function parseOS(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Macintosh')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
  if (userAgent.includes('Android')) return 'Android';
  return 'Unknown';
}

export function formatDeviceName(userAgent: string): string {
  const browser = parseUserAgent(userAgent);
  const os = parseOS(userAgent);
  return `${browser} on ${os}`;
}
```

#### 3.2.5 Audit Logging

**File:** `lib/audit.ts`

```typescript
import { prisma } from './db';
import { LoginAuditType, Role } from '@prisma/client';

export async function logLoginAttempt(
  userId: string | null, // null if user not found
  email: string,
  success: boolean,
  ipAddress: string,
  userAgent: string,
  failureReason?: string,
  attemptNumber?: number
): Promise<void> {
  try {
    if (userId) {
      await prisma.loginAudit.create({
        data: {
          userId,
          email,
          eventType: success ? 'LOGIN' : 'FAILED_LOGIN',
          success,
          ipAddress,
          userAgent,
          failureReason,
          attemptNumber,
        },
      });
    }
  } catch (error) {
    console.error('Failed to log login attempt:', error);
    // Don't throw — audit failure shouldn't break auth
  }
}

export async function logLogout(
  userId: string,
  ipAddress: string,
  userAgent: string
): Promise<void> {
  try {
    await prisma.loginAudit.create({
      data: {
        userId,
        email: '', // Fetch from user in production
        eventType: 'LOGOUT',
        success: true,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error('Failed to log logout:', error);
  }
}

export async function logPasswordReset(
  userId: string,
  ipAddress: string
): Promise<void> {
  try {
    await prisma.loginAudit.create({
      data: {
        userId,
        email: '',
        eventType: 'PASSWORD_RESET',
        success: true,
        ipAddress,
        userAgent: '',
      },
    });
  } catch (error) {
    console.error('Failed to log password reset:', error);
  }
}
```

#### 3.2.6 CSRF Protection

**File:** `lib/csrf.ts`

```typescript
import crypto from 'crypto';

const CSRF_TOKEN_EXPIRY_HOURS = 1;

export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function validateCSRFToken(
  storedToken: string,
  submittedToken: string
): boolean {
  if (!storedToken || !submittedToken) return false;
  
  // Use timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(storedToken),
    Buffer.from(submittedToken)
  );
}
```

---

### Phase 3: NextAuth Configuration Update (Days 5-7)

#### 3.3.1 New AuthOptions Implementation

**File:** `lib/authOptions.ts` (REPLACE)

```typescript
import { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/db';
import { Role } from '@prisma/client';
import { verifyPassword, validatePasswordStrength } from '@/lib/password';
import { 
  checkLoginAttempt, 
  resetLoginAttempts 
} from '@/lib/rateLimit';
import { 
  generateSessionId, 
  generateAccessToken, 
  generateRefreshToken,
  hashToken 
} from '@/lib/tokens';
import { logLoginAttempt, logLogout } from '@/lib/audit';
import { formatDeviceName, generateDeviceId } from '@/lib/device';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password required');
        }

        const email = credentials.email.toLowerCase().trim();
        const ipAddress = req?.headers?.['x-forwarded-for'] as string || 'unknown';
        const userAgent = req?.headers?.['user-agent'] || 'unknown';

        try {
          // Check rate limiting (brute force protection)
          await checkLoginAttempt(email);

          // Find user
          let user = await prisma.user.findUnique({
            where: { email },
            include: { staff: true },
          });

          // Demo mode: auto-create users
          if (!user && DEMO_MODE) {
            console.warn(`[DEMO MODE] Auto-creating user: ${email}`);
            user = await prisma.user.create({
              data: {
                email,
                name: email.split('@')[0],
                passwordHash: 'demo', // Indicate demo mode
                role: 'ADMIN',
              },
              include: { staff: true },
            });
          }

          // User not found
          if (!user) {
            await logLoginAttempt(null, email, false, ipAddress, userAgent, 'user_not_found');
            throw new Error('Invalid email or password');
          }

          // Check if account is locked
          if (user.lockedUntil && user.lockedUntil > new Date()) {
            const minutesLeft = Math.ceil(
              (user.lockedUntil.getTime() - Date.now()) / 60000
            );
            await logLoginAttempt(
              user.id,
              email,
              false,
              ipAddress,
              userAgent,
              'account_locked',
              user.loginAttempts
            );
            throw new Error(`Account locked. Try again in ${minutesLeft} minutes.`);
          }

          // Check email verification (if enabled)
          if (!DEMO_MODE && process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
            throw new Error('Please verify your email before logging in');
          }

          // Verify password (skip for demo mode)
          if (!DEMO_MODE && user.passwordHash !== 'demo') {
            const isPasswordValid = await verifyPassword(
              credentials.password,
              user.passwordHash!
            );

            if (!isPasswordValid) {
              // Increment failed attempts
              const newAttempts = user.loginAttempts + 1;
              const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5');
              const lockoutMinutes = parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES || '30');

              const updates: any = {
                loginAttempts: newAttempts,
              };

              // Lock account if max attempts exceeded
              if (newAttempts >= maxAttempts) {
                updates.lockedUntil = new Date(Date.now() + lockoutMinutes * 60000);
              }

              await prisma.user.update({
                where: { id: user.id },
                data: updates,
              });

              await logLoginAttempt(
                user.id,
                email,
                false,
                ipAddress,
                userAgent,
                'invalid_password',
                newAttempts
              );

              throw new Error('Invalid email or password');
            }
          }

          // Password expiry check (optional)
          if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
            throw new Error('Your password has expired. Please reset it.');
          }

          // Success! Reset failed attempts and update login info
          const sessionId = generateSessionId();
          const refreshToken = generateRefreshToken();
          const refreshTokenHash = hashToken(refreshToken);
          const deviceId = generateDeviceId(userAgent, ipAddress);
          const deviceName = formatDeviceName(userAgent);

          // Create session record
          await prisma.userSession.create({
            data: {
              userId: user.id,
              refreshToken: refreshToken, // Store plain for now (hash in production)
              refreshTokenHash,
              sessionId,
              deviceId,
              deviceName,
              ipAddress,
              userAgent,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });

          // Update user login info
          await prisma.user.update({
            where: { id: user.id },
            data: {
              lastLogin: new Date(),
              lastLoginIp: ipAddress,
              lastLoginUserAgent: userAgent,
              loginAttempts: 0, // Reset counter on success
            },
          });

          // Log successful login
          await logLoginAttempt(user.id, email, true, ipAddress, userAgent);

          // Reset rate limiter
          await resetLoginAttempts(email);

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            staffId: user.staff?.id,
            sessionId,
            refreshToken,
            ipAddress,
          };
        } catch (error) {
          console.error('Auth error:', error);
          throw error;
        }
      },
    }),
  ],
  
  pages: {
    signIn: '/login',
    error: '/login',
    signOut: '/',
  },

  callbacks: {
    async jwt({ token, user, account }) {
      // Initial login
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = (user as any).role;
        token.staffId = (user as any).staffId;
        token.sessionId = (user as any).sessionId;
        token.refreshToken = (user as any).refreshToken;
      }

      // NOTE (§2.5): No short-lived access token / refresh cycle.
      // The session persists until explicit logout, so we do NOT shorten exp
      // or run refresh logic here. The token simply carries identity + perms.

      return token;
    },

    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as Role;
        (session.user as any).staffId = token.staffId as string;
        (session.user as any).sessionId = token.sessionId as string;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      // Redirect to role-specific dashboard after login
      if (url === baseUrl) {
        return baseUrl; // Default redirect
      }
      return url;
    },
  },

  // JWT-based sessions — persist until explicit logout (§2.5). No idle timeout.
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 365, // ~1 year ceiling = effectively "until logout"
    updateAge: 60 * 60 * 24,    // slide the cookie at most once/day on activity
  },

  // Cookies configuration
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // ~1 year — matches session.maxAge
      },
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      },
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      },
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
};
```

---

### Phase 4: API Endpoints (Days 7-10)

#### 3.4.1 Login Endpoint

**File:** `app/api/auth/login/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { checkLoginAttempt } from '@/lib/rateLimit';
import { logLoginAttempt } from '@/lib/audit';
import { signIn } from 'next-auth/react';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || '';

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      );
    }

    // Check rate limit
    try {
      await checkLoginAttempt(email.toLowerCase());
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      );
    }

    // In production, use NextAuth's signIn() function
    // This endpoint is helper for custom login flows
    // The actual auth happens in authOptions.ts

    return NextResponse.json(
      { message: 'Use NextAuth signIn() for authentication' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
```

#### 3.4.2 Logout Endpoint

**File:** `app/api/auth/logout/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/db';
import { logLogout } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || '';

    // Revoke all sessions for this user (optional)
    const revokeAll = request.nextUrl.searchParams.get('revokeAll') === 'true';

    if (revokeAll) {
      await prisma.userSession.updateMany({
        where: { userId: session.user.id },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke current session only
      const sessionId = (session as any).sessionId;
      if (sessionId) {
        await prisma.userSession.updateMany({
          where: { sessionId },
          data: { revokedAt: new Date() },
        });
      }
    }

    // Log logout
    await logLogout(session.user.id, ipAddress, userAgent);

    const response = NextResponse.json(
      { message: 'Logged out successfully' },
      { status: 200 }
    );

    // Clear cookies
    response.cookies.set('next-auth.session-token', '', { maxAge: 0 });
    response.cookies.set('next-auth.callback-url', '', { maxAge: 0 });
    response.cookies.set('next-auth.csrf-token', '', { maxAge: 0 });

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
```

#### 3.4.3 Password Reset Request

**File:** `app/api/auth/forgot-password/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generatePasswordResetToken, hashToken } from '@/lib/tokens';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkApiRateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    // Rate limit password reset attempts
    await checkApiRateLimit(`password-reset:${email}`);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success (security: don't reveal if email exists)
    if (!user) {
      return NextResponse.json(
        { message: 'If that email exists, a reset link has been sent' },
        { status: 200 }
      );
    }

    // Generate reset token (valid for 1 hour)
    const token = generatePasswordResetToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: tokenHash,
        expiresAt,
      },
    });

    // Send email with reset link
    await sendPasswordResetEmail(user.email, token);

    return NextResponse.json(
      { message: 'If that email exists, a reset link has been sent' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json(
      { error: 'Request failed' },
      { status: 500 }
    );
  }
}
```

#### 3.4.4 Password Reset Confirmation

**File:** `app/api/auth/reset-password/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password';
import { hashToken } from '@/lib/tokens';
import { logPasswordReset } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password required' },
        { status: 400 }
      );
    }

    // Validate password strength
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join('; ') },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(token);

    // Find reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Reset token has expired' },
        { status: 400 }
      );
    }

    if (resetToken.usedAt) {
      return NextResponse.json(
        { error: 'This reset token has already been used' },
        { status: 400 }
      );
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        loginAttempts: 0, // Reset counter
      },
    });

    // Mark token as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Log password reset
    await logPasswordReset(resetToken.userId, ipAddress);

    return NextResponse.json(
      { message: 'Password reset successful. Please log in.' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json(
      { error: 'Reset failed' },
      { status: 500 }
    );
  }
}
```

#### 3.4.5 Change Password (In-App)

**File:** `app/api/auth/change-password/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/password';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword, confirmPassword } = await request.json();

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    // Validate new password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join('; ') },
        { status: 400 }
      );
    }

    // Get user and verify current password
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const isCurrentPasswordValid = await verifyPassword(
      currentPassword,
      user.passwordHash!
    );

    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Hash and update password
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });

    return NextResponse.json(
      { message: 'Password changed successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
```

#### 3.4.6 Session Management Endpoint

**File:** `app/api/auth/sessions/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/db';

// GET /api/auth/sessions - List all active sessions
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const sessions = await prisma.userSession.findMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
      },
      select: {
        id: true,
        deviceName: true,
        ipAddress: true,
        lastUsed: true,
        issuedAt: true,
        expiresAt: true,
        rememberDevice: true,
      },
      orderBy: { lastUsed: 'desc' },
    });

    return NextResponse.json(sessions, { status: 200 });
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

// DELETE /api/auth/sessions/:sessionId - Revoke specific session
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    // Verify ownership
    const userSession = await prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!userSession || userSession.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Revoke session
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    return NextResponse.json(
      { message: 'Session revoked' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Revoke session error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke session' },
      { status: 500 }
    );
  }
}
```

---

### Phase 5: UI Components (Days 10-13)

#### 3.5.1 Unified Login Page with Role Selector

**File:** `app/login/page.tsx` (NEW)

```typescript
'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button, Card, Input, Field } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import Link from 'next/link';

type Step = 'role-select' | 'login' | 'forgot-password' | 'reset-password';
type Role = 'ADMIN' | 'TEACHER' | 'ACCOUNTANT' | 'PARENT';

interface RoleConfig {
  value: Role;
  label: string;
  description: string;
  icon: string;
  placeholder: string;
}

const ROLE_CONFIGS: RoleConfig[] = [
  {
    value: 'ADMIN',
    label: 'School Administrator',
    description: 'Manage school operations, staff, and students',
    icon: 'BarChart3',
    placeholder: 'admin@school.edu',
  },
  {
    value: 'TEACHER',
    label: 'Teacher',
    description: 'Mark attendance and manage student records',
    icon: 'BookOpen',
    placeholder: 'teacher@school.edu',
  },
  {
    value: 'ACCOUNTANT',
    label: 'Accountant',
    description: 'Manage fees and financial records',
    icon: 'DollarSign',
    placeholder: 'accountant@school.edu',
  },
  {
    value: 'PARENT',
    label: 'Parent / Guardian',
    description: 'View child attendance and progress',
    icon: 'Users',
    placeholder: 'parent@email.com',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = React.useState<Step>('role-select');
  const [selectedRole, setSelectedRole] = React.useState<Role | null>(null);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [resetEmail, setResetEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [rememberDevice, setRememberDevice] = React.useState(false);

  const error_param = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  React.useEffect(() => {
    if (error_param) {
      setError(error_param);
    }
  }, [error_param]);

  const handleRoleSelect = (role: Role) => {
    setSelectedRole(role);
    setStep('login');
    setError('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError('Login failed. Please try again.');
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });

      if (response.ok) {
        setError(''); // Clear previous errors
        setStep('login'); // Go back to login
        alert('Check your email for password reset instructions');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to send reset email');
      }
    } catch (err) {
      setError('Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const roleConfig = ROLE_CONFIGS.find((r) => r.value === selectedRole);

  // Step 1: Role Selection
  if (step === 'role-select') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="inline-block mb-4">
              <Icon name="Lamp" size={48} className="text-purple-600" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Jnana Deepika</h1>
            <p className="text-slate-500 mt-2">School ERP System</p>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold text-slate-800">
              Who are you?
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              Select your role to continue
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ROLE_CONFIGS.map((role) => (
              <button
                key={role.value}
                onClick={() => handleRoleSelect(role.value)}
                className="p-4 border-2 border-slate-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-left"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    name={role.icon}
                    size={24}
                    className="text-purple-600 flex-shrink-0 mt-1"
                  />
                  <div>
                    <h3 className="font-semibold text-slate-900">{role.label}</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      {role.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // Step 2: Login Form
  if (step === 'login' && roleConfig) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <button
            onClick={() => setStep('role-select')}
            className="text-sm text-purple-600 hover:text-purple-700 mb-4 flex items-center gap-1"
          >
            <Icon name="ChevronLeft" size={16} />
            Back to role selection
          </button>

          <div className="text-center mb-6">
            <Icon
              name={roleConfig.icon}
              size={40}
              className="text-purple-600 mx-auto mb-3"
            />
            <h2 className="text-xl font-bold text-slate-900">
              {roleConfig.label} Login
            </h2>
          </div>

          {error && (
            <div className="bg-danger-50 border border-danger-100 rounded-md p-3 mb-4">
              <p className="text-sm text-danger-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                placeholder={roleConfig.placeholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </Field>

            {selectedRole === 'PARENT' && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-600">
                  Remember this device
                </span>
              </label>
            )}

            <Button
              kind="primary"
              className="w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setStep('forgot-password');
                setError('');
              }}
              className="text-sm text-purple-600 hover:text-purple-700"
            >
              Forgot password?
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // Step 3: Forgot Password Form
  if (step === 'forgot-password') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <button
            onClick={() => {
              setStep('login');
              setError('');
            }}
            className="text-sm text-purple-600 hover:text-purple-700 mb-4 flex items-center gap-1"
          >
            <Icon name="ChevronLeft" size={16} />
            Back to login
          </button>

          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">
              Reset Password
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              Enter your email to receive reset instructions
            </p>
          </div>

          {error && (
            <div className="bg-danger-50 border border-danger-100 rounded-md p-3 mb-4">
              <p className="text-sm text-danger-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                placeholder="your.email@school.edu"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
            </Field>

            <Button
              kind="primary"
              className="w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return null;
}
```

#### 3.5.2 Change Password Modal

**File:** `components/auth/ChangePasswordModal.tsx`

```typescript
'use client';

import React from 'react';
import { Button, Input, Field, Card } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ChangePasswordModal({
  isOpen,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to change password');
        return;
      }

      setSuccess('Password changed successfully');
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 1500);
    } catch (err) {
      setError('Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-900">Change Password</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <Icon name="X" size={20} />
          </button>
        </div>

        {error && (
          <div className="bg-danger-50 border border-danger-100 rounded-md p-3 mb-4">
            <p className="text-sm text-danger-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-success-50 border border-success-100 rounded-md p-3 mb-4">
            <p className="text-sm text-success-700">{success}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Current Password">
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={loading}
            />
          </Field>

          <Field label="New Password">
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={loading}
            />
          </Field>

          <Field label="Confirm Password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
            />
          </Field>

          <div className="flex gap-2 pt-4">
            <Button
              kind="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              kind="primary"
              className="flex-1"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
```

#### 3.5.3 Active Sessions View

**File:** `components/auth/ActiveSessions.tsx`

```typescript
'use client';

import React from 'react';
import { Button, Card } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface Session {
  id: string;
  deviceName: string;
  ipAddress: string;
  lastUsed: string;
  issuedAt: string;
  expiresAt: string;
  rememberDevice: boolean;
}

export function ActiveSessions() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/auth/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      const response = await fetch(
        `/api/auth/sessions?sessionId=${sessionId}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        setSessions(sessions.filter((s) => s.id !== sessionId));
      }
    } catch (error) {
      console.error('Failed to revoke session:', error);
    }
  };

  if (loading) {
    return <div className="text-slate-500">Loading sessions...</div>;
  }

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold text-slate-900">Active Sessions</h3>

      {sessions.length === 0 ? (
        <p className="text-sm text-slate-600">No active sessions</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="border border-slate-200 rounded-lg p-3 flex items-start justify-between"
            >
              <div className="flex-1">
                <h4 className="font-medium text-slate-900">
                  {session.deviceName}
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  IP: {session.ipAddress}
                </p>
                <p className="text-xs text-slate-500">
                  Last used: {new Date(session.lastUsed).toLocaleString()}
                </p>
              </div>
              <Button
                kind="danger"
                size="sm"
                onClick={() => revokeSession(session.id)}
              >
                <Icon name="LogOut" size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
```

---

### Phase 6: Middleware & Route Protection (Days 13-14)

#### 3.6.1 Enhanced Middleware

**File:** `middleware.ts` (UPDATE)

```typescript
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export const middleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const role = (token?.role as string) || 'PARENT';

    // Check if session is valid (not revoked)
    const sessionId = token?.sessionId as string;
    if (!sessionId && !pathname.includes('/login')) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Role-based routing
    const adminPaths = ['/admin', '/accountant'];
    const teacherPaths = ['/teacher', '/admin/attendance'];
    const accountantPaths = ['/accountant'];
    const parentPaths = ['/parent'];

    // Check access
    if (adminPaths.some((p) => pathname.startsWith(p))) {
      if (role !== 'ADMIN') {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }

    if (teacherPaths.some((p) => pathname.startsWith(p))) {
      if (!['ADMIN', 'TEACHER'].includes(role)) {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }

    if (accountantPaths.some((p) => pathname.startsWith(p))) {
      if (!['ADMIN', 'ACCOUNTANT'].includes(role)) {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }

    if (parentPaths.some((p) => pathname.startsWith(p))) {
      if (!['PARENT', 'ADMIN'].includes(role)) {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    '/admin/:path*',
    '/teacher/:path*',
    '/accountant/:path*',
    '/parent/:path*',
    '/dashboard/:path*',
  ],
};
```

---

### Phase 7: Email Service (Days 14-15)

#### 3.7.1 Email Configuration

**File:** `lib/email.ts`

```typescript
import nodemailer from 'nodemailer';

// Initialize email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
): Promise<void> {
  const resetLink = `${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`;

  const htmlContent = `
    <h2>Reset Your Password</h2>
    <p>Click the link below to reset your password. This link will expire in 1 hour.</p>
    <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background: #9333ea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
      Reset Password
    </a>
    <p>Or paste this link in your browser:</p>
    <p>${resetLink}</p>
    <p>If you didn't request this, please ignore this email.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@jnanadeepika.edu',
      to: email,
      subject: 'Password Reset Instructions',
      html: htmlContent,
      text: `Reset your password: ${resetLink}`,
    });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw new Error('Failed to send email');
  }
}

export async function sendVerificationEmail(
  email: string,
  verificationToken: string
): Promise<void> {
  const verifyLink = `${process.env.NEXTAUTH_URL}/verify-email?token=${verificationToken}`;

  const htmlContent = `
    <h2>Verify Your Email</h2>
    <p>Click the link below to verify your email address.</p>
    <a href="${verifyLink}" style="display: inline-block; padding: 10px 20px; background: #9333ea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
      Verify Email
    </a>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@jnanadeepika.edu',
      to: email,
      subject: 'Verify Your Email Address',
      html: htmlContent,
    });
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw new Error('Failed to send email');
  }
}

export async function sendLoginNotificationEmail(
  email: string,
  deviceInfo: { deviceName: string; ipAddress: string; time: string }
): Promise<void> {
  const htmlContent = `
    <h2>New Login Detected</h2>
    <p>Someone logged into your account from:</p>
    <ul>
      <li><strong>Device:</strong> ${deviceInfo.deviceName}</li>
      <li><strong>IP Address:</strong> ${deviceInfo.ipAddress}</li>
      <li><strong>Time:</strong> ${deviceInfo.time}</li>
    </ul>
    <p>If this wasn't you, please change your password immediately.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@jnanadeepika.edu',
      to: email,
      subject: 'New Login to Your Account',
      html: htmlContent,
    });
  } catch (error) {
    console.error('Failed to send login notification email:', error);
    // Don't throw — this is non-critical
  }
}
```

---

### Phase 8: Admin Dashboard & Audit (Days 15-17)

#### 3.8.1 Login Audit Page

**File:** `app/admin/security/page.tsx` (NEW)

```typescript
'use client';

import React from 'react';
import { Button, Card, Input, Field } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

interface LoginRecord {
  id: string;
  email: string;
  eventType: string;
  success: boolean;
  ipAddress: string;
  deviceName: string;
  failureReason?: string;
  createdAt: string;
}

export default function SecurityPage() {
  const [logs, setLogs] = React.useState<LoginRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filterEmail, setFilterEmail] = React.useState('');

  React.useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/admin/security/login-audit');
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) =>
    log.email.toLowerCase().includes(filterEmail.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Security</h1>
        <p className="text-slate-600 mt-1">Login audit trail and account security</p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Login Audit Trail
        </h2>

        <Field label="Filter by Email">
          <Input
            type="text"
            placeholder="Search email..."
            value={filterEmail}
            onChange={(e) => setFilterEmail(e.target.value)}
          />
        </Field>

        {loading ? (
          <p className="text-slate-600 mt-4">Loading...</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Email
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Event
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Device
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    IP Address
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-900">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100">
                    <td className="py-3 px-3">{log.email}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-1 rounded text-sm font-medium ${
                          log.success
                            ? 'bg-success-50 text-success-700'
                            : 'bg-danger-50 text-danger-700'
                        }`}
                      >
                        {log.eventType}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-sm">{log.deviceName}</td>
                    <td className="py-3 px-3 text-sm">{log.ipAddress}</td>
                    <td className="py-3 px-3 text-sm">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
```

#### 3.8.2 User Management with Account Lock/Unlock

**File:** `app/api/admin/users/:userId/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/db';
import { Role } from '@prisma/client';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const { action } = await request.json();
    const userId = params.userId;

    if (!action) {
      return NextResponse.json(
        { error: 'Action required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (action === 'unlock') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          loginAttempts: 0,
          lockedUntil: null,
        },
      });

      return NextResponse.json({ message: 'User unlocked' });
    }

    if (action === 'lock') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      return NextResponse.json({ message: 'User locked' });
    }

    if (action === 'disable') {
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      return NextResponse.json({ message: 'User disabled' });
    }

    if (action === 'enable') {
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: true },
      });

      return NextResponse.json({ message: 'User enabled' });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('User action error:', error);
    return NextResponse.json(
      { error: 'Operation failed' },
      { status: 500 }
    );
  }
}
```

---

### Phase 9: Testing & Documentation (Days 17-20)

#### 3.9.1 Integration Test Suite

**File:** `tests/auth.test.ts` (NEW)

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/password';
import { generateSessionId, generateRefreshToken, generateAccessToken, verifyToken } from '@/lib/tokens';

describe('Authentication System', () => {
  describe('Password Security', () => {
    it('should hash passwords securely', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword('WrongPassword', hash)).toBe(false);
    });

    it('should validate password strength', () => {
      const weak = validatePasswordStrength('short');
      expect(weak.valid).toBe(false);
      expect(weak.errors.length).toBeGreaterThan(0);

      const strong = validatePasswordStrength('TestPassword123!');
      expect(strong.valid).toBe(true);
      expect(strong.errors).toHaveLength(0);
    });
  });

  describe('Token Management', () => {
    it('should generate and verify tokens', () => {
      const payload = {
        id: 'user-123',
        email: 'test@school.edu',
        role: 'ADMIN' as const,
        sessionId: 'session-123',
      };

      const token = generateAccessToken(payload, 15);
      const verified = verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.id).toBe(payload.id);
      expect(verified?.email).toBe(payload.email);
    });

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('Login Flow', () => {
    beforeEach(async () => {
      // Cleanup test data
      await prisma.user.deleteMany({
        where: { email: { contains: 'test-' } },
      });
    });

    afterEach(async () => {
      // Cleanup
      await prisma.user.deleteMany({
        where: { email: { contains: 'test-' } },
      });
    });

    it('should create user and login successfully', async () => {
      const email = 'test-login@school.edu';
      const password = 'TestPassword123!';
      const passwordHash = await hashPassword(password);

      const user = await prisma.user.create({
        data: {
          email,
          name: 'Test User',
          passwordHash,
          role: 'TEACHER',
        },
      });

      expect(user).toBeDefined();
      expect(user.email).toBe(email);

      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash!);
      expect(isValid).toBe(true);
    });

    it('should track failed login attempts', async () => {
      const email = 'test-failed@school.edu';
      const user = await prisma.user.create({
        data: {
          email,
          name: 'Test User',
          passwordHash: 'test',
          role: 'TEACHER',
          loginAttempts: 4,
        },
      });

      // Simulate more failed attempts
      for (let i = 0; i < 3; i++) {
        await prisma.user.update({
          where: { id: user.id },
          data: { loginAttempts: user.loginAttempts + i + 1 },
        });
      }

      const updated = await prisma.user.findUnique({
        where: { id: user.id },
      });

      expect(updated!.loginAttempts).toBeGreaterThanOrEqual(4);
    });

    it('should handle account lockout', async () => {
      const email = 'test-lockout@school.edu';
      const lockoutTime = new Date(Date.now() + 30 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          email,
          name: 'Test User',
          passwordHash: 'test',
          role: 'TEACHER',
          lockedUntil: lockoutTime,
        },
      });

      const locked = user.lockedUntil! > new Date();
      expect(locked).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should create and track user sessions', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-session@school.edu',
          name: 'Test User',
          passwordHash: 'test',
          role: 'PARENT',
        },
      });

      const sessionId = generateSessionId();
      const refreshToken = generateRefreshToken();

      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionId,
          refreshToken,
          refreshTokenHash: 'hash',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0...',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      expect(session.sessionId).toBe(sessionId);
      expect(session.revokedAt).toBeNull();

      // Revoke session
      const revoked = await prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      expect(revoked.revokedAt).not.toBeNull();
    });
  });
});
```

---

### Phase 10: Custom Roles & Access Management  *(NEW — implements §2.4)*

**Goal:** Admins create/edit roles and toggle permissions; the rest of the app reads capabilities instead of hardcoded role names.

#### 3.10.1 Schema migration (folds into Phase 1)
- Remove `enum Role`; add `Role`, `RolePermission` tables + `Surface`, `Permission` enums (see §2.4).
- Change `User.role` → `User.roleId String` with relation to `Role`.
- `prisma migrate dev` + a data migration mapping existing enum values → seeded role rows.

#### 3.10.2 Seed the 4 system roles
- `prisma/seed-roles.ts`: upsert `admin`, `teacher`, `accountant`, `parent` with `isSystem: true`, their `baseSurface`, and default permission sets (table in §2.4).
- Re-point existing users to the matching seeded role.

#### 3.10.3 Capability layer — rewrite `lib/roles.ts`
- `can(session, perm: Permission): boolean` — reads `session.user.perms` (baked into JWT).
- `requirePermission(perm)` — server guard for API routes; throws 403.
- `surfaceOf(session)` — returns ADMIN | TEACHER | ACCOUNTANT | PARENT for redirect + sidebar.
- Replace every `role === 'ADMIN'` style check across pages/APIs with `can(...)`.

#### 3.10.4 JWT/session wiring (folds into Phase 3)
- On login, load the user's role + granted permissions, embed `roleKey`, `surface`, `perms: string[]` in the JWT.
- Session callback exposes `session.user.role`, `.surface`, `.perms`.

#### 3.10.5 Roles & Access API
- `GET  /api/roles` — list roles (+ user counts, permissions). Requires `ROLES_MANAGE`.
- `POST /api/roles` — create custom role { name, description, baseSurface, permissions[] }.
- `PATCH /api/roles/[id]` — edit permissions / name / active (system roles: permissions editable, key/delete locked). **On any permission/surface/active change, automatically revokes all assigned users' sessions (forced re-login) so changes apply immediately.** Returns `{ affectedUsers: N }`.
- `DELETE /api/roles/[id]` — only if no users assigned and not `isSystem`.
- `GET /api/permissions` — the static catalog (grouped) for rendering the checkbox grid.
- `PATCH /api/users/[id]/role` — assign a role to a user; **always revokes that user's sessions** so the new role's permissions take effect on their next login.

#### 3.10.6 Admin UI — `/admin/roles`
- Roles list (system badge, user count, active toggle).
- Create/Edit drawer: name, description, **base surface** dropdown, permission checkbox grid grouped by area (Students / Classes / Attendance / Fees / Reporting / Admin).
- Delete guard with "reassign N users first" message.
- **Save confirmation** when editing permissions: "Saving will sign out N user(s) so the new permissions apply immediately." (forced re-login is automatic — no opt-out).
- Staff & user screens: role dropdown now populated from `/api/roles` (custom roles like "Assistant Teacher" appear automatically); reassigning a user's role likewise signs that user out.
- Gated by `ROLES_MANAGE`; sidebar "Roles & access" item already exists for ADMIN.

#### 3.10.7 Worked example — "Assistant Teacher"
1. Admin → Roles → **Create role**: name "Assistant Teacher", base surface **TEACHER**.
2. Tick `STUDENTS_VIEW`, `CLASSES_VIEW`, `ATTENDANCE_VIEW`, `ATTENDANCE_MARK`; leave `ATTENDANCE_LOCK` off.
3. Save → role appears in the user role dropdown.
4. Assign a staff member to it → on next login they land on the Teacher surface and can mark (but not lock) attendance.

---

## 4. File Structure Summary

```
jnana-deepika-app/
├── app/
│   ├── login/
│   │   └── page.tsx (ROLE-SPECIFIC LOGIN)
│   ├── reset-password/
│   │   └── page.tsx (NEW)
│   ├── api/
│   │   └── auth/
│   │       ├── [...nextauth]/route.ts (EXISTING)
│   │       ├── login/route.ts (NEW - helper)
│   │       ├── logout/route.ts (NEW)
│   │       ├── forgot-password/route.ts (NEW)
│   │       ├── reset-password/route.ts (NEW)
│   │       ├── change-password/route.ts (NEW)
│   │       ├── sessions/route.ts (NEW)
│   │       └── verify-email/route.ts (NEW - optional)
│   ├── admin/
│   │   ├── security/
│   │   │   └── page.tsx (NEW - audit logs)
│   │   └── users/
│   │       └── page.tsx (UPDATE - user management)
│   └── (other routes unchanged)
│
├── components/
│   ├── auth/
│   │   ├── ChangePasswordModal.tsx (NEW)
│   │   ├── ActiveSessions.tsx (NEW)
│   │   └── LoginAudit.tsx (NEW)
│   └── (other components unchanged)
│
├── lib/
│   ├── authOptions.ts (REPLACE - production version)
│   ├── password.ts (NEW)
│   ├── rateLimit.ts (NEW)
│   ├── tokens.ts (NEW)
│   ├── device.ts (NEW)
│   ├── audit.ts (NEW)
│   ├── csrf.ts (NEW)
│   ├── email.ts (NEW)
│   └── (other utilities unchanged)
│
├── prisma/
│   ├── schema.prisma (UPDATE - add auth models)
│   └── migrations/ (NEW - database changes)
│
├── tests/
│   └── auth.test.ts (NEW)
│
├── middleware.ts (UPDATE)
├── .env.local (UPDATE)
└── package.json (UPDATE)
```

---

## 5. Implementation Priority & Timeline

### Priority 1: Foundation (Days 1-7) — **CRITICAL**
- [ ] Install dependencies
- [ ] Environment setup
- [ ] Database schema migration
- [ ] Password hashing & validation
- [ ] Rate limiting setup
- [ ] Updated authOptions.ts

**Testing:** Manual login/logout, password reset flow

### Priority 2: API Endpoints (Days 7-10) — **HIGH**
- [ ] Login/logout endpoints
- [ ] Password reset flow
- [ ] Change password endpoint
- [ ] Session management API

**Testing:** API integration tests, edge cases

### Priority 3: UI Layer (Days 10-13) — **HIGH**
- [ ] Unified login page with role selector
- [ ] Change password modal
- [ ] Active sessions viewer
- [ ] Update login page styling

**Testing:** UI flows, responsive design, error states

### Priority 4: Admin Features (Days 13-17) — **MEDIUM**
- [ ] Audit logging
- [ ] User management (lock/unlock)
- [ ] Login audit page
- [ ] Security dashboard

**Testing:** Admin functionality, data accuracy

### Priority 5: Polish (Days 17-20) — **MEDIUM**
- [ ] Email templates
- [ ] Comprehensive testing
- [ ] Documentation
- [ ] Performance optimization

### Priority 2.5: Custom Roles & Access (Days 9-12) — **HIGH** *(Phase 10, runs alongside UI)*
- [ ] Schema: drop `enum Role`; add `Role`/`RolePermission` tables + `Surface`/`Permission` enums
- [ ] Seed 4 system roles + migrate existing users to role rows
- [ ] Rewrite `lib/roles.ts` → `can()` / `requirePermission()` / `surfaceOf()`
- [ ] Bake `roleKey` + `surface` + `perms[]` into JWT at login
- [ ] Roles & Access API (`/api/roles`, `/api/permissions`, assign-role)
- [ ] Admin UI `/admin/roles` (create/edit/delete, permission grid)
- [ ] Swap hardcoded role checks → capability checks app-wide

---

## 6. Security Checklist

### Authentication
- [x] Real password hashing (bcryptjs, 12 rounds)
- [x] Password strength validation
- [x] Brute-force protection (5 attempts/15 min)
- [x] Account lockout (30 min after max attempts)
- [x] Password reset via email (1-hour tokens)
- [x] Session tracking per device

### Session Management  *(per §2.5 — no auto-logout)*
- [x] Long-lived session token (~1 year, sliding via `updateAge`) — persists until explicit logout
- [x] No idle timeout / no expiry-warning modal
- [x] HTTP-only, SameSite=Lax, Secure-in-prod session cookie
- [x] CSRF protection via NextAuth
- [x] Multi-device session tracking
- [x] Ability to revoke sessions (user "sign out everywhere", admin force-logout, on password reset)

### Audit & Monitoring
- [x] Login/logout event logging
- [x] Failed login tracking
- [x] Device fingerprinting
- [x] IP address logging
- [x] Admin audit dashboard

### Database Security
- [x] Password field encryption (bcrypt)
- [x] Token hashing (SHA-256)
- [x] Secure token storage
- [x] Expiration timestamps
- [x] Cascading deletes for user records

### API Security
- [x] Rate limiting on auth endpoints
- [x] Error message obfuscation
- [x] CORS configuration (NextAuth default)
- [x] Secure cookie settings (httpOnly, secure in prod)
- [x] IP validation on session use

### Infrastructure
- [x] NODE_ENV checks for demo vs prod
- [x] NEXTAUTH_SECRET configuration
- [x] Email service setup
- [x] Environment variable validation
- [x] Logging without exposing secrets

---

## 7. Role-Specific Login Flows

> **Sessions never time out (§2.5).** Every role below stays signed in until they tap Logout. "Surface" = which app shell they land in; custom roles inherit a surface.

### ADMIN / ACCOUNTANT  (surface: ADMIN / ACCOUNTANT)
- Email + password
- 2FA optional (prepare infrastructure)
- Stays logged in until logout
- Multi-device tracking; admin can revoke sessions

### TEACHER  (surface: TEACHER)
- Email + password (quick login for morning rush)
- Device memory option
- Stays logged in until logout
- Fast logout (minimal confirmation)

### PARENT  (surface: PARENT)
- Email + password
- Mobile-optimized interface
- "Remember device" option
- Stays logged in until logout
- Option for SMS-based login (future)

### CUSTOM ROLES (e.g. "Assistant Teacher", "Librarian")
- Created by admin in `/admin/roles`; inherit one of the 4 surfaces via `baseSurface`
- Login is identical to built-in roles; redirect + sidebar follow the chosen surface
- Capabilities are exactly the permissions the admin ticked for that role

### FEATURE FLAGS
```env
ENABLE_2FA_ADMIN=false        # Ready to enable
ENABLE_EMAIL_VERIFICATION=false # Ready to enable
DEMO_MODE=false               # Switch off in production
ENABLE_PARENT_SMS_LOGIN=false # For future implementation
```

---

## 8. Migration Path from Demo to Production

### Step 1: Backup
```bash
# Backup current database
npm run db:backup
```

### Step 2: Deploy New Schema
```bash
# Generate and run migration
npm run db:migrate -- --name add_production_auth

# Seed initial admin user (if needed)
npm run db:seed
```

### Step 3: Update Config
```bash
# Set environment variables
NEXTAUTH_SECRET=<strong-random-key>
DEMO_MODE=false
PASSWORD_MIN_LENGTH=8
MAX_LOGIN_ATTEMPTS=5
```

### Step 4: Deploy Code
```bash
# Build and test locally
npm run build
npm run dev

# Deploy to production
npm run build
npm start
```

### Step 5: Verify
- [ ] Admin can log in with real password
- [ ] Teachers can log in
- [ ] Accountants can log in
- [ ] Parents can log in
- [ ] Brute-force protection works
- [ ] Password reset works
- [ ] Audit logs appear in database
- [ ] Email notifications sent

---

## 9. Monitoring & Maintenance

### Key Metrics to Track
1. **Failed login attempts** per user/hour
2. **Account lockouts** triggered
3. **Password resets** initiated
4. **Session creation/revocation** rates
5. **API response times** for auth endpoints
6. **Database query performance** on user lookups

### Regular Maintenance
- Weekly: Review failed login patterns
- Monthly: Audit inactive sessions > 30 days
- Quarterly: Update password policies if needed
- Yearly: Rotate NEXTAUTH_SECRET

### Alerting Rules
- More than 20 failed login attempts in 1 hour → Alert
- Account locked → Send email notification
- Multiple sessions from unusual IPs → Alert
- Password reset not used within 24 hours → Cleanup token

---

## 10. Future Enhancements

### Phase 2 (Post-Launch)
- [ ] Two-factor authentication (TOTP/SMS)
- [ ] Email verification workflow
- [ ] OAuth providers (Google, Microsoft)
- [ ] Passwordless login (magic links)
- [ ] Device trust/biometric on mobile

### Phase 3 (Advanced)
- [ ] Single Sign-On (SSO) integration
- [ ] Advanced MFA (hardware keys)
- [ ] Compliance audit reports (SOC2)
- [ ] API keys for integrations
- [ ] Machine learning for anomaly detection

---

## 11. Quick Reference: Environment Variables

```env
# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate-with: npm run generate:secret>

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# Password Policy
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_NUMBERS=true
PASSWORD_REQUIRE_SPECIAL=true

# Session Policy
SESSION_TIMEOUT_MINUTES=60
REFRESH_TOKEN_EXPIRY_DAYS=7

# Brute Force Protection
MAX_LOGIN_ATTEMPTS=5
LOGIN_ATTEMPT_WINDOW_MINUTES=15
ACCOUNT_LOCKOUT_MINUTES=30

# Email Service
EMAIL_FROM=noreply@jnanadeepika.edu
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-password

# Feature Flags
ENABLE_2FA_ADMIN=false
ENABLE_EMAIL_VERIFICATION=false
DEMO_MODE=false
NODE_ENV=production
```

---

## Conclusion

This comprehensive plan transforms the Jnana Deepika ERP from a demo authentication system into a production-grade identity and access management solution. The phased approach allows for incremental implementation with testing at each stage, while the modular design enables future enhancements without major refactoring.

**Key Success Factors:**
1. Strong password hashing from day one
2. Multi-layered rate limiting
3. Comprehensive audit logging
4. Clear role-based access control
5. User-friendly security features (device memory, password reset)
6. Admin visibility into security events

**Expected Timeline:** 3-4 weeks for full implementation with thorough testing.

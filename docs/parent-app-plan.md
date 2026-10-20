# Jnana Deepika — Parent Mobile App Plan

**Target:** Native **Android + iOS** app for parents, built with **Expo / React Native (TypeScript)**.
**Backend:** Reuses the existing Next.js server and its `/api/parent/*` endpoints, plus the WhatsApp-OTP + self-set-PIN auth already live in the web app. No parallel backend.
**First release scope:** Feature parity with the existing web `/parent` surface — Login, Home (attendance + fees), Report card, Circulars, Photos, Streaks, Push.

> This document is the build plan for the *native* parent app. The existing `/parent` route in the Next.js app is a responsive web surface and stays as-is; the native app is an additional client against the same server. Where the two must agree (auth, response shapes), this plan calls it out explicitly.

---

## 1. Why native (vs. the existing web surface)

The web `/parent` surface works, but a store-distributed native app gives parents:

- A real home-screen icon and app identity (not a bookmarked URL).
- **Reliable push notifications** on both platforms (iOS Safari web-push is unreliable / opt-in-hostile).
- **Biometric-gated PIN unlock** and OS-level credential storage.
- Offline-first reading of the last-synced data (attendance, fees, circulars).
- A smoother share sheet for report cards and photos.

We keep one backend and one set of business rules; the native app is a thin, well-cached client.

---

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Expo (React Native), managed workflow** | Single TS codebase, EAS Build for store binaries, OTA updates via EAS Update. |
| Language | TypeScript | Share DTO types with the server via a small `@jnana/shared-types` package (or copied `types/parent.ts`). |
| Navigation | `expo-router` (file-based) | Mirrors the mental model of the Next.js app. |
| Data fetching | **TanStack Query** | Caching, background refetch, offline persistence via `@tanstack/query-async-storage-persister`. |
| Secure storage | `expo-secure-store` | Stores the auth token + a flag for biometric unlock. |
| Biometrics | `expo-local-authentication` | Face ID / fingerprint gate on app open. |
| Push | `expo-notifications` + EAS push | Device token registered against the parent's user. |
| Styling | `nativewind` (Tailwind for RN) | Lets us reuse the existing Tailwind design tokens (purple brand, success/danger/info/marigold). |
| Icons | `lucide-react-native` | Same icon set the web app uses via `components/Icon`. |
| Image share / report card | `react-native-view-shot` + `expo-sharing` | Replaces the web `<canvas>` PNG render with a native view snapshot. |

**Monorepo placement:** add the app at `mobile/parent-app/` inside the existing repo so types and the server ship together, or a sibling repo if store CI needs isolation. Recommendation: in-repo folder, EAS project scoped to that folder.

---

## 3. Architecture at a glance

```
┌────────────────────────────┐        HTTPS (Bearer token)        ┌───────────────────────────┐
│  Parent app (Expo/RN)      │  ───────────────────────────────▶  │  Next.js server           │
│  - expo-router screens     │                                    │  - /api/auth/* (OTP, PIN) │
│  - TanStack Query cache     │  ◀───────────────────────────────  │  - /api/parent/* (data)   │
│  - SecureStore token        │        JSON responses              │  - Prisma / Postgres      │
│  - expo-notifications       │                                    │  (Supabase, Mumbai)       │
└────────────────────────────┘                                    └───────────────────────────┘
```

**Key backend change required (see §5.3):** the `/api/parent/*` handlers currently authenticate via `getServerSession` (NextAuth cookie). Native apps don't carry NextAuth cookies cleanly, so we add a **Bearer-token path**: a mobile login endpoint mints a signed JWT the app stores in SecureStore and sends as `Authorization: Bearer <token>`; a shared `getParentUser(req)` helper accepts *either* the NextAuth session *or* the Bearer token so both clients keep working.

---

## 4. Navigation map

Bottom tab bar (mirrors the web app's four tabs), with the child selector in the header:

```
(auth)                         (tabs)
  login                          home      → child cards: attendance donut, fees, calendar
                                 marks     → report card (FA/SA), share as image
                                 circulars → audience-filtered notices, unread badge
                                 photos    → albums, full-screen viewer
settings (modal/stack)           streaks   → surfaced inside Home (StreakCard)
  - notifications, PIN, sign out
```

Child selection is a single global pick (React context or a Zustand store) that filters every screen — same behaviour as the web `ChildProvider`.

---

## 5. Login & Authentication  ◀── *(build starts here)*

The app reuses the **exact auth flow the web login page already implements** (`app/page.tsx`): WhatsApp OTP for first login / forgotten PIN, then a self-set 4–6 digit PIN for everyday sign-in. Sessions **persist until explicit sign-out** (no auto-timeout — matches the production auth decision).

### 5.1 Flows

**A. Everyday sign-in (returning parent, PIN known)**
1. App opens → if a valid token is in SecureStore → biometric prompt (if enabled) → straight to Home.
2. Otherwise show the PIN sign-in screen: **phone/email + PIN**.
3. POST to the mobile login endpoint → receive `{ token, user }` → store token in SecureStore → route to Home.

**B. First login / forgot PIN (WhatsApp OTP → set PIN)** — same 4 steps as web:
1. **Phone** → `POST /api/auth/otp/request { phone }` → OTP sent on WhatsApp.
2. **Code** → `POST /api/auth/otp/verify { phone, code }` → `{ grantToken }`.
3. **Set PIN** → `POST /api/auth/set-pin { phone, grantToken, pin }` → `{ accounts: [...] }`.
4. **Role picker** (only if the phone maps to >1 account, e.g. a parent who is also staff) → pick account → sign in with the just-set PIN.

> **Decision (locked):** the app is **parent-only**. If a phone maps to both a parent and a staff account, the app signs in as the **parent account only** and never surfaces the staff account — staff work stays on the web admin. The `set-pin` response's `accounts[]` is filtered to `surface === 'PARENT'` on the client (and ideally on the new mobile-login endpoint), so the role picker appears only when a parent legitimately has **two parent accounts** (rare).

### 5.2 Screens

| Screen | Route | Fields / actions |
|---|---|---|
| PIN sign-in | `(auth)/login` | Phone-or-email, PIN (masked, `secureTextEntry`, numeric keypad), "Sign in", "First time or forgot PIN?" link. |
| OTP – phone | `(auth)/otp` step 1 | Phone (tel keypad), "Send code". |
| OTP – code | `(auth)/otp` step 2 | 6-digit code (one-time-code autofill), "Verify", "Resend". |
| Set PIN | `(auth)/set-pin` | New PIN + Confirm PIN (4–6 digits), "Save PIN & sign in". |
| Role picker | `(auth)/choose-account` | List of `{ displayName, roleName }`, tap to continue. |

Reuse the web copy verbatim where it helps ("We'll send a 6-digit code to your WhatsApp", "Choose a 4–6 digit PIN you'll use to sign in") so the two clients feel like one product. Branding (school name + logo) comes from `GET /api/branding` (public) and is cached.

### 5.3 Token strategy (the one real backend change)

NextAuth's credentials flow issues a **session cookie**, which is awkward for a native client. Add a thin, mobile-friendly bridge:

- **`POST /api/auth/mobile/login { email|phone, pin }`** → validates the PIN against `passwordHash` (same bcrypt check NextAuth uses), then returns:
  ```json
  { "token": "<signed JWT, no expiry>", "user": { "id", "name", "surface", "roleKey" } }
  ```
  The JWT is signed with the existing `NEXTAUTH_SECRET`, carries `{ sub: userId, surface: 'PARENT' }`, and — matching the no-auto-logout policy — **does not expire**; it is invalidated only by server-side revocation or by the parent signing out.
- **Token store (locked): reuse the existing web `Session` / revocation table.** A mobile login creates a row there (tag it `client: 'mobile'`, keep `platform` + device label) so **one revocation path** covers web and app — admin revoke, "sign out everywhere", and mobile sign-out all work identically. No separate `MobileSession` table.
- **`getParentUser(req)` helper** (new, in `lib/auth/`): resolves the caller from *either* a NextAuth session *or* a `Bearer` JWT, and returns `{ userId }` only when `surface === 'PARENT'`. Every `/api/parent/*` route swaps its inline `getServerSession(...)` + surface check for this helper. Web behaviour is unchanged; native gets Bearer support.
- **`POST /api/auth/mobile/logout`** → revokes the presented token (best-effort) so "Sign out" truly ends the session server-side.

The OTP endpoints (`request`, `verify`, `set-pin`) already return JSON and need **no change** — the app calls them directly. After `set-pin` succeeds, the app calls `mobile/login` with the new PIN to obtain its token.

### 5.4 Client-side session handling

- Token in `expo-secure-store` under `parent.authToken`; never in AsyncStorage.
- On cold start: read token → call a cheap `GET /api/parent/children` to validate → if 401, clear token and route to login.
- **Biometric unlock (native-only nicety, in-scope):** a settings toggle stores `parent.biometricEnabled`. When on, opening the app prompts Face ID / fingerprint before revealing data; the token itself stays in SecureStore. Failing biometrics does *not* sign the user out — it just re-prompts.
- 401 interceptor in the TanStack Query client → clear token, drop to `(auth)/login`.

---

## 6. Home screen

Parity with the web `HomeScreen` + `ChildCard`.

- **Header:** greeting (`Good morning/afternoon/evening, <FirstName>`), school name + logo, sign-out. Child selector pills when the parent has 2+ children.
- **Streak card:** `GET /api/parent/streaks?studentId=` → current attendance streak + badges (surfaced above the child card, same as web `StreakCard`).
- **Child card:**
  - Avatar (initials), name, class · roll, today's status chip (Present / Delayed arrival / On leave / Absent / Not marked).
  - **Attendance donut** (this month %: present/absent/leave) + **Fee balance** tile.
  - **Last 2 weeks** strip.
  - Toggle: **Attendance** (month calendar) ↔ **Fees**.
- **Month calendar:** `GET /api/parent/attendance?studentId=&month=YYYY-MM` → per-day status cells + monthly tally + legend; prev/next month, next disabled beyond current month.
- **Fees panel:** `GET /api/parent/fees?studentId=` → total/paid/balance, per-head breakdown, concessions, recent payments, and the "pay at office" / "all cleared" line.

Data model note: all of the above is **read-only** on the parent side. Money handling stays at the office (no in-app payment in the parity release — see §12 for the later phase).

Status colour map (reuse the web tokens): PRESENT→success, LATE→marigold, LEAVE→info, ABSENT→danger, none→slate.

---

## 7. Report card (Marks)

Parity with the web `MarksScreen`.

- For each child: `GET /api/parent/marks?studentId=` → `{ year, student, assessments[], hasGrades }`.
- Each assessment is **FA (Formative)** or **SA (Summative)** with subjects (marks/max or grade-only), totals, percentage, grade band; gradient header (indigo/purple for SA, marigold for FA).
- **Share as image:** the web renders a PNG via `<canvas>`. In RN, build the same layout as a hidden RN view and snapshot it with `react-native-view-shot`, then hand the file to `expo-sharing` (native share sheet → WhatsApp, etc.). Include school logo + name in the image, same as web.
- Footer note: "Only results approved and published by the school are shown."

Only the currently-selected child's report is shown when a child is selected (fall back to all children otherwise).

---

## 8. Circulars

Parity with the web `CircularsScreen`.

- `GET /api/parent/circulars` → audience-filtered notices (school-wide + class + this parent's students), category chips (Event / Exam / Holiday / Notice / Fees), pinned flag, published date.
- **Unread badge** on the tab: store `circularsSeenAt` timestamp in AsyncStorage; count circulars newer than it. Opening the tab updates the timestamp (same logic as web `localStorage`).
- Body renders with preserved line breaks. No compose/reply — read-only.

---

## 9. Photos

Parity with the web `PhotosScreen`.

- `GET /api/parent/photos` → albums, each with photos `{ id, url, caption }`.
- Grid (3-up) per album; tap → full-screen viewer with pinch-zoom (native gesture) and a close button.
- Lazy-load thumbnails; cache with `expo-image` for smooth scrolling.
- **v1 is view-only** (locked) — no save-to-camera-roll, avoiding the extra media-library permission prompt. Saving to the gallery via `expo-media-library` is a candidate for a later phase.

---

## 10. Push notifications

- On login, register the device: `expo-notifications` → get Expo push token → **`POST /api/parent/push/register { token, platform }`** (new lightweight endpoint; store against the user, dedup by token). Mirror the web `PushOptIn` intent, but with real OS push.
- **v1 notification types (locked), each a user-facing on/off toggle:**
  1. **Attendance** — child marked absent or on leave that day.
  2. **New circular** — a notice relevant to the parent's child is published.
  3. **Fee reminder** — pending balance / due reminder.
  4. **Report published & new photos** — a report card is approved/published, or a new photo album is added.
- Server sends via Expo's push service, triggered from the same server actions that already create these records (circular publish, attendance save, fee reminder job, marks publish, photo upload).
- **Deep links:** notification payload carries `{ type, studentId }` → tapping routes to the right tab and pre-selects the child (e.g. a circular push opens the Circulars tab; an absence push opens Home on that child).
- Respect an in-app notification-preferences screen (per-category toggles) stored server-side so it applies across the parent's devices.
- **Unregister on sign-out** so a shared phone doesn't keep receiving a former parent's alerts.

---

## 11. Fast data & rendering (performance strategy)

Goal: **the app opens to real content instantly** — no full-screen spinner on a warm start — and every tab feels immediate on a mid-range Android phone over 4G. The parent audience is latency-sensitive (mobile networks) and the backend is an Oracle VM + Supabase Mumbai, so the wins are: cut round-trips, cache aggressively, and render only what's visible.

### 11.1 Instant first paint (offline-first cache)
- **Persist the TanStack Query cache** to AsyncStorage (`@tanstack/query-async-storage-persister`). On cold start the app **paints last-synced data immediately from cache**, then revalidates in the background (stale-while-revalidate). The parent never stares at a blank screen.
- Cache policy per data type: attendance/fees/marks `staleTime` ~5 min, circulars/photos ~2 min; keep cached data usable offline for up to a few days (`gcTime` large). Show a subtle "showing saved data" banner only when actually offline.
- Token check on start is non-blocking: render cached UI first, validate the session in parallel.

### 11.2 Kill the request waterfall — one aggregated home endpoint
The web Home fires **`/children` → then per-child `/fees` → `/streaks` → `/attendance`** sequentially. On mobile that's 3–4 serial round-trips before the screen is complete. Fix on the server:

- **New `GET /api/parent/home`** returns everything the Home screen needs for the **initial paint in a single request**:
  ```json
  {
    "children": [{ "id", "name", "className", "roll", "todayStatus",
                   "month": { "present", "absent", "leave", "pct", "marked" },
                   "last14": [{ "date", "status" }],
                   "fee": { "totalCharged", "totalPaid", "totalBalance" },
                   "streak": { "current", "badges": [] } }],
    "branding": { "schoolName", "logoUrl" }
  }
  ```
  Built with a few batched Prisma queries (`findMany ... where studentId in [...]`) — **no N+1 per child**. The heavy detail (full month calendar grid, per-head fee breakdown, payment history, full report card) stays lazy and loads only when the parent expands that view.
- The existing granular endpoints stay for the web app and for drill-downs; the aggregate just collapses the first paint.

### 11.3 Prefetch & background sync
- **Prefetch on idle:** once Home renders, quietly prefetch the selected child's `marks` and the current + previous month's `attendance` so opening those tabs is instant.
- **Prefetch adjacent months** in the calendar (parents scroll back to check attendance) so month-nav has no spinner.
- Refetch on app foreground and on pull-to-refresh; otherwise trust the cache.

### 11.4 Trim & compress payloads
- Server responses **gzip/brotli** (enable compression on the Next.js/Node server if not already).
- Select only fields the client renders (Prisma `select`, not full-row `include`) — smaller JSON parses faster on-device.
- Attendance API returns a compact `{ "YYYY-MM-DD": "P" }` status map (single-char codes), not verbose objects.

### 11.5 Render only what's visible
- Use **FlashList** (`@shopify/flash-list`), not `ScrollView` + `.map`, for circulars and photo grids — virtualized rows keep long lists at 60fps and low memory.
- **`expo-image`** for all photos/logos: built-in memory + disk cache, `recyclingKey`, and blurhash/thumbnail placeholders so images pop in without layout shift.
- Request **resized thumbnails** for the photo grid (Supabase Storage image transform / a `?width=` param) and only load full-res in the full-screen viewer — never download full-res into a 3-up grid.
- Skeleton loaders (matching the web `animate-pulse`) only appear on a true cold cache; warm starts skip them.

### 11.6 Keep the JS thread free
- Move the report-card image render (`react-native-view-shot`) off the interaction path — snapshot on share tap, show a brief spinner, don't block scroll.
- Memoize child cards / list rows; stable keys; avoid re-rendering every card when one child is selected (selector state in a store, not prop-drilled through all cards).
- Enable Hermes (Expo default) and the New Architecture for faster startup and list performance.

### 11.7 Targets to hold the build to
- Warm start → interactive Home from cache: **< 500 ms**.
- Cold Home (network) with the aggregated endpoint: **one request**, content in **< 1.5 s** on 4G.
- Tab switches after prefetch: **no spinner**.
- Scrolling circulars/photos: **60fps**, no blank cells.

---

## 12. Out of scope for the parity release (later phases)

- **In-app fee payment** (Razorpay/UPI) — needs its own security review; parity release keeps "pay at office".
- **Two-way messaging** with teachers/office.
- **Leave requests** submitted from the app.
- **Timetable / homework** surfaces.
- Multi-language (Kannada/Telugu) UI — plan strings through `i18n` from day one so this is cheap to add.

---

## 13. Build, release & ops

- **Release both platforms together (locked): Android + iOS.** Needs an **Apple Developer account ($99/yr)** and a **Play Console account ($25 one-time)** — set these up early (Apple enrolment can take days).
- **EAS Build** for signed Android (`.aab`) and iOS (`.ipa`); **EAS Submit** to Play Console + App Store Connect.
- **EAS Update** channels: `preview` (internal testers) and `production`; JS-only changes ship OTA without a store review.
- **App identity:** name "Jnana Deepika — Parent", purple brand icon + splash (reuse the school logo asset already served at `/uploads/Logofinal.png`).
- **Store requirements:** privacy policy URL, data-safety form (we collect phone + child academic data; no third-party sharing), parent-facing screenshots.
- **Config:** API base URL via `app.config.ts` env (`https://<prod-host>`), pointing at the existing Oracle-hosted server. No new infra.
- **Versioning:** `runtimeVersion` policy tied to native changes; bump only when native modules change.

---

## 14. Milestones

| Phase | Deliverable |
|---|---|
| 0. Scaffold | Expo app, expo-router, nativewind tokens, TanStack Query, SecureStore, CI (EAS) |
| 1. Auth | Backend `mobile/login` + `getParentUser` helper; PIN sign-in, OTP→set-PIN, role picker, biometric unlock |
| 2. Home | Backend `GET /api/parent/home` aggregate (single-request first paint, §11.2); child selector, streak card, child card, attendance calendar, fees panel; query cache persistence + prefetch |
| 3. Marks | Report card + native image share |
| 4. Circulars + Photos | Both tabs, unread badge, full-screen viewer |
| 5. Push | Device registration endpoint, Expo push send hooks, deep links, prefs |
| 6. Offline + polish | Query persistence, pull-to-refresh, skeletons, empty/error states |
| 7. Store release | Icons/splash, store listings, privacy/data-safety, TestFlight + internal track → production |

---

## 15. Confirmed decisions (locked 2026-08-28)

| # | Decision | Choice |
|---|---|---|
| 1 | Framework | **Expo / React Native (TypeScript)** |
| 2 | First-release scope | **Parity with web `/parent`** |
| 3 | Repo layout | **In-repo `mobile/parent-app/`** (shares types with server) |
| 4 | Native auth | **Bearer-token bridge** (`/api/auth/mobile/login`), JWT signed with `NEXTAUTH_SECRET`, no expiry |
| 5 | Token/revocation store | **Reuse existing web `Session` table** (tag `client:'mobile'`); no separate table |
| 6 | Home data loading | **Build aggregated `GET /api/parent/home`** — single-request first paint |
| 7 | Mixed-role phones | **Parent account only**; staff stays on web admin |
| 8 | Biometric unlock | **In v1** (Face ID / fingerprint after first PIN login) |
| 9 | Photo save-to-gallery | **Deferred** — v1 is view-only |
| 10 | Push types (v1) | **Attendance · New circular · Fee reminder · Report+Photos**, each a toggle |
| 11 | Store release | **Android + iOS together** (Apple $99/yr + Play $25 one-time) |

### Still to decide later (not blocking the build)
- Kannada/Telugu localization (strings go through `i18n` from day one so it's cheap to add).
- In-app fee payment (needs its own security review) — later phase.
- Photo save-to-camera-roll — candidate for a follow-up.

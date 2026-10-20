# Jnana Deepika — Parent App (Expo / React Native)

Native Android + iOS parent app. Talks to the existing Next.js backend (`/api/parent/*`, `/api/auth/mobile/*`). See the full plan in [`../../docs/parent-app-plan.md`](../../docs/parent-app-plan.md).

## Status

**Phases 0–2 done** (backend endpoints tested live; app typechecks clean, not yet run on a device):

- **Phase 0 scaffold** — Expo SDK 52, expo-router, nativewind, TanStack Query (+persist), secure-store, biometrics.
- **Phase 1 auth** — PIN sign-in, WhatsApp-OTP → set-PIN → sign-in, role picker, biometric unlock, secure token storage, 401→logout. Backend: `mobile/login`+`logout`, `getParentUser` dual-mode, all `/api/parent/*` rewired.
- **Phase 2 Home** — aggregated `GET /api/parent/home` (one request: children + fees + streak + branding), child selector, enriched child card (attendance donut, real fee balance, streak chip, last-2-weeks strip), Attendance ↔ Fees toggle with a month calendar (prev-month prefetch) and a fees panel.

**Phase 3–5 next:** report card + share-as-image, push notifications, offline polish.

## Prerequisites

- Node 18+
- The backend running and reachable from your phone/emulator.
- Expo Go app on a physical device, or Android Studio / Xcode simulators.

## Setup

```bash
cd mobile/parent-app
npm install
```

> **Version note (SDK 52):** `nativewind` is pinned to exactly `4.1.23` on purpose. The 4.2.x line pulls `react-native-css-interop` ≥0.2, whose Babel plugin hard-requires `react-native-worklets/plugin` (a Reanimated **4** dependency) and breaks the Metro build on this SDK's Reanimated **3.16**. Do not bump NativeWind past 4.1.x without also moving to Reanimated 4 / a newer Expo SDK. The Reanimated Babel plugin is **not** listed in `babel.config.js` — `babel-preset-expo` adds it automatically.

Verified: `npx expo export --platform android` bundles clean (3008 modules).

### Point the app at your backend

The app reads `EXPO_PUBLIC_API_URL` (see `app.config.ts`). On a **physical phone**, `localhost` is the phone, not your PC — use your machine's LAN IP or the prod URL:

```bash
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.50:3000"; npx expo start
```

For Android emulator, the host is `http://10.0.2.2:3000`. For prod, use the deployed HTTPS URL.

## Run

```bash
npx expo start          # scan the QR with Expo Go, or press a / i
```

## Assets (before an EAS build)

`app.config.ts` references icon/splash/notification images under `./assets/`. Add real PNGs there before building store binaries (they're optional in Expo Go dev). Suggested: reuse the school logo (`Logofinal.png`) at 1024×1024 for the icon.

## Backend endpoints this app uses

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/mobile/login` | Parent PIN sign-in → `{ token, user }` (Bearer JWT) |
| `POST /api/auth/mobile/logout` | Revoke the mobile session |
| `POST /api/auth/otp/request` · `/verify` · `/api/auth/set-pin` | First-login / forgot-PIN (WhatsApp) |
| `GET /api/branding` | School name + logo (public) |
| `GET /api/parent/children` · `/attendance` · `/fees` · `/marks` · `/circulars` · `/photos` · `/streaks` | Parent data (accept the Bearer token via `getParentUser`) |

## Layout

```
app/
  _layout.tsx            providers (auth, query+persist, gesture, safe-area) + splash gate
  index.tsx              redirect to tabs or login
  (auth)/login.tsx       PIN sign-in
  (auth)/otp.tsx         phone → code → set-PIN → role picker
  (tabs)/index.tsx       Home (attendance; fees/streak land in Phase 2)
  (tabs)/marks|circulars|photos.tsx
src/
  api/                   client (Bearer + 401), auth calls
  auth/AuthProvider.tsx  SecureStore token, biometric unlock, sign in/out
  lib/                   query client (+persist), formatting
  components/            shared UI
```

# Jnana Deepika School ERP

Next.js 15 (App Router) · React 19 · Prisma 5.22 + PostgreSQL (Supabase) · Tailwind · PM2.
Dynamic route handlers use async params: `props: { params: Promise<{…}> }` + `await props.params`.
Prod LIVE on Oracle VM. Web admin + Parent mobile surfaces.

## Don't scan these (causes search timeouts, wastes tokens)
Never Glob/Grep across the whole tree. These are huge and irrelevant:
`node_modules/`, `mobile/`, `prod-backups/`, `graphify-out/`, `.next/`, `.claude/`
Search specific subfolders (app/, lib/, components/, prisma/) instead.

## Working efficiently
- Don't re-read files to "refresh" — trust MEMORY.md + the task summary.
  Open a file only when about to edit it, and read the relevant section, not the whole file.
- Prefer Grep/targeted Read over broad exploration.

## Deploy (ONLY when user explicitly says "deploy")
- VM: ubuntu@130.210.20.155, app ~/jdvsapp, pm2 id0=jdvsapp.
  NEVER restart id1=biometric-bridge.
- SSH key: ~/.ssh/jdvs_deploy.key (chmod 600).
- Before pull: `git checkout -- package-lock.json` (reset VM drift) then `git pull`.
  NEVER run `git checkout -- package-lock.json` AFTER the pull — it wipes pushed lockfile/dep fixes.
- Deps: run `npm install` ONLY when the pull changed the lockfile:
  `git diff --name-only HEAD@{1} HEAD | grep -q package-lock.json && npm install`
- Schema change → `npx prisma db push` on prod (safe to always run — says "in sync" when unchanged).
- Build (detached via setsid → ~/deploy.log). Keep `.next/cache` for faster rebuilds (don't `rm -rf .next`),
  and write the status marker that Settings → Deploy reads as the LAST log line (`SIG_DEPLOY_DONE_OK`/`SIG_DEPLOY_FAILED`):
  `setsid bash -c 'find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} + 2>/dev/null; NODE_OPTIONS=--max-old-space-size=2560 npm run build && pm2 restart jdvsapp --update-env && echo SIG_DEPLOY_DONE_OK || echo SIG_DEPLOY_FAILED' > ~/deploy.log 2>&1 &`
  (~8-12 min warm cache, ~13-15 cold. Monitor: `tail -f ~/deploy.log`.)
- Local DB test: `cp .env.local .env; npx prisma db push; rm -f .env` (never touches prod).

## Typecheck gate (before deploy)
`npx tsc --noEmit -p tsconfig.json` — must be CLEAN. Ignore mobile/parent-app errors only.
(Next 15 resolved the old app/api/upload/route.ts FormData errors — no acceptable app errors remain.)

## Where things live (don't search for these)
- Schema: prisma/schema.prisma
- Nav/sidebar: lib/navigation.ts, components/layout/Sidebar.tsx, TopBar.tsx
- RBAC: lib/rbac/{permissions.ts,roles.ts,crud.ts}
- Admin pages: app/admin/<feature>/page.tsx
- APIs: app/api/<feature>/route.ts
- Services: lib/services/<feature>.ts

## Verifying
- Don't run `npm run build` or start a dev server just to "check" — use `tsc --noEmit`.
- Don't take browser screenshots unless the user asks for visual proof.

## Replies
Be concise. No file-by-file recaps or restating the plan. Act, then summarize briefly.

## Conventions
- UI dialogs: use the right-side **Drawer** (components/ui/surfaces.tsx), never a centered Modal.
  Everything that would pop a dialog — forms, review/approve, confirmations — is a right drawer.
  For wide tables inside a drawer, keep the first column sticky with an OPAQUE bg (not bg-*/40)
  and a right shadow so horizontal scroll never bleeds values over the pinned column.
- RBAC: Permission enum + PERMISSION_CATALOG (lib/rbac/permissions.ts),
  can/canAny (lib/rbac/roles.ts), MANAGE_IMPLIES bridge (lib/rbac/crud.ts).
- Activity logging: logActivity() in lib/activity.ts.
- Notifications: Notification model + NotificationBell + sendPushToUsers (lib/push.ts).
- WhatsApp templates: always create them in Meta as category **UTILITY**, never MARKETING
  (cheaper, no marketing opt-out). Applies to every template the school sends.
- IST date: `new Date(Date.now()+5.5*3600*1000).toISOString().slice(0,10)`.
- Soft-delete only — archive/restore, never hard-delete.
- Commit attribution: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

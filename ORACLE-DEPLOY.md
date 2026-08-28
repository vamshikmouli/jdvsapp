# Oracle VM — Deploy / Update Runbook

Production runs on an **Oracle Cloud "Always Free" VM**. This is the live server for
Jnana Deepika ERP. The database is **still Supabase** (ap-south-1 / Mumbai) even though
the app runs on Oracle — the VM only hosts the Next.js app + the biometric bridge.

> ⚠️ Supabase is on the **Free plan → no database backups**. Never assume a prod delete
> can be restored. Export first (see `prisma`/scripts), then delete.

---

## Server facts

| Thing | Value |
|---|---|
| Public IP | `130.210.20.155` |
| SSH user | `ubuntu` |
| SSH key (local) | `D:\Apps\jdvserpclaudeapp\oraclekeys\ssh-key-2026-07-18.key` |
| Shape | VM.Standard.E2.1.Micro — **1 GB RAM**, 1 OCPU, **6 GB swap** |
| App dir | `/home/ubuntu/jdvsapp` |
| Process manager | **PM2** — app process name `jdvsapp` (runs `npm start` → `next start`, port 3000) |
| Other PM2 process | `biometric-bridge` (SalaryBox punch ingest — **leave it alone** on app deploys) |
| Node | v20.x |
| GitHub | `https://github.com/vamshikmouli/jdvsapp.git` (branch `master`) |

### SSH in

```bash
ssh -i "D:/Apps/jdvserpclaudeapp/oraclekeys/ssh-key-2026-07-18.key" ubuntu@130.210.20.155
```

(First copy the key somewhere and `chmod 600` it, or SSH will refuse a world-readable key.)

---

## 🔴 Deploy policy — ALWAYS deploy from git (first priority, no exceptions)

**Every deploy MUST go through git. This is the first priority, always.**

1. **Commit + push** your changes to `origin/master` (GitHub `vamshikmouli/jdvsapp`).
2. **Deploy on the VM by pulling from git** — `git pull origin master` → build → `pm2 restart jdvsapp`.

**Method C (git-based) below is the PRIMARY method — use it.** Methods A and B
(scp changed files / ship a tarball) are **emergency fallbacks only** (e.g. GitHub
unreachable). If you ever fall back to A/B, **push the same changes to `master`
immediately after**, so git never lags production.

> ⚠️ If `master` is behind prod and someone runs the Method C `git reset --hard
> origin/master`, it will **revert the un-pushed changes on prod.** Keep `master`
> in sync with what's deployed, always.

---

## ‼️ Important gotchas (learned the hard way)

1. **`/home/ubuntu/jdvsapp` is NOT a git repo.** The original deploy was an uploaded
   tarball (`~/app.tgz`), not `git clone`. So `git pull` does **not** work there.
   Deploy by copying changed files (below) or by switching to a git-based flow (Option B).

2. **`next build` runs out of memory on this VM.** Node caps its heap (~512 MB) regardless
   of the 6 GB swap, so the type-check phase OOMs (`Ineffective mark-compacts near heap
   limit`). **Always build with a raised heap:**

   ```bash
   export NODE_OPTIONS="--max-old-space-size=2560"
   ```

   The build is slow (swap-backed) but completes.

3. **Never restart `biometric-bridge`** during an app deploy — it's a separate process
   handling live device punches.

---

## Deploy method A — copy changed files (⚠️ FALLBACK ONLY — prefer git / Method C)

Best when only a few files changed. Does not disturb anything else on the VM.

From your **local machine** (in `jnana-deepika-app`):

```bash
KEY="D:/Apps/jdvserpclaudeapp/oraclekeys/ssh-key-2026-07-18.key"   # chmod 600 a copy first
R="ubuntu@130.210.20.155:/home/ubuntu/jdvsapp"

# 1) Back up the files you're about to overwrite (on the VM)
ssh -i "$KEY" ubuntu@130.210.20.155 \
  'ts=$(date +%Y%m%d-%H%M%S); mkdir -p ~/deploy-bak/$ts; \
   cp app/admin/students/page.tsx ~/deploy-bak/$ts/ 2>/dev/null; echo backup: ~/deploy-bak/$ts' \
  # (cd into ~/jdvsapp inside the command if needed)

# 2) Upload changed files (repeat -per file, preserving the repo path)
scp -i "$KEY" app/admin/students/page.tsx        "$R/app/admin/students/page.tsx"
scp -i "$KEY" app/api/students/import/route.ts   "$R/app/api/students/import/route.ts"
scp -i "$KEY" prisma/schema.prisma               "$R/prisma/schema.prisma"

# 3) Regenerate Prisma (only if schema changed), rebuild, restart
ssh -i "$KEY" ubuntu@130.210.20.155 '
  cd ~/jdvsapp
  npx prisma generate
  export NODE_OPTIONS="--max-old-space-size=2560"
  npm run build
  pm2 restart jdvsapp --update-env
'
```

> If the schema changed AND the DB needs the new columns, run `npx prisma db push`
> **with the Supabase `DIRECT_URL`** before restarting. (The VM `.env` already has it.)

### Verify

```bash
ssh -i "$KEY" ubuntu@130.210.20.155 '
  pm2 list | grep jdvsapp
  curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/students   # expect 401 (auth), not 500
  pm2 logs jdvsapp --lines 10 --nostream
'
```

Roll back by copying files from `~/deploy-bak/<ts>/` back and rebuilding.

---

## Deploy method B — build locally, ship the artifact (avoids VM OOM)

The original approach. Build `.next` on your machine (which has RAM), tar it with the
source, upload, extract, restart. Avoids building on the tiny VM entirely.

```bash
# local
npm ci && npx prisma generate && npm run build
tar czf app.tgz app .next public package.json package-lock.json prisma next.config.* \
  --exclude node_modules
scp -i "$KEY" app.tgz ubuntu@130.210.20.155:/home/ubuntu/
# VM
ssh -i "$KEY" ubuntu@130.210.20.155 '
  cd ~/jdvsapp && tar xzf ~/app.tgz && npm install --omit=dev && \
  npx prisma generate && pm2 restart jdvsapp
'
```

## Deploy method C — git-based deploy (✅ PRIMARY — always use this)

One-time: convert the VM app dir to a git checkout. Thereafter every deploy is `git pull`.

```bash
# VM, one time:
cd ~/jdvsapp
git init && git remote add origin https://github.com/vamshikmouli/jdvsapp.git
git fetch origin master && git reset --hard origin/master
# thereafter each deploy:
git pull origin master && npm install && npx prisma generate && \
  NODE_OPTIONS="--max-old-space-size=2560" npm run build && pm2 restart jdvsapp
```

`.env`, `node_modules`, and `public/uploads` are gitignored, so git ops won't touch them.
Confirm the VM's tracked files aren't manually modified before the first `reset --hard`.

---

## Environment (already set on the VM `.env`)

Do **not** commit real secrets. The VM `.env` holds `DATABASE_URL`/`DIRECT_URL`
(Supabase pooled + direct), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SUPABASE_*`, `VAPID_*`.
`prisma generate` uses the schema only; runtime uses these.

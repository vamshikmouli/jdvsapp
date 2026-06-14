# Production Deployment — Jnana Deepika ERP

Plan: **deploy on Vercel now**, optionally **move to an Oracle Cloud free VM later**.
The code supports both (uploads switch automatically based on env vars).

---

## Phase 1 — Deploy on Vercel

### 1. Create the database (Supabase, free, Mumbai)

1. Sign up at https://supabase.com → **New project**.
2. Region: **South Asia (Mumbai) / ap-south-1**. Set a strong DB password (save it).
3. After it provisions, go to **Project → Settings → Database**:
   - **Connection pooling** (Transaction mode, port **6543**) → this is your `DATABASE_URL`.
     Append `?pgbouncer=true&connection_limit=1` to it.
   - **Direct connection** (port **5432**) → this is your `DIRECT_URL`.

### 2. Create the storage bucket (for student photos)

1. Supabase → **Storage → New bucket** → name it **`uploads`** → mark it **Public**.
2. Supabase → **Settings → API** → copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose).

### 3. Push the schema + seed data to Supabase

From your machine, with `DATABASE_URL` and `DIRECT_URL` pointing at Supabase:

```bash
npx prisma db push            # creates all tables
node prisma/seed.js           # base seed (classes, settings, etc.)
node prisma/seed-roles.js     # roles + demo logins
# then any fee/marks seed scripts you use in scripts/
```

> Tip: keep a separate `.env.production.local` with the Supabase URLs so you don't
> overwrite your local dev DB. Prisma reads `.env.local`/`.env`; pass values inline if needed.

### 4. Put the project on GitHub

This repo is already initialized and committed. Create an **empty private** repo on GitHub, then:

```bash
git remote add origin https://github.com/<you>/jnana-deepika-app.git
git branch -M main
git push -u origin main
```

### 5. Import into Vercel

1. https://vercel.com → **Add New → Project** → import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Leave build/output defaults.
3. **Environment Variables** — add all of these (see `.env.example`):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **pooled** URL (`...:6543/...?pgbouncer=true&connection_limit=1`) |
   | `DIRECT_URL` | Supabase **direct** URL (`...:5432/...`) |
   | `NEXTAUTH_URL` | `https://<your-domain>` (set after step 6; use the `.vercel.app` URL first) |
   | `NEXTAUTH_SECRET` | a fresh 32-byte base64 secret |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role secret |
   | `SUPABASE_STORAGE_BUCKET` | `uploads` |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | fresh VAPID public key |
   | `VAPID_PRIVATE_KEY` | fresh VAPID private key |
   | `VAPID_SUBJECT` | `mailto:admin@<your-domain>` |

4. **Deploy.** First build runs `postinstall` → `prisma generate`, then `next build`.

> ⚠️ **Commercial use:** a school ERP is commercial, so Vercel's Hobby (free) tier
> technically doesn't cover it — the compliant plan is **Pro ($20/mo, one seat)**.
> See `HOSTING-NOTES` below.

### 6. Point your domain

1. Buy the domain (Cloudflare Registrar or Namecheap). `.in` ≈ ₹500–900/yr.
2. Vercel → Project → **Settings → Domains** → add your domain; follow the DNS records
   Vercel shows (A / CNAME). HTTPS is automatic.
3. Update `NEXTAUTH_URL` env var to the final `https://<your-domain>` and redeploy.

### 7. Post-deploy checklist

- [ ] Log in as admin (`admin@jnanadeepika.edu` / `Admin@123`) → **change the password immediately**.
- [ ] Add a student with a photo → confirm the photo loads (verifies Supabase Storage).
- [ ] Record a fee payment → print a receipt.
- [ ] Open `/parent/login` on a phone → confirm a parent can log in.
- [ ] Set up a nightly DB backup (Supabase free tier includes daily backups; or run
      `pg_dump` from a free GitHub Actions cron).

---

## Phase 2 — Move to Oracle Cloud (free, later)

The app is portable. On an Oracle "Always Free" VM you run it as a normal Node server:

1. Provision an **Always Free** ARM VM, install Node 20, PostgreSQL, and Caddy (auto-HTTPS).
2. `createdb`, set `DATABASE_URL`/`DIRECT_URL` to the local Postgres, `npx prisma db push`, seed.
3. Either keep Supabase Storage (set the same `SUPABASE_*` vars) **or** leave them blank to
   store uploads on the VM's disk — the upload route falls back to local disk automatically.
4. `npm run build` → run `npm run start` under **PM2** or a systemd service.
5. Point the domain's A record at the VM IP; Caddy issues the TLS cert.

No code changes needed for the move.

---

## HOSTING-NOTES — cost summary

| Option | Monthly | Notes |
|---|---|---|
| Vercel **Hobby** | ₹0 | Free, but ToS is non-commercial — fine to start/test, not strictly compliant for a school. |
| Vercel **Pro** | ~$20 (₹1,700) | One seat (not per user). Compliant. Your traffic stays inside included limits. |
| Oracle Cloud **Always Free** VM | ₹0 | Commercial OK, no cold starts, runs as-is. More setup. |
| Domain | ~₹700 / **year** | The only unavoidable cost. |

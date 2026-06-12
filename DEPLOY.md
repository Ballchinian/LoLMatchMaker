# Deploying — Railway (backend) + Netlify (frontend)

This repo is a monorepo: **`server/`** deploys to Railway, **`client/`** deploys to Netlify.
The config files are already here:

| File | Purpose |
| ---- | ------- |
| `server/railway.json` | Railway build/start + `/api/health` healthcheck |
| `netlify.toml` (repo root) | Netlify build (base = `client`) + SPA + optional API proxy |
| `client/.env.example` | documents `VITE_API_BASE_URL` |
| `server/.env.example` | documents all backend vars |

## 0. Prerequisites

1. **Push this project to GitHub** (Railway and Netlify both deploy from a Git repo).
   ```bash
   git init && git add . && git commit -m "LoL Match Maker"
   git branch -M main
   git remote add origin https://github.com/<you>/lol-matchmaker.git
   git push -u origin main
   ```
   (`.gitignore` already excludes `node_modules` and `.env`, so your secrets won't be pushed.)
2. **MongoDB must be cloud-reachable.** A local `mongodb://127.0.0.1` URI won't work from
   Railway. Use **MongoDB Atlas** (free tier): create a cluster, a DB user, and under
   *Network Access* allow `0.0.0.0/0` (or Railway's egress IPs). Copy the connection string —
   it looks like `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/lol-matchmaker`.
3. Generate a strong **admin token** (you'll paste it into the app to unlock):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

---

## 1. Backend → Railway

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → pick this repo.
2. Open the service → **Settings**:
   - **Root Directory** = `server`  ← important (monorepo).
   - Build/Start are read from `server/railway.json` (Nixpacks runs `npm install` → `npm run build` → `npm run start`). Nothing to type.
3. **Variables** tab → add these (this is where the details go):

   | Variable | Value |
   | -------- | ----- |
   | `MONGODB_URI` | your Atlas connection string |
   | `ADMIN_TOKEN` | the random token from step 0.3 (global site-owner token) |
   | `BOT_TOKEN` | *(optional)* a second token for a Discord bot |
   | `AUTH_SECRET` | *(optional)* signs per-server website logins; falls back to the tokens above |
   | `RIOT_API_KEY` | your Riot key *(blank = manual entry only)* |
   | `RIOT_REGION` | `europe` \| `americas` \| `asia` \| `sea` |
   | `RIOT_PLATFORM` | `euw1` \| `na1` \| `kr` \| … |
   | `CLIENT_ORIGIN` | your Netlify URL (fill in **after** step 2) |

   > Do **not** set `PORT` — Railway injects it and the server reads it automatically.
4. **Settings → Networking → Generate Domain.** Copy the URL, e.g.
   `https://lol-matchmaker-production.up.railway.app`. Verify it's alive:
   open `https://<that-url>/api/health` → you should see
   `{"ok":true,"db":"connected","riot":"enabled","writeProtection":"on"}`.

---

## 2. Frontend → Netlify

1. <https://netlify.com> → **Add new site → Import an existing project** → pick this repo.
2. Build settings are read from `netlify.toml` (base `client`, publish `client/dist`).
   Just click **Deploy**.
3. **Connect the frontend to the backend** — pick ONE:

   **Option A — Netlify proxy (recommended, no CORS).** Edit `netlify.toml`, uncomment the
   `/api/*` redirect block, and set your Railway URL:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://YOUR-APP.up.railway.app/api/:splat"
     status = 200
     force = true
   ```
   Commit & push. Leave `VITE_API_BASE_URL` unset. (The browser only ever talks to Netlify,
   which forwards `/api` to Railway — so CORS never comes into play.)

   **Option B — call Railway directly.** In Netlify → **Site settings → Environment variables**
   add `VITE_API_BASE_URL = https://YOUR-APP.up.railway.app/api`, then **redeploy**. You must
   also set `CLIENT_ORIGIN` on Railway to your Netlify URL (for CORS).
4. Copy your Netlify URL (e.g. `https://lol-matchmaker.netlify.app`).

---

## 3. Wire them together

- On **Railway**, set `CLIENT_ORIGIN` to your Netlify URL and let it redeploy.
  (Required for Option B; harmless for Option A.)
- In Discord, run **`/setup password:<website admin password>`** — this registers the server
  with the backend (the FIRST server to register adopts any pre-existing single-tenant data)
  and posts the **server key** in the #info channel.
- Open your Netlify site. Top-right **Connect server** → paste the server key (to browse) and
  the admin password (to unlock admin controls, including the Discord tab). The raw
  `ADMIN_TOKEN` still works in the password box as a global site-owner unlock.
- Each Discord server the bot is invited to gets its own isolated players/matches — nothing is
  shared between servers, and a server's data is only reachable with its unguessable key.

## Where each detail goes — quick reference

| Detail | Goes in |
| ------ | ------- |
| Mongo Atlas URI | Railway → `MONGODB_URI` |
| Riot API key + region/platform | Railway → `RIOT_API_KEY` / `RIOT_REGION` / `RIOT_PLATFORM` |
| Admin token (and bot token) | Railway → `ADMIN_TOKEN` / `BOT_TOKEN` |
| Netlify site URL | Railway → `CLIENT_ORIGIN` |
| Railway backend URL | `netlify.toml` proxy **or** Netlify → `VITE_API_BASE_URL` |

## Troubleshooting

- **Frontend loads but every API call fails** → the API isn't reachable. Check the proxy URL in
  `netlify.toml` (Option A) or `VITE_API_BASE_URL` (Option B), and that `/api/health` works on Railway.
- **CORS error in console** (Option B only) → `CLIENT_ORIGIN` on Railway must exactly match your
  Netlify origin (scheme + host, no trailing slash).
- **`db: disconnected` on `/api/health`** → bad `MONGODB_URI` or Atlas Network Access doesn't allow Railway.
- **Riot dev key** expires every 24h — apply for a production key for anything long-lived.
- **Can't unlock / writes rejected** → `ADMIN_TOKEN` must be set on Railway and you must paste the
  exact same value into "Unlock admin".

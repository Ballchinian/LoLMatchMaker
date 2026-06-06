# LoL Match Maker
Inject League of Legends players (via Riot search or manually), store them in MongoDB,
then generate the **fairest** 5v5 (or any size) custom teams — with constraints like
"these two must be on opposite teams", a "don't repeat teams" re-roll, an internal
**MMR** seeded from real rank + recent form, and an Elo ladder that evolves as you record
custom-game results.

├─ server/   Express API
│  └─ src/
│     ├─ services/   rank.ts · mmr.ts · balance.ts · elo.ts · riot.ts   <- the logic
│     ├─ models/     Player.ts (append-only) · Match.ts
│     └─ routes/     auth · players · teams · matches
├─ client/   React app (Players · Team Builder · Matches)
└─ bot/      Discord bot — voice-channel orchestration + result confirm (see bot/README.md)

## Prerequisites

- **Node 18+** (built on Node 20)
- **MongoDB** — either local (`mongodb://127.0.0.1:27017`) or a free MongoDB Atlas cluster
- *(optional)* a **Riot API key** from <https://developer.riotgames.com> for player search
  (dev keys expire every 24h; manual entry works without one)

## Setup

```bash
# 1. Backend
cd server
copy .env.example .env        # Windows  (use: cp .env.example .env on macOS/Linux)
# edit .env -> set MONGODB_URI and (optionally) RIOT_API_KEY / RIOT_REGION / RIOT_PLATFORM
npm install
npm run dev                   # http://localhost:4000

# 2. Frontend (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173  (proxies /api -> :4000)
```

Open <http://localhost:5173>. The header shows DB + Riot status dots (green = ready).

### Environment (`server/.env`)

| Var                       | Meaning                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| `ADMIN_TOKEN`             | Secret that unlocks privileged actions. Blank = writes UNPROTECTED  |
| `BOT_TOKEN`               | Optional separate token for a Discord bot                           |
| `MONGODB_URI`             | Mongo connection string (defaults to local)                         |
| `RIOT_API_KEY`            | Riot key; blank = search disabled, manual entry only                |
| `RIOT_REGION`             | Routing for account/match APIs: `americas \| europe \| asia \| sea` |
| `RIOT_PLATFORM`           | Routing for summoner/league APIs: `euw1 \| na1 \| kr \| ...`        |
| `RIOT_RECENT_MATCH_COUNT` | How many recent games to sample for "form" (keep small)             |
| `CLIENT_ORIGIN`           | Allowed CORS origin (defaults to the Vite dev server)               |

## Deploy

Backend → **Railway**, frontend → **Netlify**. Config files (`server/railway.json`,
`netlify.toml`) are included. Full step-by-step with exactly where each secret goes:
see **[DEPLOY.md](DEPLOY.md)**.

## How it works

### Internal MMR (`services/mmr.ts` + `services/rank.ts`)

On injection, a player's MMR is seeded **once** and frozen as `seedMMR`:

```
base       = rankToMMR(tier, division, LP)        # 100 MMR per division, 400 per tier
adjustment = f(recent winrate, recent KDA)        # bounded ±150, scaled by sample size
seedMMR    = base + adjustment
```

`mmr` starts equal to `seedMMR` and then **evolves** via Elo. Any MMR maps back to a
website rank with `mmrToRank()` (Iron → Challenger, with divisions + LP).

### Fair team balancing (`services/balance.ts`)

For up to 20 players we enumerate **every** way to split them into two teams
(C(9,4)=126 for a 10-player lobby — trivial) and pick the one with the smallest gap in
**average** MMR. It enforces:

- `sameTeam[a,b]` — a and b on the same team
- `oppositeTeam[a,b]` — a and b on opposite teams

Each split has a canonical, mirror-invariant `key`; passing previously-seen keys as
`excludeKeys` powers the **"Re-roll (no repeat)"** button.

### Custom teams + match lifecycle

Teams can be **auto-balanced** *or* **hand-built**: auto-balance fills the two sides
fairly, then you move players between A / B / bench (⇄ ↧ →A →B) to make any matchup you
like, with the live average-MMR gap shown as you edit. A matchup then takes one of two paths:

- **Confirm now** → records the winner immediately and applies MMR.
- **Save as pending** → stores the locked-in rosters as a `pending` match with no MMR
  change yet; later the admin/bot confirms the winner from the **Matches** tab, which
  finalizes it and applies Elo. Pending matches can also be discarded.

Public (non-admin) visitors can **submit a pending** match (optionally claiming a winner +
their name) for the admin to review. A confirmed match can be **reversed** by an admin: it
undoes each player's MMR delta and W/L, but the match stays in history flagged `reversed`
(audit trail), rather than being deleted.

### Elo ladder (`services/elo.ts`)

Confirming a game rates each team by its average MMR, computes the expected result, and
moves every player's MMR toward the outcome (upsets move more). MMR is read at confirm
time, so the ladder reflects any changes since the matchup was created. Player ladder
records (W/L, games) and the `Match` document's per-player before/after are written together.

### Auth & sharing (token-gated writes)

The app is built to be **publicly shareable without abuse**. The API — not the UI — is the
security boundary: a server middleware (`middleware/auth.ts`) gates every write.

- **Public (no login):** view the roster/rankings and run the team balancer (`POST /teams/balance`
  is pure computation, no DB writes).
- **Admin / bot (token required):** inject players, search Riot, edit tags, and create/confirm
  results. The browser sends `Authorization: Bearer <ADMIN_TOKEN>`; a Discord bot can use
  `BOT_TOKEN`. Click **Unlock admin** in the header and paste your token.

If neither token is set, the server runs in **open dev mode** (writes allowed) and logs a
warning — set `ADMIN_TOKEN` before sharing. This token model upgrades cleanly to Discord
OAuth or bot-only writes later without changing the route definitions.

### Tags (roster grouping)

Players can carry any number of free-form **tags** (e.g. `office`, `jungle main`, `smurf`).
Tags are **mutable metadata** — editable inline on the Players tab — and are explicitly
*not* part of the immutable identity, so they never touch a player's MMR or seed. Both the
Players tab and the Team Builder can filter the roster by tag (match *any* selected tag),
and the Team Builder's "Select shown" button adds a whole filtered group at once.

### Immutability

Players are **append-only**: `uniqueKey` (Riot PUUID or normalized manual name) carries a
unique index, and **identity** fields (uniqueKey, source, displayName, region, Riot snapshot)
are `immutable` in the schema — the same player can't be re-uploaded (`409`). Their **ratings**
(seed MMR + current MMR) move via matches and can also be **corrected by an admin**
(`PATCH /players/:id/mmr`), and tags are freely editable.

## API quick reference

🔒 = requires admin/bot token.

| Method | Path                          | Purpose                                       |
| ------ | ----------------------------- | --------------------------------------------- |
| GET    | `/api/health`                 | DB / Riot / write-protection status           |
| GET    | `/api/auth/me`             🔒 | Validate a token, return the actor role        |
| GET    | `/api/players`                | List players (strongest first)                |
| POST   | `/api/players/search`      🔒 | Preview a Riot player (no save)               |
| POST   | `/api/players`             🔒 | Inject a player (`riot` or `manual`)          |
| PATCH  | `/api/players/:id/tags`    🔒 | Replace a player's tags                       |
| PATCH  | `/api/players/:id/mmr`     🔒 | Admin override of seed and/or current MMR     |
| POST   | `/api/teams/balance`          | Fairest split + alternatives (public)         |
| GET    | `/api/matches`                | All games (pending + confirmed)               |
| POST   | `/api/matches`             🔒 | Create a matchup; `winner` ⇒ confirm now      |
| POST   | `/api/matches/:id/confirm` 🔒 | Confirm a pending match's winner (apply MMR)  |
| POST   | `/api/matches/:id/reverse` 🔒 | Undo a confirmed match's MMR; keep it in history|
| DELETE | `/api/matches/:id`         🔒 | Discard a pending match                        |

## Notes / next steps

- Riot dev keys expire daily — swap in a production key for anything long-lived.
- Match confirmation uses sequential writes (fine for standalone Mongo). On a replica
  set this could be wrapped in a transaction.
- Auth is token-based today; natural next steps are **Discord OAuth** (per-user roles) or
  **bot-only writes** (web read-only, all mutations via Discord slash commands).
- Ideas: per-role balancing, drag-and-drop team edits, season resets.

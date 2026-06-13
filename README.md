# League Match Maker

A web application that works alongside discord to creates fair League of Legends teams using MMR calculations, Riot API integration, and match result tracking.


## Features

- Riot API to search LoL profile
- Adaptive Team balancing algorithm
- MMR tracking
- Match history
- Admin controls


## How the rating system works

Every player has two numbers:

- **MMR** — our best guess at your skill, on the same scale as League ranks (each division ≈ 100 MMR, each tier ≈ 400).
- **RD (rating deviation)** — how *sure* the system is about that guess. Think of it as a ± next to your MMR: a brand-new player might be "1500 ± 250", a long-time regular "1500 ± 75".

**Where your starting MMR comes from.** When you're added, we seed your MMR from your Riot rank (plus a small nudge from recent win rate/KDA). Manual entries start from whatever rank/MMR the admin gives them.

**Where your starting RD comes from.** The more ranked games you've played *this season*, the more we trust that rank:

| Ranked games this season | Starting RD |
|---|---|
| 0 | 250 |
| 30 | 175 |
| 100 | 118 |
| 200+ | 89 |
| No rank data at all | 300 |

**How games move your MMR.** After each inhouse, winners gain and losers lose, scaled by two things: how surprising the result was (upsets move more), and your own RD. High-RD players swing big (±70–120 per game) while the system figures them out; settled players at the RD floor of 75 move a steady ±15–40. Your RD shrinks every game you play — so a lucky streak on a new account self-corrects: each win is worth less than the last.

**Coming back after a break.** RD slowly grows if you don't play (after a free month, roughly +50²/month, capped at 300). Skip half a year and your first few games back will move you faster while you re-calibrate — no need to grind back through 20 placement-style games.

This is the same two-layer idea Riot uses (hidden MMR + uncertainty), just with one honest number instead of a hidden one.

# Multi-server (per Discord guild)

Every Discord server the bot is invited to is its own isolated tenant: players, matches and
bot commands all carry the server's guild id and are never shared between servers.

- `/setup password:<...>` registers the server and returns an unguessable **server key**
  (posted in the #info channel as a one-click link `https://<site>/s/<key>`). Opening the link
  scopes the site to that server and then strips the key from the URL (it's kept in
  localStorage and sent as `X-Server-Key`); the key can also be pasted manually.
- The **admin password** (scrypt-hashed in MongoDB) is set by the **guild owner** on the first
  `/setup`, and exchanged at login for a signed, expiring, **version-stamped** token that unlocks
  admin actions for that server only. Setting or changing the password is owner-only; changing it
  bumps the version and logs out old sessions.
- The **server key** can be rotated (owner-only, `/setup rotate_key:true`) to cut off anyone
  who still has the old one.
- All data requests resolve their scope from the token / the bot's `X-Guild-Id` header /
  the public `X-Server-Key` header — an unknown or missing key sees nothing.
- **Lifecycle:** the bot purges a server's data when it's kicked (`GuildDelete`), and a
  reaper deletes servers with no activity for `REAP_INACTIVE_DAYS` (default 120) plus prunes
  reversed matches older than `REVERSED_PRUNE_DAYS` (default 30). A `MAX_SERVERS` cap is
  available. Dead servers therefore don't accumulate storage or polling cost.

# API Endpoints

## Health
- `GET /api/health` — DB / Riot / write-protection status

## Authentication & servers
- `GET /api/auth/me` 🔒 — Validate a token and return the actor role (+ server, if scoped)
- `POST /api/servers/register` 🔒 — (bot/global only) Register/update a Discord server; returns
  its key. Setting the password (first setup included), changing it, and key rotation are all
  owner-only (enforced by comparing the bot-reported invoker against the guild owner).
- `POST /api/servers/login` — Server key + admin password → per-server admin token (rate
  limited + per-key lockout after repeated failures)
- `GET /api/servers/lookup?key=` — Resolve a server key to its server name
- `DELETE /api/servers/:guildId` 🔒 — (bot/global only) Purge a server and all its data

## Players
- `GET /api/players` — List players (strongest first)
- `POST /api/players/search` 🔒 — Preview a Riot player (no save)
- `POST /api/players` 🔒 — Inject a player (`riot` or `manual`)
- `PATCH /api/players/:id/tags` 🔒 — Replace a player's tags
- `PATCH /api/players/:id/mmr` 🔒 — Admin override of seed MMR, current MMR and/or RD
- `PATCH /api/players/:id/roles` 🔒 — Set champion-pool depth (the versatility MMR modifier)
- `POST /api/players/:id/reset` 🔒 — Reset one player (riot refresh, re-seed, zero record).
  "Server reset" is the website calling this per player in sequence (paced for Riot limits,
  cancellable) — there's no bulk endpoint.
- `DELETE /api/players/:id` 🔒 — Permanently delete a player (blocked while in an open match)

## Teams
- `POST /api/teams/balance` — Fairest split plus alternative balanced teams

## Matches
- `GET /api/matches` — All games (proposed, in progress and confirmed)
- `POST /api/matches` 🔒* — Create a matchup; public proposers must identify as a roster
  player (one open proposal each) and receive a one-time proposal token
- `POST /api/matches/:id/confirm` 🔒 — Confirm a match and apply MMR
- `POST /api/matches/:id/start` 🔒 — Proposed → in progress (enforces one active game per player)
- `POST /api/matches/:id/stop` 🔒 — Cancel: in progress → proposed (nothing deleted)
- `POST /api/matches/:id/reverse` 🔒 — Reverse MMR changes while keeping history
- `DELETE /api/matches/:id` — Delete a proposed/in-progress match (admin, or the proposer
  with their `X-Proposal-Token`)

## Discord command queue (website Discord tab)
- `POST /api/bot-commands` 🔒 — Queue a match action for the bot to run in Discord
- `GET /api/bot-commands` 🔒 — Recent commands + the bot's outcomes
- `POST /api/bot-commands/claim-next` 🔒 — (bot/global only) Claim the next queued command across
  all guilds in one request (so polling cost is constant, not per-server)
- `POST /api/bot-commands/:id/complete` 🔒 — (bot) Report the outcome

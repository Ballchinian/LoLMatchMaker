# League Match Maker

A web application that works alongside discord to creates fair League of Legends teams using MMR calculations, Riot API integration, and match result tracking.


## Features

- Riot API to search LoL profile
- Adaptive Team balancing algorithm
- MMR tracking
- Match history
- Role-based matchmaking
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

# API Endpoints

## Health
- `GET /api/health` — DB / Riot / write-protection status

## Authentication
- `GET /api/auth/me` 🔒 — Validate a token and return the actor role

## Players
- `GET /api/players` — List players (strongest first)
- `POST /api/players/search` 🔒 — Preview a Riot player (no save)
- `POST /api/players` 🔒 — Inject a player (`riot` or `manual`)
- `PATCH /api/players/:id/tags` 🔒 — Replace a player's tags
- `PATCH /api/players/:id/mmr` 🔒 — Admin override of seed MMR, current MMR and/or RD

## Teams
- `POST /api/teams/balance` — Fairest split plus alternative balanced teams

## Matches
- `GET /api/matches` — All games (pending and confirmed)
- `POST /api/matches` 🔒 — Create a matchup; optionally confirm immediately
- `POST /api/matches/:id/confirm` 🔒 — Confirm a pending match and apply MMR
- `POST /api/matches/:id/reverse` 🔒 — Reverse MMR changes while keeping history
- `DELETE /api/matches/:id` 🔒 — Discard a pending match            |

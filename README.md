
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

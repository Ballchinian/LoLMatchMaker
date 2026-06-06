# LoL Match Maker — Discord bot

Phase 1: the bot is a **voice-channel orchestrator + result helper** for the inhouse.
Admins build teams on the website; the bot sets up locked team voice channels, moves
players, and lets an admin confirm the result (which calls the website with `BOT_TOKEN`).
No Riot integration required.

## Voice layout

```
INHOUSE (category)
├─ 🔊 Lobby                 persistent — waiting room (set LOBBY_CHANNEL_ID)
└─ per match (auto-created, auto-deleted):
   ├─ 🎙️ Game Comms         all 10 players in this game (both teams)
   ├─ 🔵 Team A              locked to Team A
   └─ 🔴 Team B              locked to Team B
```

## Discord setup (do this once)

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy into `DISCORD_TOKEN`. Under *Privileged Gateway
   Intents*, enable **Server Members Intent** (Voice State access is not privileged).
3. **General Information** → copy **Application ID** into `DISCORD_CLIENT_ID`.
4. Invite the bot (OAuth2 → URL Generator): scopes **`bot`** + **`applications.commands`**;
   bot permissions **Manage Channels, Manage Roles, Move Members, View Channels, Connect**.
   Open the generated URL and add it to your server.
5. Copy your **server id** (enable Developer Mode → right-click server → Copy ID) into `DISCORD_GUILD_ID`.
6. Create a persistent **Lobby** voice channel; copy its id into `LOBBY_CHANNEL_ID`.

## Run

```bash
cd bot
cp .env.example .env     # fill in the values above + API_BASE_URL + BOT_TOKEN
npm install
npm run register        # registers slash commands to your server (run once / when commands change)
npm run dev
```

`BOT_TOKEN` must match the backend's `BOT_TOKEN` so the bot is authorized to write.

## Commands (Phase 1)

All `/match` commands act on **pending** games only — completed and reversed games don't
appear in the picker.

| Command | Who | What |
| ------- | --- | ---- |
| `/link player:<name>` | anyone | link your Discord account to your site player |
| `/match setup match:<pending>` | admin | create Game Comms + Team A/B, move linked players in |
| `/match split match:<pending>` | admin | move players from Game Comms into their team channels |
| `/match confirm match:<pending> winner:<A\|B>` | admin | record the result (applies MMR), return players to Lobby, delete channels |
| `/match cancel match:<pending>` | admin | abort: return players to Lobby + delete channels; match stays pending (can re-setup) |

## Typical flow

1. Admin builds teams on the website and **saves as pending** (or a player submits for review).
2. `/match setup` → bot creates Game Comms + Team A/B and pulls the linked players in.
3. Champ select in Game Comms → `/match split` moves them into their team channels.
4. Game ends → `/match confirm winner:A|B` — applies MMR, returns everyone to Lobby, deletes channels.
   - Need to abort instead? `/match cancel` clears the channels but leaves the match pending.

## Deploy on Railway (separate service)

The bot is a **worker** (connects out to Discord) — no port, domain, or healthcheck.

1. Railway → your project → **New → GitHub Repo** → same repo.
2. Service **Settings → Root Directory** = `bot`. (Build/start come from `bot/railway.json`.)
3. **Variables** — add everything from `.env.example`:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
   - `BOT_TOKEN` — **must match** the backend service's `BOT_TOKEN`
   - `API_BASE_URL` — your backend's public URL **incl. `/api`**, e.g. `https://your-app.up.railway.app/api`
   - `LOBBY_CHANNEL_ID` (for returning players to Lobby), optional `ADMIN_ROLE_ID`, `INHOUSE_CATEGORY`
4. Deploy. The bot **auto-registers its slash commands on startup** — no separate step.
   Watch **Deploy Logs** for `logged in as …` and `registered N slash command(s)`.

`tsx` is a runtime dependency, so `npm run start` works on the server as-is.


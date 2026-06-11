
## Discord setup (do this once)

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy into `DISCORD_TOKEN`. Under *Privileged Gateway
   Intents*, enable **Server Members Intent** (Voice State access is not privileged).
3. **General Information** → copy **Application ID** into `DISCORD_CLIENT_ID`.
4. Invite the bot (OAuth2 → URL Generator): scopes **`bot`** + **`applications.commands`**;
   bot permissions **Manage Roles, Manage Channels, Manage Messages, Manage Threads,
   Create Public Threads, Send Messages, Send Messages in Threads, Read Message History,
   View Channels, Connect, Move Members** (permissions integer `326703852560`).
   The bot can only hand out channel permissions it holds itself, so /setup FAILS without all of these.
   Open the generated URL and add it to your server. (Already invited with fewer perms? No
   re-invite needed: Server Settings → Roles → the bot's role → enable the missing ones.)
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

All slash commands only work in the **commands channel** (`COMMANDS_CHANNEL_NAME`, default
`#commands`). Normal messages there are auto-deleted, so the bot's match-vote polls never get
buried; each vote opens a thread ("match chat") where members CAN talk, locked when it resolves.

| Command | Who | What |
| ------- | --- | ---- |
| `/link player:<name> roles:<1-5> champs:<pool>` | anyone | link your Discord account (answering the two versatility questions) → unlocks the server + assigns your rank role |
| `/update [roles] [champs]` | anyone | change your versatility answers later |
| `/unlink` | anyone | unlink your own account (linked the wrong one?); admins can pass `player:` to unlink anyone |
| `/setup` | admin | create the Match Admin + Linked roles, 10 rank roles, the commands channel, and a read-only info channel (website + signup + command guide) |
| `/syncroles` | admin | re-sync every linked member's rank role from the website |
| `/match setup match:<pending>` | admin (non-admins trigger a lobby-majority 👍/👎 vote) | create the channels and send players straight to their team channels |
| `/match split match:<pending>` | admin | move players (back) into their team channels |
| `/match join match:<pending>` | admin | pull everyone into the shared Game Comms channel |
| `/match confirm match:<pending> winner:<A\|B>` | admin | record the result (applies MMR), sync rank roles, return players to Lobby, delete channels |
| `/match cancel match:<pending>` | admin | abort: return players to Lobby + delete channels; match stays pending (can re-setup) |

The bot also sweeps every minute: voice channels belonging to a match that's no longer pending
(cancelled/confirmed/deleted from the website) get their members sent back to Lobby and removed.

## Onboarding: commands-channel gate + rank roles

New members should only see the **commands channel** until they link, then get a Discord role
matching their website rank (Iron … Challenger) that stays in sync.

One-time setup:
1. Run **`/setup`** — creates the `Match Admin` role (give it to your admins; holders can run
   admin commands without "Manage Server"), the `Linked` role (with View Channels), the 10 tier
   roles, the commands channel visible to everyone (slash-commands-only: typing is
   blocked/auto-deleted), and a read-only `#info` channel where the bot posts the website link,
   signup steps, and the command guide (re-running `/setup` refreshes that post).
2. In **Server Settings → Roles → @everyone**, turn **OFF** "View Channels".
3. Make sure the **bot's own role sits ABOVE all the rank roles** (Server Settings → Roles)
   so it can assign them.

Now: unlinked members see only the commands channel. Running **/link** there grants the `Linked`
role (unlocking the server) plus their rank role. Ranks re-sync automatically when a match is
confirmed; run **/syncroles** after manual MMR edits on the website.

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
   - `LOBBY_CHANNEL_ID` (for returning players to Lobby), optional `ADMIN_ROLE_ID`/`ADMIN_ROLE_NAME`, `INHOUSE_CATEGORY`
4. Deploy. The bot **auto-registers its slash commands on startup** — no separate step.
   Watch **Deploy Logs** for `logged in as …` and `registered N slash command(s)`.

`tsx` is a runtime dependency, so `npm run start` works on the server as-is.


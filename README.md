# League Match Maker

A Discord bot and website for running League of Legends inhouses. It links your Riot account, builds balanced teams from the data, keeps track of how everyone's doing over time, and handles the tedious lobby admin, making voice channels, shuffling people into teams, and recording who won.

## Features

- Riot account linking, with ratings seeded from ranked
- Team balancing that adapts as it learns who's actually carrying
- Glicko-style ratings (an MMR plus an uncertainty value)
- Match history and per-player stats
- Voice channel automation for matches
- Auto-assigned Discord rank roles
- Multi-server support, fully isolated per server
- Players can propose their own matches
- Admin / moderation tools

Endpoint docs live in [ENDPOINTS.md](./ENDPOINTS.md).

## How ratings work

Each player has two numbers. The MMR is the system's guess at your skill, and the RD (rating deviation) is how confident it is in that guess. Lower RD means more certain. The easiest way to read RD is as a ± on your MMR: a new player might be 1500 ± 250, while a regular sits closer to 1500 ± 75.

### Seeding a new player

When you link a Riot account we pull your ranked data for a starting MMR, then adjust it by your current-season win rate. That adjustment caps at around ±400 (roughly a full tier), but you only get the full swing with a decent sample behind it. Around 70% over 30 games earns the +400; five games barely register. Manual players just start from whatever rating an admin gives them.

### Starting confidence

The more ranked games you've played this season, the lower your starting RD:

| Ranked games | Starting RD |
| --- | --- |
| 0 | 250 |
| 30 | 175 |
| 100 | 118 |
| 200+ | 89 |
| No rank data | 300 |

### After a match

Winners gain MMR, losers lose it. How much you move depends on two things: how surprising the result was (upsets shift everyone more), and how high your RD is (if the system's still learning you, it adjusts harder). The more you play, the lower your RD gets, so your rating settles down and stops swinging around. Established players barely move game to game, which is the whole idea.

### Coming back from a break

If you stop playing for a while, your RD slowly climbs back up. So when you return you'll see bigger rating swings for the first few games while it recalibrates. That's expected, not the system being broken.

## Discord

Each server runs independently. The bot takes care of account linking, match setup, team voice channels, rank role syncing, result reporting, and onboarding. Nothing is shared between guilds, each server's data stays in that server.

### Player commands

| Command | What it does |
| --- | --- |
| `/link` | Link your Discord account to a player profile |
| `/update` | Update your champion pool |
| `/unlink` | Unlink your account |

### Admin commands

| Command | What it does |
| --- | --- |
| `/setup` | Configure channels, roles, and website access |
| `/syncroles` | Sync Discord rank roles |
| `/match setup` | Create match channels and move players in |
| `/match split` | Split players into their team channels |
| `/match join` | Pull players into the shared game channel |
| `/match confirm` | Record the winner and update ratings |
| `/match cancel` | Send everyone back to the lobby and remove the match channels |

## Match lifecycle

Matches go through three stages.

A **proposed** match has been created but hasn't started. The proposer can delete their own, and admins can delete any of them.

Once it's **in progress**, everyone has to be in the lobby, and nobody can be in two active matches at the same time. If something goes wrong you can cancel it, which knocks it back to proposed.

A **confirmed** match is done. Ratings get applied, it's saved to match history, and Discord rank roles sync up automatically.

## A typical match

1. Balance the teams on the website.
2. Propose the match.
3. Everyone joins the Discord lobby.
4. Start it.
5. `/match setup` makes the team channels and moves people in.
6. Play the game.
7. `/match confirm winner:A|B` records the result.
8. If the Riot API can't confirm the winner, players vote instead.
9. Ratings and rank roles update on their own.
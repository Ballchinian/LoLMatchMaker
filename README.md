# League Match Maker

A Discord-integrated League of Legends inhouse platform that creates balanced teams using Riot data, tracks player ratings, and automates match management from lobby creation through result reporting.

## Features

* Riot account integration
* Adaptive team balancing
* MMR and uncertainty-based rating system
* Match history and statistics
* Discord voice channel automation
* Automatic Discord rank roles
* Multi-server support
* Player match proposals
* Admin moderation tools

## Documentation

* [API Endpoints](./ENDPOINTS.md)

---

# How the Rating System Works

Every player has two numbers:

* **MMR** — our best estimate of your skill level.
* **RD (Rating Deviation)** — how confident the system is in that estimate.

Think of RD as a ± value beside your MMR. A new player might be 1500 ± 250, while an established player could be 1500 ± 75.

### Initial Rating

When a Riot account is added, the system seeds MMR from the player's ranked data, then adjusts it by current-season ranked **win rate** — up to ±400 (a full tier) for a well-backed sample (e.g. 70% over 30 games → +400; a handful of games barely moves it).

Manual players start from the rating assigned by an administrator.

### Initial Confidence

The more ranked games played during the current season, the more confidence the system has in the initial rating.

| Ranked Games | Starting RD |
| ------------ | ----------- |
| 0            | 250         |
| 30           | 175         |
| 100          | 118         |
| 200+         | 89          |
| No rank data | 300         |

### Rating Changes

After every match:

* Winners gain MMR.
* Losers lose MMR.
* Unexpected results create larger rating changes.
* High-RD players move more dramatically while the system learns their skill level.
* RD decreases as more games are played.

Established players typically see smaller and more stable rating adjustments.

### Returning Players

RD gradually increases after extended inactivity.

Players returning after a long break therefore experience larger rating movements for a few matches while the system recalibrates their rating.

---

# Discord Integration

Each Discord server operates independently.

The bot manages:

* Account linking
* Match setup
* Team voice channels
* Rank role synchronization
* Result reporting
* Server onboarding

Server data is isolated and never shared between guilds.

---

# Player Commands

| Command   | Description                                   |
| --------- | --------------------------------------------- |
| `/link`   | Link your Discord account to a player profile |
| `/update` | Update your champion pool selection           |
| `/unlink` | Unlink your account                           |

---

# Admin Commands

| Command          | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `/setup`         | Configure channels, roles and website access          |
| `/syncroles`     | Synchronize Discord rank roles                        |
| `/match setup`   | Create match channels and move players                |
| `/match split`   | Move players into team voice channels                 |
| `/match join`    | Move players into the shared game channel             |
| `/match confirm` | Record a winner and update ratings                    |
| `/match cancel`  | Return players to the lobby and remove match channels |

---

# Match Lifecycle

## Proposed

A match has been created but has not yet started.

* Can be deleted.
* The original proposer may delete their own proposal.
* Administrators may delete any proposal.

## In Progress

The match has been started.

Requirements:

* All players must be present in the lobby.
* Players may only participate in one active match at a time.

An in-progress match may be cancelled, returning it to Proposed status.

## Confirmed

The result has been recorded.

* Ratings are updated.
* Match history is preserved.
* Discord rank roles are synchronized automatically.

---

# Typical Flow

1. Teams are balanced on the website.
2. A match is proposed.
3. Players join the Discord lobby.
4. The match is started.
5. `/match setup` creates team channels and moves players.
6. Players complete their game.
7. `/match confirm winner:A|B` records the result.
8. If Riot API fails, then players vote for the winner
9. Ratings and Discord roles update automatically.

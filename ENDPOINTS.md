# API Endpoints

This document describes the League Match Maker backend API.

## Authentication

Endpoints marked with 🔒 require authentication.

Authentication may be provided through:

* Admin JWT token
* Bot token
* Server key (public access where permitted)

---

# Health

## GET `/api/health`

Returns backend health information.

### Response

* Database status
* Riot API status
* Write protection status

---

# Authentication & Servers

## GET `/api/auth/me` 🔒

Validate an authentication token and return information about the current actor.

### Returns

* Actor role
* Server information (when scoped)

---

## POST `/api/servers/register` 🔒

Register or update a Discord server.

Owner-only actions:

* Initial setup
* Password changes
* Server key rotation

### Returns

* Server key

---

## POST `/api/servers/login`

Authenticate as a server administrator.

### Input

* Server key
* Admin password

### Returns

* Signed admin token

### Notes

* Rate limited
* Temporary lockout after repeated failures

---

## GET `/api/servers/lookup?key=`

Resolve a server key.

### Returns

* Server name

---

## DELETE `/api/servers/:guildId` 🔒

Delete a server and all associated data.

Bot/global authentication only.

---

# Players

## GET `/api/players`

Retrieve all players.

### Returns

Players ordered by rating.

---

## POST `/api/players/search` 🔒

Preview Riot account information without creating a player.

---

## POST `/api/players` 🔒

Create a player.

### Supported Types

* Riot player
* Manual player

---

## PATCH `/api/players/:id/tags` 🔒

Replace a player's tags.

---

## PATCH `/api/players/:id/mmr` 🔒

Admin rating override.

### Supported Changes

* Seed MMR
* Current MMR
* Rating deviation (RD)

---

## PATCH `/api/players/:id/roles` 🔒

Update champion pool depth information.

Used by the balancing algorithm's versatility modifier.

---

## POST `/api/players/:id/reset` 🔒

Reset a player.

### Effects

* Refresh Riot information
* Re-seed rating
* Clear match record

### Notes

Server-wide reset functionality is implemented by calling this endpoint for each player.

---

## DELETE `/api/players/:id` 🔒

Permanently delete a player.

### Restrictions

Cannot delete players currently participating in an open match.

---

# Team Balancing

## POST `/api/teams/balance`

Generate balanced teams.

### Returns

* Best available team split
* Alternative balanced team configurations

---

# Matches

## GET `/api/matches`

Retrieve match history.

### Includes

* Proposed matches
* In-progress matches
* Confirmed matches

---

## POST `/api/matches` 🔒

Create a match proposal.

### Rules

* Public users must identify as a roster player.
* Only one open proposal per player.
* Proposal creators receive a proposal token.

---

## POST `/api/matches/:id/start` 🔒

Move a match from Proposed to In Progress.

### Requirements

* Every player must be present in the Discord lobby.
* Players may only participate in one active match.

---

## POST `/api/matches/:id/stop` 🔒

Move a match from In Progress back to Proposed.

### Effects

* No ratings are changed.
* Match remains available for setup later.

---

## POST `/api/matches/:id/confirm` 🔒

Confirm a match result.

### Effects

* Updates player ratings
* Records the result permanently

---

## POST `/api/matches/:id/reverse` 🔒

Reverse rating changes from a confirmed match.

### Effects

* Restores previous ratings
* Preserves match history

---

## DELETE `/api/matches/:id` 🔒

Delete a match.

### Allowed States

* Proposed
* In Progress

### Permissions

* Administrators may delete any match.
* Proposal creators may delete their own proposed matches using their proposal token.

---

# Discord Command Queue

Used by the website to request Discord actions from the bot.

## POST `/api/bot-commands` 🔒

Queue a command for the Discord bot.

---

## GET `/api/bot-commands` 🔒

Retrieve recent commands and outcomes.

---

## POST `/api/bot-commands/claim-next` 🔒

Bot endpoint used to claim the next queued command.

### Notes

Commands are claimed globally across all servers.

---

## POST `/api/bot-commands/:id/complete` 🔒

Mark a queued command as completed.

### Includes

* Success status
* Failure information
* Execution result

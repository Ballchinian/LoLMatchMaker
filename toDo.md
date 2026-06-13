*Done:*
> Bot no longer announces website-admin actions in the Discord channel (was bloat). The Discord tab's command outcomes now go only to the website's command log; new-proposal @admin pings and the 2h-expiry notice stay.
> Dead servers auto-purge: when the bot is kicked (GuildDelete) it deletes that server + its players/matches/commands; a backend reaper also deletes servers with no activity for REAP_INACTIVE_DAYS (default 120) and prunes reversed matches older than REVERSED_PRUNE_DAYS (default 30). BotCommands self-expire via a 7-day TTL index. A MAX_SERVERS hard cap is available.
> "Roles" (rolesPlayed, the info-only 1-5 field) removed from the database, the website editor and the README. Champion-pool depth (the actual MMR modifier) stays.
> Player delete (website-only, admin): per-player "Delete player" button on the Players tab with confirmation; blocked while the player is in an open match (confirmed history keeps its own snapshots). No bot command for it, per request.
> Security hardening: trust-proxy so the rate limiter keys on the real client IP (not the proxy); per-server-key login lockout after repeated wrong passwords; version-stamped login tokens so rotating the password logs out old admin sessions; owner-only password change + server-key rotation (/setup rotate_key:true); /servers/register restricted to the bot/global admin; refuse to boot in production with no tokens set.
> Bot polling made scale-safe: ONE global "claim next command" request instead of one per guild every 5s (so website Discord-tab buttons still run in ~5s no matter how many servers the bot is in). The per-guild reconciliation sweep stays a uniform 60s — an earlier warm/cold tiering was removed because it could delay a new-proposal ping by up to 15 min and the global claim + reaper already bound the cost.
> Discord #info post split into multiple messages (it had outgrown Discord's 2000-char limit and /setup was crashing); re-running /setup edits them in place.

*Pending:*

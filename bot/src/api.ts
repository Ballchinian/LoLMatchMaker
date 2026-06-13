import { config } from './config';

/*
    Minimal client for the Match Maker backend, authenticated as the `bot` actor.
    Every call names its Discord guild (X-Guild-Id): the backend partitions all
    players/matches per server, so the bot must always say which one it means.
*/

async function req<T>(
    guildId: string,
    path: string,
    init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
    const { timeoutMs = 15_000, ...rest } = init ?? {};
    const res = await fetch(`${config.API_BASE_URL}${path}`, {
        ...rest,
        //Fail fast instead of hanging on a cold/unreachable API. Autocomplete
        //passes a much tighter budget (Discord only allows ~3s to respond).
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.BOT_TOKEN}`,
            //Omitted for global calls (e.g. claim next across all guilds)
            ...(guildId ? { 'X-Guild-Id': guildId } : {}),
            ...(rest.headers ?? {}),
        },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        throw new Error((data && data.error) || `API ${res.status} ${res.statusText}`);
    }
    return data as T;
}

export interface ApiPlayer {
    id: string;
    displayName: string;
    mmr: number;
    seedMMR: number;
    rd: number;
    wins: number;
    losses: number;
    gamesPlayed: number;
    champPool: ChampPool;
    discordUserId?: string;
    rank: { tier: string; label: string };
}

export interface ApiRosterEntry {
    player: string;
    displayName: string;
    mmrAtCreate: number;
}

export interface ApiMatch {
    _id: string;
    status: 'pending' | 'inProgress' | 'confirmed' | 'reversed';
    name?: string;
    teamA: ApiRosterEntry[];
    teamB: ApiRosterEntry[];
    winner: 'A' | 'B' | null;
    proposedWinner?: 'A' | 'B' | null;
    reportedBy?: string;
    //Discord id of the (non-admin) player who proposed this match, if known
    proposedByDiscordId?: string | null;
    //Set while inProgress; drives the ~2h auto-expiry
    startedAt?: string | null;
    createdAt: string;
}

export const apiGetPlayers = (guildId: string, timeoutMs?: number) =>
    req<{ players: ApiPlayer[] }>(guildId, '/players', { timeoutMs }).then((r) => r.players);

export const apiGetMatches = (guildId: string, timeoutMs?: number) =>
    req<{ matches: ApiMatch[] }>(guildId, '/matches', { timeoutMs }).then((r) => r.matches);

//pending -> inProgress (game channels are up, the match is being played)
export const apiStartMatch = (guildId: string, id: string) =>
    req<{ match: ApiMatch }>(guildId, `/matches/${id}/start`, { method: 'POST' }).then((r) => r.match);

//inProgress -> pending (the active game was cancelled)
export const apiStopMatch = (guildId: string, id: string) =>
    req<{ match: ApiMatch }>(guildId, `/matches/${id}/stop`, { method: 'POST' }).then((r) => r.match);

export const apiConfirmMatch = (guildId: string, id: string, winner: 'A' | 'B') =>
    req<{ players: ApiPlayer[] }>(guildId, `/matches/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ winner }),
  }).then((r) => r.players);

//Remove a pending/in-progress match entirely (in-progress deletion voids the game)
export const apiDeleteMatch = (guildId: string, id: string) =>
    req<{ ok: boolean }>(guildId, `/matches/${id}`, { method: 'DELETE' });

/*
    Ask the server to find the played custom game in Riot match history.
    null = couldn't tell (customs aren't guaranteed to be indexed) — ask the humans.
    Generous timeout: the server fans out several Riot API calls.
*/
export const apiDetectWinner = (guildId: string, id: string) =>
    req<{ detected: { winner: 'A' | 'B'; gameId: string } | null }>(guildId, `/matches/${id}/detected-winner`, {
    timeoutMs: 30_000,
  }).then((r) => r.detected);


//Inject (create) a player from a Riot ID. Throws if the account is already on the
//roster. `addedBy` records who created it (the /link invoker) for provenance.
export const apiInjectRiotPlayer = (guildId: string, gameName: string, tagLine: string, addedBy?: string) =>
    req<{ player: ApiPlayer }>(guildId, '/players', {
        method: 'POST',
        body: JSON.stringify({ source: 'riot', gameName, tagLine, addedBy }),
    }).then((r) => r.player);

//Permanently delete a player (used by /unlink to remove an unplayed self-add).
export const apiDeletePlayer = (guildId: string, playerId: string) =>
    req<{ ok: boolean }>(guildId, `/players/${playerId}`, { method: 'DELETE' });

//Link a player to a Discord user.

export const apiLinkDiscord = (guildId: string, playerId: string, discordUserId: string | null) =>
    req<{ player: ApiPlayer }>(guildId, `/players/${playerId}/discord`, {
    method: 'PATCH',
    body: JSON.stringify({ discordUserId }),
  }).then((r) => r.player);

export type ChampPool = 'one-trick' | 'two-trick' | 'diverse';

//Set a player's champion pool depth (the only versatility MMR modifier).
export const apiUpdateRoles = (
    guildId: string,
    playerId: string,
    input: { champPool: ChampPool },
) =>
    req<{ player: ApiPlayer }>(guildId, `/players/${playerId}/roles`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((r) => r.player);

/* ----------------------- multitenancy / setup ------------------------- */

// /setup registers this guild as a tenant; returns the website server key.
export const apiRegisterServer = (
    guildId: string,
    input: { guildName: string; ownerId: string; invokerId: string; password?: string; rotateKey?: boolean },
) =>
    req<{ serverKey: string; created: boolean; rotatedKey?: boolean }>(guildId, '/servers/register', {
    method: 'POST',
    body: JSON.stringify({ guildId, ...input }),
  });

//Purge this guild and all its data (called when the bot is kicked).
export const apiPurgeServer = (guildId: string) =>
    req<{ ok: boolean }>(guildId, `/servers/${guildId}`, { method: 'DELETE' });

/* --------------------------- command queue ----------------------------- */

export interface ApiBotCommand {
    _id: string;
    guildId: string | null;
    action: 'setup' | 'split' | 'join' | 'cancel' | 'confirm' | 'delete';
    match: string;
    matchLabel: string;
    winner?: 'A' | 'B';
    status: 'queued' | 'running' | 'done' | 'error';
    result?: string;
    createdAt: string;
}

/*
    Claim the oldest queued website command across ALL of the bot's guilds in one
    request (constant polling cost regardless of how many servers the bot is in).
    The returned command carries its own guildId. No X-Guild-Id needed.
*/
export const apiClaimNextBotCommand = () =>
    req<{ command: ApiBotCommand | null }>('', '/bot-commands/claim-next', {
        method: 'POST',
        timeoutMs: 8_000,
    }).then((r) => r.command);

export const apiCompleteBotCommand = (guildId: string, id: string, ok: boolean, result: string) =>
    req<{ command: ApiBotCommand }>(guildId, `/bot-commands/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ ok, result: result.slice(0, 2000) }),
    });

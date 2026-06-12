import {
    ChannelType,
    OverwriteType,
    PermissionFlagsBits,
    type CategoryChannel,
    type Guild,
    type OverwriteResolvable,
    type VoiceChannel,
} from 'discord.js';
import { config } from '../config';

//Find (or create) the inhouse category that holds match channels.
export async function ensureCategory(guild: Guild): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === config.INHOUSE_CATEGORY,
    ) as CategoryChannel | undefined;
    if (existing) return existing;
    return guild.channels.create({ name: config.INHOUSE_CATEGORY, type: ChannelType.GuildCategory });
}

//Find the persistent Lobby voice channel by name (null if it doesn't exist yet)
export function findLobbyChannel(guild: Guild): VoiceChannel | null {
    return (
        guild.channels.cache.find(
            (c): c is VoiceChannel => c.type === ChannelType.GuildVoice && c.name === config.LOBBY_CHANNEL_NAME,
        ) ?? null
    );
}

//Find or create the Lobby voice channel (lives in the inhouse category)
export async function ensureLobbyChannel(guild: Guild): Promise<VoiceChannel> {
    const existing = findLobbyChannel(guild);
    if (existing) return existing;
    const category = await ensureCategory(guild);
    return guild.channels.create({
        name: config.LOBBY_CHANNEL_NAME,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: 'Match Maker lobby channel',
    });
}

//@everyone can't connect; only the listed members can. The bot keeps full access to its own channels.
function lockOverwrites(guild: Guild, allowMemberIds: string[]): OverwriteResolvable[] {
    
    //Member overwrites take priority over role overwrites in Discord's permission hierarchy.
    const overwrites: OverwriteResolvable[] = [
        {
            id: guild.roles.everyone.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.Connect],
        },
        ...allowMemberIds.map((id) => ({
            id,
            type: OverwriteType.Member,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
        })),
    ];
    
    //Ensure the bot can always see/manage/move within the channels it creates,
    const meId = guild.members.me?.id;
    if (meId) {
        overwrites.push({
            id: meId,
            type: OverwriteType.Member,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
            ],
        });
    }
    return overwrites;
}

export interface CreatedChannels {
    categoryId: string;
    gameCommsId: string;
    teamAId: string;
    teamBId: string;
}

//Create the Game Comms + Team A + Team B voice channels with locked permissions
export async function createMatchChannels(
    guild: Guild,
    parent: CategoryChannel,
    label: string,
    allMemberIds: string[],
    teamAMemberIds: string[],
    teamBMemberIds: string[],
): Promise<CreatedChannels> {
    const gameComms = await guild.channels.create({
        name: `🎙️ ${label} — Game`,
        type: ChannelType.GuildVoice,
        parent: parent.id,
        permissionOverwrites: lockOverwrites(guild, allMemberIds),
    });
    const teamA = await guild.channels.create({
        name: `🏹 ${label} — Team A`,
        type: ChannelType.GuildVoice,
        parent: parent.id,
        permissionOverwrites: lockOverwrites(guild, teamAMemberIds),
    });
    const teamB = await guild.channels.create({
        name: `🔪 ${label} — Team B`,
        type: ChannelType.GuildVoice,
        parent: parent.id,
        permissionOverwrites: lockOverwrites(guild, teamBMemberIds),
    });
    return { categoryId: parent.id, gameCommsId: gameComms.id, teamAId: teamA.id, teamBId: teamB.id };
}

//Move members (who are currently in any voice channel) into `channelId`. Returns count moved.
export async function moveMembers(
    guild: Guild,
    memberIds: string[],
    channelId: string,
): Promise<number> {
    let moved = 0;
    for (const id of memberIds) {
        try {
            const member = await guild.members.fetch(id);
            if (member.voice.channelId) {
                await member.voice.setChannel(channelId);
                moved++;
            }
        } catch {
        //not in voice, or not a member — skip
        }
    }
    return moved;
}

//Result of deleting channels
export interface DeleteResult {
    deleted: number;
    errors: string[];
}

export async function deleteChannels(guild: Guild, ids: string[]): Promise<DeleteResult> {
    let deleted = 0;
    const errors: string[] = [];
    for (const id of ids) {
        //Fetch fresh so we always act on a current, manageable channel object.
        const ch = (await guild.channels.fetch(id).catch(() => null)) ?? guild.channels.cache.get(id) ?? null;
        if (!ch) continue;
        try {
            await ch.delete();
            deleted++;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            errors.push(`${ch.name}: ${reason}`);
            console.error('[voice] failed to delete channel', ch.name, err);
        }
    }
    return { deleted, errors };
}

/*
    Locate a match's voice channels by their name tag (e.g. "#70f4"), so setup/end/split
    work regardless of in-memory state (survives bot restarts).
*/
export interface FoundChannels {
    all: VoiceChannel[];
    gameComms?: VoiceChannel;
    teamA?: VoiceChannel;
    teamB?: VoiceChannel;
}

//Extract the match label from a managed channel name (e.g. "Funky Lobby — Team A" → "Funky Lobby"). */
function labelFromChannelName(name: string): string | null {
    const m = name.match(/^\S+ (.+) — (Game|Team A|Team B)$/u);
    return m ? m[1]! : null;
}

/*
    Tear down channels whose match is no longer pending — e.g. it was cancelled,
    deleted, or confirmed from the WEBPAGE, which the bot otherwise never hears
    about. Members are returned to Lobby first. Only touches voice channels
    inside the inhouse category that follow our naming scheme.
 */
export async function sweepOrphanedChannels(
    guild: Guild,
    pendingLabels: Set<string>,
): Promise<number> {
    const category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === config.INHOUSE_CATEGORY,
    );
    if (!category) return 0;

    const orphaned = [...guild.channels.cache.values()].filter((c): c is VoiceChannel => {
        if (c.type !== ChannelType.GuildVoice || c.parentId !== category.id) return false;
        const label = labelFromChannelName(c.name);
        return label !== null && !pendingLabels.has(label);
    });
    if (orphaned.length === 0) return 0;

    const lobby = findLobbyChannel(guild);
    if (lobby) {
        for (const ch of orphaned) {
        await moveMembers(guild, [...ch.members.keys()], lobby.id);
        }
    }
    const { deleted } = await deleteChannels(
        guild,
        orphaned.map((c) => c.id),
    );
    return deleted;
}

export function findMatchChannels(guild: Guild, label: string): FoundChannels {
    const voice = guild.channels.cache.filter(
        (c): c is VoiceChannel => c.type === ChannelType.GuildVoice && c.name.includes(label),
    );
    return {
        all: [...voice.values()],
        gameComms: voice.find((c) => c.name.includes('Game')),
        teamA: voice.find((c) => c.name.includes('Team A')),
        teamB: voice.find((c) => c.name.includes('Team B')),
    };
}

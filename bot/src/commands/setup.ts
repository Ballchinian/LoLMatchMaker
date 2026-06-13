import {
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type CategoryChannel,
    type TextChannel,
} from 'discord.js';
import type { Command } from './types';
import { isAdmin } from '../discord/guards';
import { ensureAllRoles } from '../discord/roles';
import { ensureLobbyChannel } from '../discord/voice';
import { apiRegisterServer } from '../api';
import { config } from '../config';

/*
    The info channel posts: website + key + signup, then lifecycle + commands.
    Discord caps a message at 2000 chars, so this is SPLIT into multiple
    messages — keep each part comfortably under the limit when editing.
*/
function infoParts(commandsChannelId: string, serverKey: string): string[] {
    const signup =
        `## LoL Match Maker\n` +
        `**Website:** ${config.WEBSITE_URL}\n` +
        `**This server's key:** \`${serverKey}\` — paste it on the website (top right) to see THIS server's players and matches. Don't share it outside this server.\n\n` +
        `**How to sign up**\n` +
        `1. Go to <#${commandsChannelId}> and run \`/link player:<your name>\` (answer the champion pool question).\n` +
        `2. That unlocks the server and gives you a rank role synced from the website.\n` +
        `3. Linked the wrong account? \`/unlink\`, then /link again.`;

    const lifecycle =
        `**How a match lives** (proposed → in progress → completed)\n` +
        `1. **Propose**: build the teams on the website and submit the match (non-admins: one open proposal at a time; you can delete your own with \`/match delete\`).\n` +
        `2. **Start**: \`/match setup\` — every linked player in the lobby must approve. Channels are created, teams are moved in, and a match chat thread opens for as long as the game runs (max ~2 hours).\n` +
        `3. **Play**: \`/match join\` / \`/match split\` move everyone between Game Comms and team channels. Players can only be in one active game at a time.\n` +
        `4. **Finish**: \`/match confirm\` — the bot auto detects the winner from Riot match history when it can; otherwise an admin decides or the lobby votes. MMR is applied and the match is final (admins can do the same from the website).\n` +
        `5. Changed plans? \`/match cancel\` returns an active game to proposed; \`/match delete\` removes it (in-progress deletion needs an admin or a unanimous vote).`;

    const commands =
        `**Bot commands** (only work in <#${commandsChannelId}>)\n` +
        `\`/match setup\` : start a proposed match (channels + teams moved in)\n` +
        `\`/match split\` : re send everyone to their team channels\n` +
        `\`/match join\` : pull everyone into the shared Game Comms channel\n` +
        `\`/match confirm\` : record the winner and apply MMR. Leave \`winner\` empty and the bot auto detects it from Riot match history\n` +
        `\`/match cancel\` : stop an active game, back to proposed\n` +
        `\`/match delete\` : delete a proposal (or void an active game)\n` +
        `\`/update\` : change your champion pool answer\n\n` +
        `Not an admin? Match commands open a lobby vote: a majority of the game's linked players decides (starting or voiding a game needs everyone).`;

    return [signup, lifecycle, commands];
}

export const setup: Command = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Create the rank roles + the commands and info channels (admin)')
        .addStringOption((o) =>
        o
            .setName('password')
            .setDescription('Website admin password (required first time; changing it later is owner-only)')
            .setRequired(false)
            .setMinLength(4)
            .setMaxLength(128),
        )
        .addBooleanOption((o) =>
        o
            .setName('rotate_key')
            .setDescription('Generate a fresh server key, invalidating the old one (owner-only)')
            .setRequired(false),
        ),

    async execute(interaction) {
        if (!(await isAdmin(interaction))) {
            await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral });
            return;
        }
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        /*
            Register this guild with the backend FIRST: it partitions all data
            per server and hands back the website server key. First run requires
            a password; later runs may change it or rotate the key, but BOTH of
            those are takeover vectors, so they're restricted to the guild owner.
        */
        const password = interaction.options.getString('password') ?? undefined;
        const rotateKey = interaction.options.getBoolean('rotate_key') ?? false;

        /*
            The backend enforces that, on an ALREADY-registered server, only the
            guild owner may change the password or rotate the key (it compares
            the invoker we pass against the current owner). First-time setup is
            open to any admin. Passing invokerId + ownerId keeps that authoritative.
        */
        let serverKey: string;
        let serverCreated: boolean;
        let rotatedKey = false;
        try {
            const reg = await apiRegisterServer(guild.id, {
                guildName: guild.name,
                ownerId: guild.ownerId,
                invokerId: interaction.user.id,
                password,
                rotateKey,
            });
            serverKey = reg.serverKey;
            serverCreated = reg.created;
            rotatedKey = reg.rotatedKey ?? false;
        } catch (err) {
            await interaction.editReply(
                `❌ Couldn't register this server with the backend: ${(err as Error).message}\n` +
                `First time here? Run \`/setup password:<website admin password>\` — it becomes this server's admin login on the website. ` +
                `Changing the password or rotating the key later is owner-only.`,
            );
            return;
        }

        /*
            Everything /setup hands out in channel overwrites must be held by the
            bot itself (Discord rejects the whole edit otherwise), so check up
            front and name what's missing instead of a bare "Missing Permissions".
        */
        const required: Array<[bigint, string]> = [
            [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
            [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
            [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
            [PermissionFlagsBits.ManageThreads, 'Manage Threads'],
            [PermissionFlagsBits.CreatePublicThreads, 'Create Public Threads'],
            [PermissionFlagsBits.SendMessages, 'Send Messages'],
            [PermissionFlagsBits.SendMessagesInThreads, 'Send Messages in Threads'],
            [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
            [PermissionFlagsBits.ViewChannel, 'View Channels'],
            [PermissionFlagsBits.Connect, 'Connect'],
            [PermissionFlagsBits.MoveMembers, 'Move Members'],
        ];
        const missing = required
            .filter(([bit]) => !guild.members.me?.permissions.has(bit))
            .map(([, name]) => name);
        if (missing.length) {
            await interaction.editReply(
                `❌ I'm missing these permissions: **${missing.join(', ')}**.\n` +
                `Server Settings → Roles → my role → enable them, then run /setup again.`,
            );
            return;
        }

        /*
            A channel/category with one of our names may already exist (made by
            hand, or before the server was gated) with overwrites that hide it
            from the bot. Editing those fails with a bare 50013, so name them.
        */
        const me = guild.members.me;
        const canManage = (ch: TextChannel | CategoryChannel): boolean =>
            me !== null &&
            ch.permissionsFor(me).has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles,
            ]);

        const blocked: string[] = [];
        for (const name of [config.COMMANDS_CHANNEL_NAME, config.INFO_CHANNEL_NAME]) {
            const ch = guild.channels.cache.find(
                (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name,
            );
            if (ch && !canManage(ch)) blocked.push(`**#${name}**`);
        }
        const category = guild.channels.cache.find(
            (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === config.INHOUSE_CATEGORY,
        );
        if (category && !canManage(category)) blocked.push(`the **${config.INHOUSE_CATEGORY}** category`);
        if (blocked.length) {
            await interaction.editReply(
                `❌ ${blocked.join(', ')} already exist(s) but I can't see or manage it/them.\n` +
                `Either grant my role View Channel + Manage Channels + Manage Permissions in its settings, ` +
                `or delete it/them and run /setup again (I'll recreate everything).`,
            );
            return;
        }

        //Linked role + the 10 tier roles (idempotent: existing roles are kept)
        await ensureAllRoles(guild);

        //Persistent Lobby voice channel (players wait/return here between games)
        await ensureLobbyChannel(guild);

        /*
            Commands-only channel: everyone can see it and use slash commands.
            Typing is ALLOWED (denying Send Messages makes some Discord clients
            refuse to open the "/" picker at all) but the bot auto-deletes every
            non-bot message, so the channel stays clean and polls stay unburied.
        */
        const overwrites = [
            {
                id: guild.roles.everyone.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.UseApplicationCommands,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.SendMessagesInThreads,
                ],
                deny: [
                    PermissionFlagsBits.CreatePublicThreads,
                    PermissionFlagsBits.CreatePrivateThreads,
                ],
            },
            ...(guild.members.me ? 
                [
                    {
                        id: guild.members.me.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.CreatePublicThreads,
                            PermissionFlagsBits.SendMessagesInThreads,
                            PermissionFlagsBits.ManageThreads,
                        ],
                    },
                ]
            : []),
        ];

        let commands = guild.channels.cache.find(
            (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === config.COMMANDS_CHANNEL_NAME,
        );
        if (!commands) {
            commands = await guild.channels.create({
                name: config.COMMANDS_CHANNEL_NAME,
                type: ChannelType.GuildText,
                permissionOverwrites: overwrites,
                reason: 'Match Maker commands channel',
            });
        } else {
            //Re running /setup upgrades an existing commands channel's permissions
            await commands.edit({ permissionOverwrites: overwrites });
        }

        /*
            Read-only info channel: everyone can read it (even before linking),
            only the bot writes. Re running /setup refreshes the bot's info post.
        */
        const infoOverwrites = [
            {
                id: guild.roles.everyone.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.CreatePublicThreads,
                    PermissionFlagsBits.CreatePrivateThreads,
                ],
            },
            ...(guild.members.me ?
                [
                    {
                        id: guild.members.me.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages,
                        ],
                    },
                ]
            : []),
        ];

        let info = guild.channels.cache.find(
            (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === config.INFO_CHANNEL_NAME,
        );
        if (!info) {
            info = await guild.channels.create({
                name: config.INFO_CHANNEL_NAME,
                type: ChannelType.GuildText,
                permissionOverwrites: infoOverwrites,
                reason: 'Match Maker info channel',
            });
        } else {
            await info.edit({ permissionOverwrites: infoOverwrites });
        }

        /*
            Edit the bot's existing info posts in place (oldest first) so the
            channel doesn't churn; send any parts that don't exist yet and drop
            leftovers from older layouts with more/fewer messages.
        */
        const parts = infoParts(commands.id, serverKey);
        const recent = await info.messages.fetch({ limit: 50 }).catch(() => null);
        const mine = recent
            ? [...recent.values()]
                .filter((m) => m.author.id === guild.members.me?.id)
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            : [];
        for (let i = 0; i < parts.length; i++) {
            const existing = mine[i];
            if (existing) await existing.edit(parts[i]!);
            else await info.send(parts[i]!);
        }
        for (const stale of mine.slice(parts.length)) {
            await stale.delete().catch(() => undefined);
        }

        const websiteNote = serverCreated
            ? `🌐 **Website access for this server**: the server key is \`${serverKey}\` (also posted in **#${config.INFO_CHANNEL_NAME}**). ` +
                `Members paste it on the website to see this server's data; admins unlock with the password you just set.\n\n`
            : rotatedKey
                ? `🌐 Server key **rotated** to \`${serverKey}\` — the old key no longer works, re-share this one. ` +
                    (password ? 'Website admin password also updated (old logins signed out).\n\n' : '\n\n')
                : password
                    ? `🌐 Website admin password **updated** — existing website logins are signed out. Server key (unchanged): \`${serverKey}\`.\n\n`
                    : `🌐 Server already registered — key: \`${serverKey}\`. (Owner only: \`/setup password:<new>\` changes the password, \`/setup rotate_key:true\` rotates the key.)\n\n`;

        await interaction.editReply(
        `✔️ Ready: created the **${config.ADMIN_ROLE_NAME}** admin role, the **${config.LINKED_ROLE_NAME}** role, 10 rank roles, **#${config.COMMANDS_CHANNEL_NAME}**, **#${config.INFO_CHANNEL_NAME}** (website + signup + match lifecycle + command guide), and the **${config.LOBBY_CHANNEL_NAME}** voice channel.\n\n` +
            websiteNote +
            `Give **${config.ADMIN_ROLE_NAME}** to anyone who should run admin commands without "Manage Server".\n\n` +
            `**#${config.COMMANDS_CHANNEL_NAME}** is the commands channel: slash commands ONLY work there (signup via /link included), ` +
            `normal messages are auto-deleted, and match votes are posted there so they can't get buried.\n\n` +
            `**One manual step to gate the server:** Server Settings → Roles → **@everyone** → turn **OFF** "View Channels".\n` +
            `Unlinked members will then only see **#${config.COMMANDS_CHANNEL_NAME}**. Running **/link** there grants the ` +
            `**${config.LINKED_ROLE_NAME}** role (which has View Channels) plus their rank role, unlocking the server.\n` +
            `_(Make sure the bot's own role sits ABOVE the rank roles so it can assign them.)_`,
        );
    },
};

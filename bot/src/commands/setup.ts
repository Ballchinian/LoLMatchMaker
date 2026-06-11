import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from './types';
import { isAdmin } from '../discord/guards';
import { ensureAllRoles } from '../discord/roles';
import { config } from '../config';

//The info channel post: website, how to sign up, what the bot can do
function infoText(commandsChannelId: string): string {
    return (
        `## LoL Match Maker\n` +
        `**Website:** ${config.WEBSITE_URL}\n\n` +
        `**How to sign up**\n` +
        `1. Go to <#${commandsChannelId}> and run \`/link player:<your name>\` (answer your roles + champion pool).\n` +
        `2. That unlocks the server and gives you a rank role synced from the website.\n` +
        `3. Linked the wrong account? \`/unlink\`, then /link again.\n\n` +
        `**Bot commands** (only work in <#${commandsChannelId}>)\n` +
        `\`/match setup\` : create the match voice channels and move both teams in\n` +
        `\`/match split\` : re send everyone to their team channels\n` +
        `\`/match join\` : pull everyone into the shared Game Comms channel\n` +
        `\`/match confirm\` : record the winner and apply MMR. Leave \`winner\` empty and the bot auto detects it from Riot match history\n` +
        `\`/match cancel\` : remove the channels, the match stays pending\n` +
        `\`/update\` : change your roles/champion pool answers\n\n` +
        `Not an admin? Match commands open a lobby vote: a majority of the game's linked players decides.`
    );
}

export const setup: Command = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Create the rank roles + the commands and info channels (admin)'),

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

        //Linked role + the 10 tier roles (idempotent: existing roles are kept)
        await ensureAllRoles(guild);

        /*
            Commands-only channel: everyone can see it and use slash commands, but
            can't type messages, except inside the bot's vote threads (match chat).
            The bot keeps send/manage/thread rights so its polls live here unburied,
            it can scrub ineligible reactions, and it can open/lock match-chat threads.
        */
        const overwrites = [
            {
                id: guild.roles.everyone.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.UseApplicationCommands,
                    PermissionFlagsBits.SendMessagesInThreads,
                ],
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

        //Edit the bot's existing info post if there is one, otherwise post fresh
        const text = infoText(commands.id);
        const recent = await info.messages.fetch({ limit: 50 }).catch(() => null);
        const mine = recent?.find((m) => m.author.id === guild.members.me?.id);
        if (mine) await mine.edit(text);
        else await info.send(text);

        await interaction.editReply(
        `✅ Ready: created the **${config.ADMIN_ROLE_NAME}** admin role, the **${config.LINKED_ROLE_NAME}** role, 10 rank roles, **#${config.COMMANDS_CHANNEL_NAME}**, and **#${config.INFO_CHANNEL_NAME}** (website + signup + command guide).\n\n` +
            `Give **${config.ADMIN_ROLE_NAME}** to anyone who should run admin commands without "Manage Server".\n\n` +
            `**#${config.COMMANDS_CHANNEL_NAME}** is the commands channel: slash commands ONLY work there (signup via /link included), ` +
            `normal messages are blocked/auto-deleted, and match votes are posted there so they can't get buried.\n\n` +
            `**One manual step to gate the server:** Server Settings → Roles → **@everyone** → turn **OFF** "View Channels".\n` +
            `Unlinked members will then only see **#${config.COMMANDS_CHANNEL_NAME}**. Running **/link** there grants the ` +
            `**${config.LINKED_ROLE_NAME}** role (which has View Channels) plus their rank role, unlocking the server.\n` +
            `_(Make sure the bot's own role sits ABOVE the rank roles so it can assign them.)_`,
        );
    },
};

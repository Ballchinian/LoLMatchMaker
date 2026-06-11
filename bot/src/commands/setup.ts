import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { isAdmin } from '../discord/guards';
import { ensureAllRoles } from '../discord/roles';
import { config } from '../config';

export const setup: Command = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Create the rank roles + the commands channel (admin)'),

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

        const exists = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === config.COMMANDS_CHANNEL_NAME,
        );
        if (!exists) {
        await guild.channels.create({
            name: config.COMMANDS_CHANNEL_NAME,
            type: ChannelType.GuildText,
            permissionOverwrites: overwrites,
            reason: 'Match Maker commands channel',
        });
        } else {
        // Re running /setup upgrades an existing commands channel's permissions.
        await exists.edit({ permissionOverwrites: overwrites });
        }

        await interaction.editReply(
        `✅ Ready: created the **${config.ADMIN_ROLE_NAME}** admin role, the **${config.LINKED_ROLE_NAME}** role, 10 rank roles, and **#${config.COMMANDS_CHANNEL_NAME}**.\n\n` +
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

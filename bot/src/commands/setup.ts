import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { isAdmin } from '../discord/guards';
import { ensureAllRoles } from '../discord/roles';
import { config } from '../config';

export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Create the rank roles + #signup channel (admin)'),

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

    await ensureAllRoles(guild);

    const exists = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === config.SIGNUP_CHANNEL_NAME,
    );
    if (!exists) {
      await guild.channels.create({
        name: config.SIGNUP_CHANNEL_NAME,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.UseApplicationCommands,
            ],
          },
        ],
        reason: 'Match Maker signup channel',
      });
    }

    await interaction.editReply(
      `✅ Ready: created the **${config.LINKED_ROLE_NAME}** role, 10 rank roles, and **#${config.SIGNUP_CHANNEL_NAME}**.\n\n` +
        `**One manual step to gate the server:** Server Settings → Roles → **@everyone** → turn **OFF** "View Channels".\n` +
        `Unlinked members will then only see **#${config.SIGNUP_CHANNEL_NAME}**. Running **/link** there grants the ` +
        `**${config.LINKED_ROLE_NAME}** role (which has View Channels) plus their rank role, unlocking the server.\n` +
        `_(Make sure the bot's own role sits ABOVE the rank roles so it can assign them.)_`,
    );
  },
};

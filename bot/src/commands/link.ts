import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiLinkDiscord } from '../api';

export const link: Command = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Match Maker player')
    .addStringOption((o) =>
      o.setName('player').setDescription('Your player').setRequired(true).setAutocomplete(true),
    ),

  async execute(interaction) {
    const playerId = interaction.options.getString('player', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await apiLinkDiscord(playerId, interaction.user.id);
      await interaction.editReply('✅ Linked your Discord account to that player.');
    } catch (err) {
      await interaction.editReply(`❌ ${(err as Error).message}`);
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const players = await apiGetPlayers().catch(() => []);
    const choices = players
      .filter((p) => p.displayName.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: `${p.displayName} (${p.rank.label})`.slice(0, 100), value: p.id }));
    await interaction.respond(choices);
  },
};

import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiUpdateRoles, type ChampPool } from '../api';
import { champsOption } from './versatility';

//Self-service: update the signup answer (one-tricking) for YOUR linked player.
export const update: Command = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update your one-trick status (affects your matchmaking MMR)')
        .addStringOption(champsOption(true)),

    async execute(interaction) {
        const champPool = interaction.options.getString('champs', true) as ChampPool;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const players = await apiGetPlayers();
        const mine = players.find((p) => p.discordUserId === interaction.user.id);
        if (!mine) {
            await interaction.editReply('❌ You are not linked to a player yet, run /link first.');
            return;
        }

        const player = await apiUpdateRoles(mine.id, { champPool });
        await interaction.editReply(`✔️ Updated **${player.displayName}** — champ pool: ${champPool}.`);
    },
};

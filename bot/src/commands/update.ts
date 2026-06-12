import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiUpdateRoles, type ChampPool } from '../api';
import { champsOption, rolesOption } from './versatility';

//Self-service: update the signup answers (role coverage / one-tricking) for YOUR linked player.
export const update: Command = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update your role coverage / one-trick status (affects your matchmaking MMR)')
        .addIntegerOption(rolesOption(false))
        .addStringOption(champsOption(false)),

    async execute(interaction) {
        const rolesPlayed = interaction.options.getInteger('roles') ?? undefined;
        const champPool = (interaction.options.getString('champs') ?? undefined) as ChampPool | undefined;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (rolesPlayed === undefined && champPool === undefined) {
            await interaction.editReply('❌ Pick at least one of `roles` / `champs` to update.');
            return;
        }

        const players = await apiGetPlayers();
        const mine = players.find((p) => p.discordUserId === interaction.user.id);
        if (!mine) {
            await interaction.editReply('❌ You are not linked to a player yet, run /link first.');
            return;
        }

        const player = await apiUpdateRoles(mine.id, { rolesPlayed, champPool });
        const parts = [
            rolesPlayed !== undefined ? `roles: ${rolesPlayed}` : null,
            champPool !== undefined ? `champ pool: ${champPool}` : null,
        ].filter(Boolean);
        await interaction.editReply(`✔️ Updated **${player.displayName}** — ${parts.join(', ')}.`);
    },
};

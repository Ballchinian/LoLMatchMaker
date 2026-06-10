import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiLinkDiscord } from '../api';
import { syncMemberRoles } from '../discord/roles';

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
        // If this account is already linked to a different player, move the link (it's self-service).
        const players = await apiGetPlayers();
        const current = players.find((p) => p.discordUserId === interaction.user.id);
        let movedFrom = '';
        if (current && current.id !== playerId) {
            await apiLinkDiscord(current.id, null);
            movedFrom = current.displayName;
        }

        const player = await apiLinkDiscord(playerId, interaction.user.id);

        let roleNote = '';
        if (interaction.guild) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const rank = await syncMemberRoles(interaction.guild, member, player.rank.tier);
            roleNote = ` You now have access and the **${rank}** role.`;
        }
        const movedNote = movedFrom ? ` (moved from **${movedFrom}**)` : '';
        await interaction.editReply(`✅ Linked to **${player.displayName}**${movedNote}.${roleNote}`);
        } catch (err) {
        await interaction.editReply(`❌ ${(err as Error).message}`);
        }
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        // Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(2_000).catch(() => []);
        const choices = players
        .filter((p) => !p.discordUserId) // only unlinked players can be claimed
        .filter((p) => p.displayName.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: `${p.displayName} (${p.rank.label})`.slice(0, 100), value: p.id }));
        await interaction.respond(choices);
    },
};

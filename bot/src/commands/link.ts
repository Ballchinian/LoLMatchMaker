import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiLinkDiscord, apiUpdateRoles, type ChampPool } from '../api';
import { syncMemberRoles } from '../discord/roles';
import { champsOption, rolesOption } from './versatility';

export const link: Command = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Match Maker player')
        .addStringOption((o) =>
            o.setName('player').setDescription('Your player').setRequired(true).setAutocomplete(true),
        )
        //Signup questions: shared with /update (where they're optional).
        .addIntegerOption(rolesOption(true))
        .addStringOption(champsOption(true)),

    async execute(interaction) {
        const playerId = interaction.options.getString('player', true);
        const rolesPlayed = interaction.options.getInteger('roles', true);
        const champPool = interaction.options.getString('champs', true) as ChampPool;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            //If player is linked to discord account, and they are linking to a different player, unlink them
            const players = await apiGetPlayers();
            const current = players.find((p) => p.discordUserId === interaction.user.id);
            let movedFrom = '';
            if (current && current.id !== playerId) {
                await apiLinkDiscord(current.id, null);
                movedFrom = current.displayName;
            }

            const player = await apiLinkDiscord(playerId, interaction.user.id);
            await apiUpdateRoles(playerId, { rolesPlayed, champPool });

            let roleNote = '';

            //If on discord, sync their roles (remove old, add Linked + current tier)
            if (interaction.guild) {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const rank = await syncMemberRoles(interaction.guild, member, player.rank.tier);
                roleNote = ` You now have access and the **${rank}** role.`;
            }
            const movedNote = movedFrom ? ` (moved from **${movedFrom}**)` : '';
            await interaction.editReply(
                `✅ Linked to **${player.displayName}**${movedNote}.${roleNote}` +
                `\nRecorded: ${rolesPlayed} role(s), ${champPool}. Change these any time with /update.`,
            );
        } catch (err) {
        await interaction.editReply(`❌ ${(err as Error).message}`);
        }
    },
    //Autocomplete for player names: filter to unlinked players matching the input.
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        //Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(2_000).catch(() => []);
        const choices = players
            .filter((p) => !p.discordUserId) //only unlinked players can be claimed
            .filter((p) => p.displayName.toLowerCase().includes(focused))
            .slice(0, 25)
            .map((p) => ({ name: `${p.displayName} (${p.rank.label})`.slice(0, 100), value: p.id }));
        await interaction.respond(choices);
    },
};

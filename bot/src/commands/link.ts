import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiLinkDiscord, apiUpdateRoles, type ChampPool } from '../api';
import { syncMemberRoles } from '../discord/roles';
import { champsOption } from './versatility';

export const link: Command = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Match Maker player')
        .addStringOption((o) =>
            o.setName('player').setDescription('Your player').setRequired(true).setAutocomplete(true),
        )
        //Signup question: shared with /update.
        .addStringOption(champsOption(true)),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const playerId = interaction.options.getString('player', true);
        const champPool = interaction.options.getString('champs', true) as ChampPool;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            //If player is linked to discord account, and they are linking to a different player, unlink them
            const players = await apiGetPlayers(guildId);
            const current = players.find((p) => p.discordUserId === interaction.user.id);
            let movedFrom = '';
            if (current && current.id !== playerId) {
                await apiLinkDiscord(guildId, current.id, null);
                movedFrom = current.displayName;
            }

            const player = await apiLinkDiscord(guildId, playerId, interaction.user.id);
            await apiUpdateRoles(guildId, playerId, { champPool });

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
                `\nRecorded champ pool: ${champPool}. Change it any time with /update.`,
            );
        } catch (err) {
        await interaction.editReply(`❌ ${(err as Error).message}`);
        }
    },
    //Autocomplete for player names: filter to unlinked players matching the input.
    async autocomplete(interaction) {
        if (!interaction.guildId) {
            await interaction.respond([]);
            return;
        }
        const focused = interaction.options.getFocused().toLowerCase();
        //Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(interaction.guildId, 2_000).catch(() => []);
        const choices = players
            .filter((p) => !p.discordUserId) //only unlinked players can be claimed
            .filter((p) => p.displayName.toLowerCase().includes(focused))
            .slice(0, 25)
            .map((p) => ({ name: `${p.displayName} (${p.rank.label})`.slice(0, 100), value: p.id }));
        await interaction.respond(choices);
    },
};

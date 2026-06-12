import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiGetPlayers, apiLinkDiscord } from '../api';
import { isAdmin } from '../discord/guards';
import { clearMemberRoles } from '../discord/roles';

export const unlink: Command = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from your player (admins can unlink anyone)')
        .addStringOption((o) =>
        o
            .setName('player')
            .setDescription('(admin) the player to unlink')
            .setRequired(false)
            .setAutocomplete(true),
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const playerOpt = interaction.options.getString('player');
        const players = await apiGetPlayers();

        //Admin path: unlink a chosen player.
        if (playerOpt) {
            if (!(await isAdmin(interaction))) {
                await interaction.editReply('❌ Only admins can unlink another player. Use `/unlink` with no option to unlink yourself.');
                return;
            }
            const target = players.find((p) => p.id === playerOpt);
            if (!target) {
                await interaction.editReply('❌ Player not found.');
                return;
            }
            const oldDiscordId = target.discordUserId;
            await apiLinkDiscord(target.id, null);
            if (oldDiscordId && interaction.guild) {
                const member = await interaction.guild.members.fetch(oldDiscordId).catch(() => null);
                if (member) await clearMemberRoles(interaction.guild, member).catch(() => undefined);
            }
            await interaction.editReply(`✔️ Unlinked **${target.displayName}**${oldDiscordId ? ' and removed their roles' : ''}.`);
            return;
        }

        //Self path: unlink whatever player the invoking account is on.
        const mine = players.find((p) => p.discordUserId === interaction.user.id);
        if (!mine) {
        //Not linked, still strip any leftover roles (e.g. from an old overwrite).
        if (interaction.guild) {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (member) await clearMemberRoles(interaction.guild, member).catch(() => undefined);
        }
        await interaction.editReply(
            "You weren't linked to a player, cleared any leftover roles. Run /link to connect the right player.",
        );
        return;
        }
        await apiLinkDiscord(mine.id, null);
        if (interaction.guild) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (member) await clearMemberRoles(interaction.guild, member).catch(() => undefined);
        }
        await interaction.editReply(
        `✔️ Unlinked you from **${mine.displayName}**. Run /link to connect the right player.`,
        );
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        //Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(2_000).catch(() => []);
        const choices = players
        .filter((p) => p.discordUserId) // only linked players can be unlinked
        .filter((p) => p.displayName.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: p.displayName.slice(0, 100), value: p.id }));
        await interaction.respond(choices);
    },
};

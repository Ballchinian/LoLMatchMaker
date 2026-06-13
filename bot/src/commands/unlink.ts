import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiDeletePlayer, apiGetMatches, apiGetPlayers, apiLinkDiscord } from '../api';
import { isAdmin } from '../discord/guards';
import { clearMemberRoles } from '../discord/roles';

export const unlink: Command = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink yourself (removes the entry if you have no games yet); admins can unlink anyone')
        .addStringOption((o) =>
        o
            .setName('player')
            .setDescription('(admin) the player to unlink')
            .setRequired(false)
            .setAutocomplete(true),
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const playerOpt = interaction.options.getString('player');
        const players = await apiGetPlayers(guildId);

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
            await apiLinkDiscord(guildId, target.id, null);
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

        /*
            Unlink = remove yourself. A "clean" player (no games, no open match)
            is fully DELETED — there's no ladder history to keep, and this stops
            unlink/relink alias churn. Once you've played (or have an open match)
            your record can't be self-removed: a non-admin is told to ask an
            admin; an admin self-unlinks WITHOUT deleting, so the ladder history
            survives.
        */
        const matches = await apiGetMatches(guildId).catch(() => []);
        const inOpenMatch = matches.some(
            (m) =>
                (m.status === 'pending' || m.status === 'inProgress') &&
                ([...m.teamA, ...m.teamB].some((e) => e.player === mine.id) ||
                    m.proposedByDiscordId === interaction.user.id),
        );
        const clean = mine.gamesPlayed === 0 && !inOpenMatch;

        const clearRoles = async () => {
            if (!interaction.guild) return;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (member) await clearMemberRoles(interaction.guild, member).catch(() => undefined);
        };

        if (clean) {
            //Fresh entry → remove it entirely.
            await apiDeletePlayer(guildId, mine.id);
            await clearRoles();
            await interaction.editReply(
                `✔️ Removed **${mine.displayName}** from the roster and unlinked you. Run /link to add yourself again.`,
            );
            return;
        }

        //Has history / an open match → can't be deleted.
        if (!(await isAdmin(interaction))) {
            await interaction.editReply(
                `❌ You've already played games${inOpenMatch ? ' / have an open match' : ''}, so you can't remove yourself — ask an admin.`,
            );
            return;
        }
        //Admin self-unlink keeps the player + its ladder history.
        await apiLinkDiscord(guildId, mine.id, null);
        await clearRoles();
        await interaction.editReply(
            `✔️ Unlinked you from **${mine.displayName}** (ladder history kept; delete it from the website if needed).`,
        );
    },

    async autocomplete(interaction) {
        if (!interaction.guildId) {
            await interaction.respond([]);
            return;
        }
        const focused = interaction.options.getFocused().toLowerCase();
        //Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(interaction.guildId, 2_000).catch(() => []);
        const choices = players
        .filter((p) => p.discordUserId) // only linked players can be unlinked
        .filter((p) => p.displayName.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((p) => ({ name: p.displayName.slice(0, 100), value: p.id }));
        await interaction.respond(choices);
    },
};

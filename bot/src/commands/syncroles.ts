import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { isAdmin } from '../discord/guards';
import { apiGetPlayers } from '../api';
import { ensureAllRoles, syncMemberRoles } from '../discord/roles';

export const syncroles: Command = {
    data: new SlashCommandBuilder()
        .setName('syncroles')
        .setDescription("Re-sync every linked member's rank role from the website (admin)"),

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
        const players = await apiGetPlayers();

        let synced = 0;
        let skipped = 0;
        let failed = 0;
        for (const p of players) {
        if (!p.discordUserId) {
            skipped++;
            continue;
        }
        const member = await guild.members.fetch(p.discordUserId).catch(() => null);
        if (!member) {
            skipped++;
            continue;
        }
        try {
            await syncMemberRoles(guild, member, p.rank.tier);
            synced++;
        } catch {
            failed++;
        }
        }

        await interaction.editReply(
        `✅ Synced ${synced} member(s). Skipped ${skipped} (unlinked or not in server)` +
            (failed ? `, ${failed} failed (check role hierarchy/permissions).` : '.'),
        );
    },
};

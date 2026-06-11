import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config';

/*
    Admin gate:
    The server owner ALWAYS counts (prevents locking yourself out).
    ADMIN_ROLE_ID set: only that role counts.
    Otherwise: the ADMIN_ROLE_NAME role (created by /setup) or "Manage Server".
*/
export async function isAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.user.id === interaction.guild.ownerId) return true;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (config.ADMIN_ROLE_ID) {
        return member?.roles.cache.has(config.ADMIN_ROLE_ID) ?? false;
    }
    if (member?.roles.cache.some((r) => r.name === config.ADMIN_ROLE_NAME)) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

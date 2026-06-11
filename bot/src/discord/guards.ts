import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config';

/*
    Admin gate, per guild (no global config so the bot works on any server):
    the server owner, the ADMIN_ROLE_NAME role (created by /setup), or "Manage Server".
*/
export async function isAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    if (interaction.user.id === interaction.guild.ownerId) return true;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (member?.roles.cache.some((r) => r.name === config.ADMIN_ROLE_NAME)) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

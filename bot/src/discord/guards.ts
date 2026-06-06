import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config';

/** Admin = the configured ADMIN_ROLE_ID, or (if unset) anyone with Manage Server. */
export async function isAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (config.ADMIN_ROLE_ID) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return member?.roles.cache.has(config.ADMIN_ROLE_ID) ?? false;
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

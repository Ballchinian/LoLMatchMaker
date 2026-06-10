import type { SlashCommandIntegerOption, SlashCommandStringOption } from 'discord.js';

/**
 * The two versatility questions, shared by /link (required, asked at signup)
 * and /update (optional, self-service edits). They adjust the player's
 * shown/balancing MMR on the site.
 */

export const rolesOption =
    (required: boolean) =>
    (o: SlashCommandIntegerOption) =>
        o
        .setName('roles')
        .setDescription('How many roles can you play at your peak rank?')
        .setRequired(required)
        .addChoices(
            { name: '1 role', value: 1 },
            { name: '2 roles', value: 2 },
            { name: '3 roles', value: 3 },
            { name: '4 roles', value: 4 },
            { name: 'All 5 roles', value: 5 },
        );

export const champsOption =
    (required: boolean) =>
    (o: SlashCommandStringOption) =>
        o
        .setName('champs')
        .setDescription('Diversity of champs')
        .setRequired(required)
        .addChoices(
            { name: 'One-trick', value: 'one-trick' },
            { name: 'Two champs', value: 'two-trick' },
            { name: 'Diverse: 3+', value: 'diverse' },
        );

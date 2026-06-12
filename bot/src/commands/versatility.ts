import type { SlashCommandStringOption } from 'discord.js';

/*
    The champion-pool question, shared by /link (asked at signup) and /update
    (self-service edits). It adjusts the player's shown/balancing MMR on the site.
*/

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

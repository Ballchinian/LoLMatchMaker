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
        .setDescription('How many champs can you play AT YOUR PEAK RANK?')
        .setRequired(required)
        .addChoices(
            { name: 'One-trick — got your peak rank on basically 1 champ', value: 'one-trick' },
            { name: 'Two champs — strong on about 2', value: 'two-trick' },
            { name: 'Diverse — comfortable on 3+ (pick this if new / low level)', value: 'diverse' },
        );

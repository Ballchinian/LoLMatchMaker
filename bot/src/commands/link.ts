import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import {
    apiGetPlayers,
    apiInjectRiotPlayer,
    apiLinkDiscord,
    apiUpdateRoles,
    type ChampPool,
} from '../api';
import { syncMemberRoles } from '../discord/roles';
import { champsOption } from './versatility';

/*
    One onboarding command. The `player` option autocompletes existing UNLINKED
    players; if you type a Riot ID (Name#Tag) that isn't on the roster yet, it
    offers a "Create & link" choice that creates the player from Riot on submit
    (the Riot lookup runs here, NOT during autocomplete, which has a ~3s budget).
    Either way you end up linked — and link is 1:1 per server, so a person can
    only ever hold one self-created player at a time.
*/

//Marks an autocomplete value as "create this Riot ID" rather than an existing id.
const CREATE_PREFIX = 'new:';

export const link: Command = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord to your player — or type your Riot ID to create it')
        .addStringOption((o) =>
            o
                .setName('player')
                .setDescription('Pick your player, or type your Riot ID (Name#Tag) to create it')
                .setRequired(true)
                .setAutocomplete(true),
        )
        //Signup question: shared with /update.
        .addStringOption(champsOption(true)),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const choice = interaction.options.getString('player', true);
        const champPool = interaction.options.getString('champs', true) as ChampPool;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const players = await apiGetPlayers(guildId);

            //Resolve the target player id: either an existing one, or create from Riot.
            let targetId: string;
            let createdNote = '';
            if (choice.startsWith(CREATE_PREFIX)) {
                const riotId = choice.slice(CREATE_PREFIX.length).trim();
                const hash = riotId.lastIndexOf('#');
                if (hash <= 0 || hash === riotId.length - 1) {
                    await interaction.editReply('❌ To create a new player, type your Riot ID as `Name#Tag`, e.g. `Faker#KR1`.');
                    return;
                }
                const gameName = riotId.slice(0, hash).trim();
                const tagLine = riotId.slice(hash + 1).trim();
                try {
                    const created = await apiInjectRiotPlayer(guildId, gameName, tagLine, interaction.user.id);
                    targetId = created.id;
                    createdNote = ' (new player created)';
                } catch (err) {
                    if (/already/i.test((err as Error).message)) {
                        await interaction.editReply(
                            '❌ That Riot account is already on the roster — start typing its name and pick it from the list instead.',
                        );
                        return;
                    }
                    throw err;
                }
            } else {
                targetId = choice;
            }

            //If this Discord account is on a different player, move the link.
            const current = players.find((p) => p.discordUserId === interaction.user.id);
            let movedFrom = '';
            if (current && current.id !== targetId) {
                await apiLinkDiscord(guildId, current.id, null);
                movedFrom = current.displayName;
            }

            const player = await apiLinkDiscord(guildId, targetId, interaction.user.id);
            await apiUpdateRoles(guildId, targetId, { champPool });

            let roleNote = '';
            if (interaction.guild) {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const rank = await syncMemberRoles(interaction.guild, member, player.rank.tier);
                roleNote = ` You now have access and the **${rank}** role.`;
            }
            const movedNote = movedFrom ? ` (moved from **${movedFrom}**)` : '';
            await interaction.editReply(
                `✔️ Linked to **${player.displayName}**${createdNote}${movedNote}.${roleNote}` +
                `\nRecorded champ pool: ${champPool}. Change it any time with /update.`,
            );
        } catch (err) {
            await interaction.editReply(`❌ ${(err as Error).message}`);
        }
    },

    //Autocomplete: unlinked players matching the input, plus a "Create & link"
    //option when the input looks like a Riot ID not already on the roster.
    async autocomplete(interaction) {
        if (!interaction.guildId) {
            await interaction.respond([]);
            return;
        }
        const focused = interaction.options.getFocused();
        const lower = focused.toLowerCase();
        //Tight budget: autocomplete must answer within ~3s or the token dies.
        const players = await apiGetPlayers(interaction.guildId, 2_000).catch(() => []);
        const unlinked = players.filter((p) => !p.discordUserId);
        const matches = unlinked.filter((p) => p.displayName.toLowerCase().includes(lower));

        const choices = matches
            .slice(0, 24)
            .map((p) => ({ name: `${p.displayName} (${p.rank.label})`.slice(0, 100), value: p.id }));

        //Offer the create path when they've typed a Riot ID we don't already have.
        const looksLikeRiotId = focused.includes('#') && !focused.endsWith('#') && !focused.startsWith('#');
        const exactExists = unlinked.some((p) => p.displayName.toLowerCase() === lower);
        if (looksLikeRiotId && !exactExists) {
            choices.unshift({ name: `➕ Create & link: ${focused}`.slice(0, 100), value: `${CREATE_PREFIX}${focused}`.slice(0, 100) });
        }
        await interaction.respond(choices.slice(0, 25));
    },
};

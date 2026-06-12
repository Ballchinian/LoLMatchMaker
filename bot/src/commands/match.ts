import { ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types';
import { apiDetectWinner, apiGetMatches, apiGetPlayers, type ApiMatch } from '../api';
import { isAdmin } from '../discord/guards';
import {
    POLL_DURATION_MS,
    closeMatchVotes,
    closeVote,
    isVoteRunning,
    pickWinnerEphemeral,
    runVote,
    voteKey,
    votesNeededFor,
} from '../discord/votes';
import { actionDescription, performAction, resolve } from './matchActions';

/*
    The /match command: decides WHO gets to run an action and how (admin runs it
    directly, an auto detected Riot result applies itself, everything else goes
    to a vote). The actions live in matchActions.ts, the vote UI in discord/votes.ts.
*/
export const match: Command = {
    data: new SlashCommandBuilder()
        .setName('match')
        .setDescription('Run inhouse voice channels for a pending match')
        .addSubcommand((s) =>
        s
            .setName('setup')
            .setDescription('Create the channels and send players straight to their team channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('split')
            .setDescription('Move players (back) into their team channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('confirm')
            .setDescription('Confirm the winner (applies MMR), return players to Lobby, delete channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            )
            .addStringOption((o) =>
            o
                .setName('winner')
                .setDescription('Winning team (leave empty to auto-detect from Riot match history)')
                .setRequired(false)
                .addChoices({ name: 'Team A', value: 'A' }, { name: 'Team B', value: 'B' }),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('cancel')
            .setDescription('Abort: return players to Lobby and delete channels (match stays pending)')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            )
        )
        .addSubcommand((s) =>
        s
            .setName('join')
            .setDescription('Bring everyone back into the shared Game Comms channel')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        ),

    async execute(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        /*
            Acknowledge FIRST: Discord only gives us ~3s, and everything below
            (member fetch, API calls against a possibly cold backend) can be slow.
        */
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        //---------------Mostly validation at this point------------------

        const sub = interaction.options.getSubcommand();
        const matchId = interaction.options.getString('match', true);
        //If already prompted on the winner, set it here
        let winner =
            sub === 'confirm'
                ? ((interaction.options.getString('winner') as 'A' | 'B' | null) ?? undefined)
                : undefined;
        const admin = await isAdmin(interaction);

        const matches = await apiGetMatches();
        const match = matches.find((m) => m._id === matchId);
        if (!match) {
            await interaction.editReply('❌ Match not found.');
            return;
        }

        /*
            Allowed match states per action:
            setup needs pending (an inProgress game is already being played),
            split/join only make sense mid game, cancel/confirm work for both.
        */
        const allowed: Record<string, ApiMatch['status'][]> = {
            setup: ['pending'],
            split: ['inProgress'],
            join: ['inProgress'],
            cancel: ['pending', 'inProgress'],
            confirm: ['pending', 'inProgress'],
        };
        const okStates = allowed[sub] ?? ['pending'];
        if (!okStates.includes(match.status)) {
        await interaction.editReply(
            `❌ That match is **${match.status}**, \`/match ${sub}\` needs a ${okStates.join(' or ')} match.`,
        );
        return;
        }

        const players = await apiGetPlayers();
        const label = match.name ?? `#${matchId.slice(-4)}`;

        /*
            Confirm without a winner: ask the server to find the custom game in
            Riot match history first. Best effort: null just means "ask the humans".
        */
        let autoDetected = false;
        if (sub === 'confirm' && !winner) {
            const detected = await apiDetectWinner(matchId).catch(() => null);
            if (detected) {
                winner = detected.winner;
                autoDetected = true;
            }
        }

        //----------------Admin: override non admin commands------------------
        if (admin) {
            //Still no winner: ask the admin privately; one click decides
            if (sub === 'confirm' && !winner) {
                const picked = await pickWinnerEphemeral(interaction, label);
                if (!picked) return;
                winner = picked;
            }

            const closeMsg = `Vote closed, an admin ran \`/match ${sub}\` for ${label} directly.`;
            //Close relevent command /match votes of that game name if we are closing the game state
            if (sub === 'confirm') closeMatchVotes(matchId, closeMsg);
            //Otherwise just close the specific subcommand vote
            else closeVote(voteKey(matchId, sub), closeMsg);

            const summary = await performAction(guild, sub, match, players, winner);
            await interaction.editReply({
                content: autoDetected ? `🔎 Winner auto detected from Riot match history.\n${summary}` : summary,
                components: [],
            });
            return;
        }

        /*
            Riot itself told us the winner: authoritative, so even a non-admin
            confirm applies immediately (and moots any votes running on this match).
        */
        if (sub === 'confirm' && winner && autoDetected) {
            closeMatchVotes(matchId, `**${label}** was auto confirmed from Riot match history.`);
            const summary = await performAction(guild, sub, match, players, winner);
            const channel = interaction.channel;
            //For confirmation on our end
            if (channel?.isSendable()) {
                await channel
                    .send(`🔎 Riot match history shows **Team ${winner}** won **${label}**.\n${summary}`)
                    .catch(() => undefined);
            }
            //For user confirmation in the ephemeral reply
            await interaction.editReply(`✅ Auto confirmed, Team ${winner} won ${label}.`);
            return;
        }

        //------------non-admin: every action goes to a vote-------------------

        //One vote per match + subcommand at a time (a confirm and a cancel can coexist)
        if (isVoteRunning(voteKey(matchId, sub))) {
            await interaction.editReply(
            `❌ A \`/match ${sub}\` vote is already running for ${label}, wait for it to finish.`,
            );
            return;
        }

        const channel = interaction.channel;
        if (!channel || !channel.isSendable()) {
            await interaction.editReply('❌ I can\'t post the vote in this channel.');
            return;
        }

        //Only the lobby's LINKED players may vote (we can't identify anyone else)
        const byId = new Map(players.map((p) => [p.id, p]));
        const a = resolve(match.teamA, byId);
        const b = resolve(match.teamB, byId);
        const eligible = new Set([...a.linked, ...b.linked]);
        
        //linked votes only, so one linked account can make the vote happen, but need 1 at least
        if (eligible.size === 0) {
            await interaction.editReply(
            '❌ Nobody in this lobby has linked their Discord account, so there\'s no one to vote. Players should run /link.',
            );
            return;
        }
        const votesNeeded = votesNeededFor(eligible.size);
        const mentions = [...eligible].map((id) => `<@${id}>`).join(' ');

        /*
            Starting a game commits all ten players' evening: setup needs EVERY
            linked lobby player to approve, not just a majority. Rejections and
            every other action stay majority.
        */
        const approveNeeded = sub === 'setup' ? eligible.size : votesNeeded;

        /*
            Revalidate the match is still in an actionable state, then run the
            action: shared by both vote types below.
        */
        const performIfStillPending = async (w: 'A' | 'B' | undefined, passedText: string): Promise<string> => {
            const fresh = (await apiGetMatches()).find((m) => m._id === matchId);
            if (!fresh || !okStates.includes(fresh.status)) {
                return `⚠️ Vote passed, but **${label}** is **${fresh?.status ?? 'deleted'}** now, nothing to do.`;
            }
            const freshPlayers = await apiGetPlayers();
            const summary = await performAction(guild, sub, fresh, freshPlayers, w);
            return `${passedText}\n${summary}`;
        };

        /*
            Confirm with no detected winner: the lobby votes on WHO WON instead of
            approve/reject, the first team to reach a majority is recorded.
        */
        if (sub === 'confirm' && !winner) {
            await runVote({
                channel,
                key: voteKey(matchId, sub),
                content:
                    `🗳️ <@${interaction.user.id}> wants to confirm **${label}**, but the result wasn't found in Riot match history.\n` +
                    `${mentions}, who won? **${votesNeeded}** of the lobby's **${eligible.size}** linked player(s) ` +
                    `for either team decides (expires in ${POLL_DURATION_MS / 60_000} min). This applies MMR!`,
                threadName: `🗳️ ${label}, who won?`,
                eligible,
                votesNeeded,
                options: [
                    { id: 'A', label: 'Team A won', emoji: '🏆', style: ButtonStyle.Primary },
                    { id: 'B', label: 'Team B won', emoji: '🏆', style: ButtonStyle.Secondary },
                ],
                onDecided: (team) =>
                    performIfStillPending(team as 'A' | 'B', `🗳️ The lobby has spoken, **Team ${team}** won!`),
                expiredText: `⏰ The vote on who won **${label}** expired without a majority.`,
            });
            await interaction.editReply(
                `🗳️ Winner vote opened for ${label}, first team to ${votesNeeded} vote(s) gets recorded.`,
            );
            return;
        }

        //Everything else: approve/reject the requested action
        const desc = actionDescription(sub, label, winner);
        await runVote({
            channel,
            key: voteKey(matchId, sub),
            content:
                `🗳️ <@${interaction.user.id}> wants to ${desc}.\n` +
                `${mentions}, vote with the buttons below. ` +
                (sub === 'setup'
                    ? `ALL **${eligible.size}** linked player(s) must approve to start; **${votesNeeded}** rejections cancel `
                    : `**${votesNeeded}** of the lobby's **${eligible.size}** linked player(s) either way decides `) +
                `(expires in ${POLL_DURATION_MS / 60_000} min). Click your vote again to withdraw it.`,
            threadName: `🗳️ ${label}, match chat`,
            eligible,
            votesNeeded,
            options: [
                { id: 'approve', label: 'Approve', emoji: '✅', style: ButtonStyle.Success, needed: approveNeeded },
                { id: 'reject', label: 'Reject', emoji: '❌', style: ButtonStyle.Danger },
            ],
            onDecided: (choice) =>
                choice === 'reject'
                    ? Promise.resolve(`❌ Vote failed, the request to ${desc} was rejected.`)
                    : performIfStillPending(winner, '🗳️ Vote passed!'),
            expiredText: `⏰ The vote to ${desc} expired without enough votes.`,
        });
        await interaction.editReply(`🗳️ Vote opened for ${label}, ${approveNeeded} ✅ and it happens.`);
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const sub = interaction.options.getSubcommand(false);
        //Which match states this subcommand can act on (mirrors execute)
        const wanted: ApiMatch['status'][] =
            sub === 'setup' ? ['pending'] : sub === 'confirm' ? ['pending', 'inProgress'] : ['inProgress'];

        //Tight budget: autocomplete must answer within ~3s or the token dies
        const matches = await apiGetMatches(2_000).catch(() => [] as ApiMatch[]);
        //Lobby name + team sizes only: no player names
        const choices = matches
        .filter((m) => wanted.includes(m.status))
        .map((m) => {
            const label = m.name ?? `#${m._id.slice(-4)}`;
            const playing = m.status === 'inProgress' ? ' • in game' : '';
            return { name: `${label} (${m.teamA.length}v${m.teamB.length})${playing}`.slice(0, 100), value: m._id };
        })
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25);
        await interaction.respond(choices);
    },
};

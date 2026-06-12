import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    ThreadAutoArchiveDuration,
    type ChatInputCommandInteraction,
    type SendableChannels,
} from 'discord.js';

/*
    Two option button votes: one shared lock + poll UI so every vote
    (approve/reject, who won) looks and behaves the same.
*/

//1 mins to vote for admins
const ADMIN_POLL_DURATION_MS = 1 * 60_000;
//5 minutes to vote
export const POLL_DURATION_MS = 5 * 60_000;
//10 minutes to see result of vote
const POLL_CLEANUP_MS = 10 * 60_000;

//Votes need majority to pass vote
export function votesNeededFor(eligibleCount: number): number {
    return Math.floor(eligibleCount / 2) + 1;
}

/*
    matchId:subcommand -> running vote's collector. A match can have several votes
    at once (e.g. a confirm and a cancel), but only one per subcommand. Admins cut
    through: their direct action stops the matching vote(s) via collector.stop().
*/
const activeVotes = new Map<string, { stop: (reason?: string) => void }>();

export function voteKey(matchId: string, sub: string): string {
    return `${matchId}:${sub}`;
}

//True while a vote with this key is collecting
export function isVoteRunning(key: string): boolean {
    return activeVotes.has(key);
}

//Stop a running vote early; `message` is shown on the frozen poll
export function closeVote(key: string, message: string) {
    activeVotes.get(key)?.stop(`closed:${message}`);
}

//Stop every running vote on a match (used when the match stops being pending)
export function closeMatchVotes(matchId: string, message: string) {
    for (const key of [...activeVotes.keys()]) {
        if (key.startsWith(`${matchId}:`)) closeVote(key, message);
    }
}

//One side of a two-option vote (approve/reject, Team A/Team B, ...)
export interface VoteOption {
    id: string;
    label: string;
    emoji: string;
    style: ButtonStyle;
    //Votes required for THIS option to win; defaults to the vote's votesNeeded
    needed?: number;
}

//Button row for a two-option vote, live counts baked into the labels
function voteRow(options: [VoteOption, VoteOption], counts: [number, number], needed: [number, number], disabled = false) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...options.map((o, i) =>
            new ButtonBuilder()
                .setCustomId(`vote-${o.id}`)
                .setLabel(`${o.label} (${counts[i]}/${needed[i]})`)
                .setEmoji(o.emoji)
                .setStyle(o.style)
                .setDisabled(disabled),
        ),
    );
}

/*
    Run a two-option majority vote: posts the poll + a discussion thread, tracks
    votes (click the other button to switch, re-click your own to withdraw), and
    when an option reaches `votesNeeded` calls `onDecided` with its id, the
    return value becomes the final poll message. closeVote() shows its message
    instead; expiry shows `expiredText`. Shared by the approve/reject and the
    "who won?" votes so both get the same UI.
*/
export async function runVote(opts: {
    channel: SendableChannels;
    key: string;
    content: string;
    threadName: string;
    eligible: Set<string>;
    votesNeeded: number;
    options: [VoteOption, VoteOption];
    onDecided: (optionId: string) => Promise<string>;
    expiredText: string;
}): Promise<void> {
    const { channel, key, content, threadName, eligible, votesNeeded, options, onDecided, expiredText } = opts;
    const needed: [number, number] = [options[0].needed ?? votesNeeded, options[1].needed ?? votesNeeded];

    const poll = await channel.send({ content, components: [voteRow(options, [0, 0], needed)] });
    //Created (and registered) right away so an admin can stop it
    const collector = poll.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: POLL_DURATION_MS,
    });
    activeVotes.set(key, collector);

    /*
        Match chat: the commands channel itself is typing-locked, so give the
        lobby a thread to discuss the vote. Locked once the vote resolves.
    */
    const thread = await poll
        .startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneHour })
        .catch(() => null);

    const voters: [Set<string>, Set<string>] = [new Set(), new Set()];
    const counts = (): [number, number] => [voters[0].size, voters[1].size];

    //"Who has voted" footer (participation only, not which way they voted)
    const votedLine = () => {
        const all = [...voters[0], ...voters[1]];
        if (all.length === 0) return '';
        return `\n\n☑️ Voted (${all.length}/${eligible.size}): ${all.map((id) => `<@${id}>`).join(' ')}`;
    };

    //Enforce vote validity (from game participants only)
    collector.on('collect', async (btn) => {
        if (!eligible.has(btn.user.id)) {
            await btn
                .reply({
                    content: '❌ Only this lobby\'s linked players can vote on this.',
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => undefined);
            return;
        }

        //One vote per player: clicking the other button switches, reclicking withdraws
        const idx = btn.customId === `vote-${options[0].id}` ? 0 : 1;
        const mine = voters[idx];
        const other = voters[1 - idx];
        //Delete entry, if it worked then it was a switch
        const switched = other.delete(btn.user.id);
        //If no switch and already voted, must be withdrawing
        const withdrew = !switched && mine.has(btn.user.id);
        withdrew ? mine.delete(btn.user.id) : mine.add(btn.user.id);

        await btn
            .update({ content: content + votedLine(), components: [voteRow(options, counts(), needed)] })
            .catch(() => undefined);

        //Private receipt so there's no doubt YOUR click registered
        const choice = options[idx].label;
        const receipt = withdrew
            ? '↩️ Your vote was withdrawn.'
            : switched
                ? `🔄 Switched: to **${choice}**.`
                : `✔️ Vote recorded: **${choice}**.`;
        await btn.followUp({ content: receipt, flags: MessageFlags.Ephemeral }).catch(() => undefined);

        if (voters[0].size >= needed[0]) collector.stop(`decided:${options[0].id}`);
        else if (voters[1].size >= needed[1]) collector.stop(`decided:${options[1].id}`);
    });

    //Event listener on 'end' when vote finishes (closed, decided, or expired)
    collector.on('end', async (_collected, reason) => {
        activeVotes.delete(key);
        const finalRow = voteRow(options, counts(), needed, true);
        try {
            if (reason.startsWith('closed:')) {
                await poll.edit({ content: `⚙️ ${reason.slice('closed:'.length)}`, components: [finalRow] });
                return;
            }
            if (reason.startsWith('decided:')) {
                const summary = await onDecided(reason.slice('decided:'.length));
                await poll.edit({ content: summary, components: [finalRow] });
                return;
            }
            await poll.edit({ content: expiredText, components: [finalRow] });
        } catch (err) {
            console.error('[match vote]', err);
            await poll
                .edit({
                    content: `❌ The vote ended but the follow-up failed: ${(err as Error).message}`,
                    components: [finalRow],
                })
                .catch(() => undefined);
        } finally {
            /*
                Vote is over, freeze the match chat, then clean both up after a
                grace period so the channel doesn't accumulate dead polls.
            */
            if (thread) {
                await thread.setLocked(true).catch(() => undefined);
                await thread.setArchived(true).catch(() => undefined);
            }
            setTimeout(() => {
                void thread?.delete().catch(() => undefined);
                void poll.delete().catch(() => undefined);
            }, POLL_CLEANUP_MS);
        }
    });
}

/*
    Private "who won?" picker for an admin when auto detection comes up empty:
    one click on the ephemeral message decides. Returns null on timeout (the
    reply is edited to say so).
*/
export async function pickWinnerEphemeral(
    interaction: ChatInputCommandInteraction,
    label: string,
): Promise<'A' | 'B' | null> {
    const picker = await interaction.editReply({
        content: `⚠️ Couldn't find the result for **${label}** in Riot match history. Who won?`,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('pick-A').setLabel('Team A won').setEmoji('🏆').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('pick-B').setLabel('Team B won').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
            ),
        ],
    });
    try {
        const btn = await picker.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: ADMIN_POLL_DURATION_MS,
        });
        await btn.deferUpdate();
        return btn.customId === 'pick-A' ? 'A' : 'B';
    } catch {
        await interaction
            .editReply({ content: '⏰ No winner picked, confirm cancelled.', components: [] })
            .catch(() => undefined);
        return null;
    }
}

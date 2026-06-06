import { MessageFlags, SlashCommandBuilder, type Guild } from 'discord.js';
import type { Command } from './types';
import {
  apiConfirmMatch,
  apiGetMatches,
  apiGetPlayers,
  type ApiMatch,
  type ApiPlayer,
  type ApiRosterEntry,
} from '../api';
import { isAdmin } from '../discord/guards';
import {
  createMatchChannels,
  deleteChannels,
  ensureCategory,
  findMatchChannels,
  moveMembers,
} from '../discord/voice';
import { config } from '../config';

/** Split a team's roster into linked Discord ids vs unlinked display names. */
function resolve(entries: ApiRosterEntry[], byId: Map<string, ApiPlayer>) {
  const linked: string[] = [];
  const unlinked: string[] = [];
  for (const e of entries) {
    const p = byId.get(e.player);
    if (p?.discordUserId) linked.push(p.discordUserId);
    else unlinked.push(e.displayName);
  }
  return { linked, unlinked };
}

/** Return players to Lobby (if configured) and delete the match's channels. */
async function teardown(guild: Guild, memberIds: string[], label: string) {
  if (config.LOBBY_CHANNEL_ID) {
    await moveMembers(guild, memberIds, config.LOBBY_CHANNEL_ID);
  }
  const found = findMatchChannels(guild, label);
  return deleteChannels(
    guild,
    found.all.map((c) => c.id),
  );
}

/** Append a warning to a reply if some channels couldn't be deleted (e.g. missing perms). */
function withErrors(base: string, errors: string[]): string {
  if (errors.length === 0) return base;
  return `${base}\n⚠️ Couldn't delete ${errors.length} channel(s): ${errors.join('; ')}`;
}

export const match: Command = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Run inhouse voice channels for a pending match')
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Create team channels and gather the players')
        .addStringOption((o) =>
          o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('split')
        .setDescription('Move players into their team channels')
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
            .setDescription('Winning team')
            .setRequired(true)
            .addChoices({ name: 'Team A', value: 'A' }, { name: 'Team B', value: 'B' }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Abort: return players to Lobby and delete channels (match stays pending)')
        .addStringOption((o) =>
          o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
        ),
    ),

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

    const sub = interaction.options.getSubcommand();
    const matchId = interaction.options.getString('match', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const matches = await apiGetMatches();
    const match = matches.find((m) => m._id === matchId);
    if (!match) {
      await interaction.editReply('❌ Match not found.');
      return;
    }

    // Every /match action operates on a PENDING game only.
    if (match.status !== 'pending') {
      await interaction.editReply(
        `❌ That match is **${match.status}** — only pending matches can be managed.`,
      );
      return;
    }

    const players = await apiGetPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const a = resolve(match.teamA, byId);
    const b = resolve(match.teamB, byId);
    const allLinked = [...a.linked, ...b.linked];
    const label = match.name ?? `#${matchId.slice(-4)}`;

    if (sub === 'setup') {
      const already = findMatchChannels(guild, label);
      if (already.all.length > 0) {
        await interaction.editReply(
          `⚠️ This match is already set up (${already.all.length} channel(s) for ${label}). ` +
            'Run `/match cancel` first if you want to recreate them.',
        );
        return;
      }
      const category = await ensureCategory(guild);
      const channels = await createMatchChannels(guild, category, label, allLinked, a.linked, b.linked);
      const moved = await moveMembers(guild, allLinked, channels.gameCommsId);
      const unlinked = [...a.unlinked, ...b.unlinked];
      await interaction.editReply(
        `✅ Created channels for ${label}. Moved ${moved} player(s) into Game Comms.` +
          (unlinked.length
            ? `\n⚠️ Not linked (couldn't add/move): ${unlinked.join(', ')} — they should run /link.`
            : ''),
      );
      return;
    }

    if (sub === 'split') {
      const found = findMatchChannels(guild, label);
      if (!found.teamA || !found.teamB) {
        await interaction.editReply('❌ Team channels not found — run `/match setup` first.');
        return;
      }
      const movedA = await moveMembers(guild, a.linked, found.teamA.id);
      const movedB = await moveMembers(guild, b.linked, found.teamB.id);
      await interaction.editReply(`✅ Split teams — moved ${movedA} to Team A, ${movedB} to Team B.`);
      return;
    }

    if (sub === 'confirm') {
      const winner = interaction.options.getString('winner', true) as 'A' | 'B';
      await apiConfirmMatch(matchId, winner); // applies MMR; match -> confirmed
      const { deleted, errors } = await teardown(guild, allLinked, label);
      await interaction.editReply(
        withErrors(
          `✅ Confirmed — Team ${winner} won, MMR updated. Returned players to Lobby and removed ${deleted} channel(s).`,
          errors,
        ),
      );
      return;
    }

    if (sub === 'cancel') {
      const { deleted, errors } = await teardown(guild, allLinked, label);
      await interaction.editReply(
        withErrors(
          `✅ Cancelled — returned players to Lobby and removed ${deleted} channel(s). ` +
            'The match is still pending, so you can `/match setup` again.',
          errors,
        ),
      );
      return;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = await apiGetMatches().catch(() => [] as ApiMatch[]);
    // Only pending games are manageable, so only those appear in the picker.
    const choices = matches
      .filter((m) => m.status === 'pending')
      .map((m) => {
        const label = m.name ?? `#${m._id.slice(-4)}`;
        const a = m.teamA.map((e) => e.displayName).join('/');
        const b = m.teamB.map((e) => e.displayName).join('/');
        return { name: `${label} — A:${a} vs B:${b}`.slice(0, 100), value: m._id };
      })
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },
};

import { MessageFlags, SlashCommandBuilder } from 'discord.js';
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

export const match: Command = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Run inhouse voice channels for a match')
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
        .setDescription('Confirm the winner (applies MMR on the site)')
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
        .setName('end')
        .setDescription('Return players to Lobby and delete the match channels')
        .addStringOption((o) =>
          o.setName('match').setDescription('Match').setRequired(true).setAutocomplete(true),
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

    if (sub === 'confirm') {
      const winner = interaction.options.getString('winner', true) as 'A' | 'B';
      await apiConfirmMatch(matchId, winner);
      await interaction.editReply(`✅ Confirmed — Team ${winner} won. MMR updated on the site.`);
      return;
    }

    const players = await apiGetPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const a = resolve(match.teamA, byId);
    const b = resolve(match.teamB, byId);
    const label = `#${matchId.slice(-4)}`;

    if (sub === 'setup') {
      const already = findMatchChannels(guild, label);
      if (already.all.length > 0) {
        await interaction.editReply(
          `⚠️ This match is already set up (${already.all.length} channel(s) for ${label}). ` +
            'Run `/match end` first if you want to recreate them.',
        );
        return;
      }
      const category = await ensureCategory(guild);
      const channels = await createMatchChannels(
        guild,
        category,
        label,
        [...a.linked, ...b.linked],
        a.linked,
        b.linked,
      );
      const moved = await moveMembers(guild, [...a.linked, ...b.linked], channels.gameCommsId);
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

    if (sub === 'end') {
      const found = findMatchChannels(guild, label);
      if (found.all.length === 0) {
        await interaction.editReply(`❌ No channels found for ${label} (already cleaned up?).`);
        return;
      }
      if (config.LOBBY_CHANNEL_ID) {
        await moveMembers(guild, [...a.linked, ...b.linked], config.LOBBY_CHANNEL_ID);
      }
      const removed = await deleteChannels(
        guild,
        found.all.map((c) => c.id),
      );
      await interaction.editReply(
        `✅ Match wrapped up — players returned to Lobby and ${removed} channel(s) removed.`,
      );
      return;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = await apiGetMatches().catch(() => [] as ApiMatch[]);
    const choices = matches
      .filter((m) => m.status === 'pending')
      .map((m) => {
        const a = m.teamA.map((e) => e.displayName).join('/');
        const b = m.teamB.map((e) => e.displayName).join('/');
        return { name: `A:${a} vs B:${b} (#${m._id.slice(-4)})`.slice(0, 100), value: m._id };
      })
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },
};

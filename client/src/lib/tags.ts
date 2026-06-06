import type { Player } from '../api/types';

/** Pseudo-tag used in filters to mean "players with no tags". */
export const UNTAGGED = '__untagged__';

/** All distinct tags across players, de-duplicated case-insensitively, sorted for display. */
export function collectTags(players: Player[]): string[] {
  const seen = new Map<string, string>(); // lowercased key -> first-seen display
  for (const p of players) {
    for (const t of p.tags ?? []) {
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function hasUntagged(players: Player[]): boolean {
  return players.some((p) => (p.tags?.length ?? 0) === 0);
}

/**
 * A player matches when no filter is active, or when it carries ANY of the selected
 * tags (OR semantics). `selectedKeys` holds lowercased tags and/or the UNTAGGED marker.
 */
export function matchesTagFilter(player: Player, selectedKeys: Set<string>): boolean {
  if (selectedKeys.size === 0) return true;
  const tags = player.tags ?? [];
  if (tags.length === 0) return selectedKeys.has(UNTAGGED);
  return tags.some((t) => selectedKeys.has(t.toLowerCase()));
}

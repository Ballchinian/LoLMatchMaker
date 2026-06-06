/** In-memory map of which voice channels belong to which match (per bot process). */

export interface MatchChannels {
  categoryId: string;
  gameCommsId: string;
  teamAId: string;
  teamBId: string;
}

const store = new Map<string, MatchChannels>();

export const setMatchChannels = (matchId: string, c: MatchChannels) => store.set(matchId, c);
export const getMatchChannels = (matchId: string) => store.get(matchId);
export const clearMatchChannels = (matchId: string) => store.delete(matchId);

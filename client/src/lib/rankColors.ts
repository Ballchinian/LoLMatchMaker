import type { Tier } from '../api/types';

//Tier -> palette for badges
export const TIER_COLORS: Record<Tier, { bg: string; border: string; text: string }> = {
    IRON: { bg: '#3f3a3a', border: '#5b5252', text: '#cbbfbf' },
    BRONZE: { bg: '#4a2f1d', border: '#7a4a2a', text: '#d39b6e' },
    SILVER: { bg: '#3b4651', border: '#6b7a87', text: '#cdd7df' },
    GOLD: { bg: '#4a3a14', border: '#c79a2e', text: '#f1cf6b' },
    PLATINUM: { bg: '#143b3a', border: '#3fa39a', text: '#7fe3d8' },
    EMERALD: { bg: '#0f3a24', border: '#2ecc71', text: '#71e6a3' },
    DIAMOND: { bg: '#1b2a52', border: '#4f7bd1', text: '#9bb8f5' },
    MASTER: { bg: '#34194a', border: '#9d4edd', text: '#cd9bf0' },
    GRANDMASTER: { bg: '#42161a', border: '#d34c4c', text: '#f09b9b' },
    CHALLENGER: { bg: '#3a3414', border: '#f0c94c', text: '#f7e08a' },
};

export function tierColor(tier: Tier) {
    return TIER_COLORS[tier];
}

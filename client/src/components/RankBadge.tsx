import type { RankInfo } from '../api/types';
import { tierColor } from '../lib/rankColors';

export function RankBadge({ rank, size = 'md' }: { rank: RankInfo; size?: 'sm' | 'md' }) {
  const c = tierColor(rank.tier);
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-semibold ${pad}`}
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
      title={rank.label}
    >
      {rank.label}
    </span>
  );
}

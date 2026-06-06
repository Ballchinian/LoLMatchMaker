import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/client';
import { useAuth } from '../store/useAuth';

/**
 * A user is "privileged" (can inject, edit tags, confirm/discard results) when they've
 * unlocked with an admin/bot token, OR when the server is in open dev mode
 * (writeProtection off — no tokens configured).
 */
export function usePrivileged(): boolean {
  const actor = useAuth((s) => s.actor);
  const { data } = useQuery({ queryKey: ['health'], queryFn: getHealth, staleTime: 30_000 });
  return actor !== null || data?.writeProtection === 'off';
}

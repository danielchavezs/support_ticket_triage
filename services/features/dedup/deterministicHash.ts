/**
 * Deterministic-hash dedup strategy.
 *
 * Looks up the normalized signature in `dedup_signatures` for the org, within
 * the per-org window. Returns `deterministic_hit` on match (with the canonical
 * ticket id from the signature row) or `no_hit` otherwise. A signature row
 * whose canonical ticket is missing/soft-deleted is treated as stale and
 * ignored so the current ticket can become the refreshed canonical.
 *
 * Pure orchestration over the `dedupSignatures` Provider — no state, no
 * embedding logic, no event emission. The orchestrator (`dedupTicketFeature`)
 * decides what to do with the outcome.
 */

import { server as sources } from '@/services/providers/supabase/server';
import type { DedupOutcome } from '@/services/features/dedup/DedupStrategy';

export async function runDeterministicHashStrategy(input: {
  orgId: string;
  ticketId: string;
  normalizedSignature: string;
  windowDays: number;
}): Promise<DedupOutcome> {
  const hit = await sources.dedupSignatures.findByNormalizedSignature({
    orgId: input.orgId,
    normalizedSignature: input.normalizedSignature,
    windowDays: input.windowDays,
  });

  if (!hit) return { kind: 'no_hit' };

  if (hit.canonical_ticket_id === input.ticketId) {
    return { kind: 'no_hit' };
  }

  const canonical = await sources.tickets.getById({
    orgId: input.orgId,
    ticketId: hit.canonical_ticket_id,
  });
  if (!canonical) return { kind: 'no_hit' };

  return {
    kind: 'deterministic_hit',
    canonicalTicketId: hit.canonical_ticket_id,
  };
}

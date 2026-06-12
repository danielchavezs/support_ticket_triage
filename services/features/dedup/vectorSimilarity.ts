/**
 * Vector-similarity dedup strategy.
 *
 * Generates an embedding from the description, then asks the
 * `find_similar_tickets` RPC for the closest match within the org + window
 * that exceeds the similarity threshold. Returns `vector_hit` if the top
 * candidate clears the threshold; `no_hit` otherwise.
 *
 * Returns the generated `embedding` alongside the outcome so the
 * orchestrator can persist it onto the ticket row regardless of whether
 * the vector hit fired — re-embedding the same description in the next
 * code path would burn an extra OpenAI call.
 */

import { ai } from '@/services/providers/ai';
import { server as sources } from '@/services/providers/supabase/server';
import { VECTOR_QUERY_LIMIT, VECTOR_SIMILARITY_THRESHOLD } from '@/services/features/dedup/config';
import type { DedupOutcome } from '@/services/features/dedup/DedupStrategy';

export type VectorStrategyResult = {
  outcome: DedupOutcome;
  embedding: number[];
};

export async function runVectorSimilarityStrategy(input: {
  orgId: string;
  description: string;
  windowDays: number;
  similarityThreshold?: number;
  limit?: number;
}): Promise<VectorStrategyResult> {
  const threshold = input.similarityThreshold ?? VECTOR_SIMILARITY_THRESHOLD;
  const limit = input.limit ?? VECTOR_QUERY_LIMIT;

  const embedding = await ai.generateEmbedding(input.description);

  const candidates = await sources.dedupSignatures.findSimilarTickets({
    orgId: input.orgId,
    queryEmbedding: embedding,
    windowDays: input.windowDays,
    similarityThreshold: threshold,
    limit,
  });

  if (candidates.length === 0) {
    return { outcome: { kind: 'no_hit' }, embedding };
  }

  // The RPC already orders by distance ascending (similarity descending) and
  // filters below-threshold rows out — the top item is the best match that
  // cleared the threshold.
  const top = candidates[0];
  return {
    outcome: {
      kind: 'vector_hit',
      candidateCanonicalTicketId: top.ticketId,
      similarity: top.similarity,
    },
    embedding,
  };
}

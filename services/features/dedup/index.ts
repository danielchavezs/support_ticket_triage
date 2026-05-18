/**
 * Dedup Feature — barrel exports.
 *
 * Pipeline contribution (step 2 of the architecture doc):
 *   1. Compute a normalized signature from subject + description.
 *   2. Deterministic-hash lookup against `dedup_signatures`.
 *   3. If enabled per-org, vector-similarity lookup against
 *      `tickets.description_embedding` via the `find_similar_tickets` RPC.
 *   4. Hybrid action on hit (deterministic = hard link; vector = soft flag).
 *   5. Persist signature + embedding on no-hit so future tickets see this
 *      one as a candidate canonical.
 *
 * Caller: `createTicketFeature` in `services/features/tickets/`.
 */

export {
  DEFAULT_DEDUP_WINDOW_DAYS,
  VECTOR_QUERY_LIMIT,
  VECTOR_SIMILARITY_THRESHOLD,
} from '@/services/features/dedup/config';
export type { DedupOutcome } from '@/services/features/dedup/DedupStrategy';
export { hashNormalized, normalize } from '@/services/features/dedup/signatures';
export { dedupTicketFeature, DedupInputSchema, type DedupInput } from '@/services/features/dedup/dedupTicket';

/**
 * Tunable constants for the Dedup Feature.
 *
 * `DEFAULT_DEDUP_WINDOW_DAYS` is the system fallback when an org has no
 * `org_settings` row, or the row's `dedup_window_days` column is NULL. Per
 * `BL-005`, orgs may override this in their `org_settings` row.
 *
 * `VECTOR_SIMILARITY_THRESHOLD` is the cosine-similarity cutoff for the
 * vector-similarity strategy. 0.92 is a starting point — tune in dev once
 * we have real ticket corpora to evaluate against. The threshold is included
 * in the `deduplicated` event payload on every vector hit so downstream
 * tooling can audit the value used at the time of detection.
 *
 * `VECTOR_QUERY_LIMIT` is the top-K we ask the `find_similar_tickets` RPC
 * for. The orchestrator only uses the top result; the larger K is reserved
 * for future "list of candidates" UI surfaces.
 */

export const DEFAULT_DEDUP_WINDOW_DAYS = 90;
export const VECTOR_SIMILARITY_THRESHOLD = 0.92;
export const VECTOR_QUERY_LIMIT = 5;

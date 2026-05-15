/**
 * Common types for Dedup strategies.
 *
 * The orchestrator (`dedupTicketFeature`) is the only consumer of these types
 * directly; the per-strategy modules (`deterministicHash`, `vectorSimilarity`)
 * each expose a `run(...)` function that returns a `DedupOutcome`. They are
 * not classes — a function is sufficient and lets the orchestrator inject
 * everything needed without DI scaffolding.
 *
 * The `DedupOutcome` discriminated union is intentionally narrow:
 *
 *   - `no_hit`               : neither strategy matched. Caller records a new
 *                              canonical signature and continues triage.
 *   - `deterministic_hit`    : exact normalized-text match within the window.
 *                              Caller hard-links the ticket (`duplicate_of`,
 *                              `status='duplicate'`) and skips triage.
 *   - `vector_hit`           : cosine similarity above the threshold, no
 *                              deterministic hit. Caller emits an audit
 *                              `deduplicated` event but does NOT change
 *                              `duplicate_of` or `status` (per BL-004 hybrid).
 *
 * The vector strategy carries the `similarity` score so downstream tooling
 * (logs, dashboard) can see how close the match was.
 */

export type DedupOutcome =
  | { kind: 'no_hit' }
  | { kind: 'deterministic_hit'; canonicalTicketId: string }
  | { kind: 'vector_hit'; candidateCanonicalTicketId: string; similarity: number };

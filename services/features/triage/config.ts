/**
 * Tunable constants for Phase 3.5 tool-augmented classification.
 *
 * `MAX_TOOL_ROUNDS` is the hard ceiling on `stepCountIs(...)` for the
 * classifier's tool loop. Each round is one (LLM call + optional tool
 * call/result). 4 keeps the median wall-clock budget well inside the
 * `TOOL_LOOP_DEADLINE_MS` envelope; tighten this before raising the
 * deadline if production traces show fallback rates climbing above ~10%.
 *
 * `TOOL_LOOP_DEADLINE_MS` is enforced via the AI SDK `timeout` option on
 * `generateText`. On timeout the tool-loop rejects; the triage Feature
 * catches the rejection and runs the single-shot fallback.
 *
 * `CONTEXT_SIMILARITY_THRESHOLD` is the cosine-similarity cutoff for the
 * `findSimilarTicketsForContext` tool. It is intentionally looser than the
 * dedup threshold (`VECTOR_SIMILARITY_THRESHOLD = 0.92` in
 * `services/features/dedup/config.ts`): the tool is read-only and only
 * informs the classifier — it never commits a link — so casting a wider
 * net for "nearby" tickets gives the model more context without affecting
 * deterministic dedup behavior.
 */

export const MAX_TOOL_ROUNDS = 4;
export const TOOL_LOOP_DEADLINE_MS = 15000;
export const CONTEXT_SIMILARITY_THRESHOLD = 0.7;

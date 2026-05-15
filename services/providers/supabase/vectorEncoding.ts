/**
 * Wire-format helpers for `pgvector` columns through the Supabase TS client.
 *
 * Supabase serializes `vector(N)` values as strings of the form `[v1,v2,...]`
 * on both read and write paths. Provider methods that accept embeddings as
 * `number[]` use `serializeEmbedding` to produce the wire string; deserialization
 * is intentionally not implemented because the Feature layer never reads
 * embeddings back into JS — dedup similarity is computed inside Postgres via
 * the `find_similar_tickets` RPC (see migration `2026-05-14_12`).
 */

export function serializeEmbedding(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

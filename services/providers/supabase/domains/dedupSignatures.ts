/**
 * `dedup_signatures` domain — Supabase Provider adapter for Phase 3
 * deterministic-hash lookups and vector-similarity lookups.
 *
 * Org-scoping invariant (load-bearing):
 *   Every method below applies an `org_id` predicate. The `find_similar_tickets`
 *   RPC also takes `p_org_id` and embeds it as a WHERE clause in the function
 *   body (see migration `2026-05-14_12`). Cross-org dedup is a critical bug;
 *   never relax the predicate.
 *
 * The dedup window (BL-005) is computed in JS by the caller and passed
 * through as an ISO timestamp lower bound (`findByNormalizedSignature`) or
 * as a day-count parameter to the RPC (`findSimilarTickets`). Phase 3 keeps
 * window math out of the DB-facing query so the Feature layer can read the
 * per-org window from `org_settings` and decide policy in one place.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/assets/databaseTypes';
import { serializeEmbedding } from '@/services/providers/supabase/vectorEncoding';

export type DedupSignatureRow = Tables<'dedup_signatures'>;
export type NewDedupSignatureRow = TablesInsert<'dedup_signatures'>;
export type DedupSignaturesSource = ReturnType<typeof makeDedupSignatures>;

export type SimilarTicketHit = {
  ticketId: string;
  similarity: number;
};

export function makeDedupSignatures(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    /**
     * Deterministic-hash lookup. Returns the latest signature row within the
     * caller-supplied window (in days) whose `normalized_signature` matches,
     * or null if no match exists for this org.
     *
     * Window math: `windowDays` is converted to an ISO timestamp lower bound
     * here. Some clock skew between client and DB is acceptable — dedup is a
     * soft heuristic, not a transactional invariant.
     */
    async findByNormalizedSignature({
      orgId,
      normalizedSignature,
      windowDays,
    }: {
      orgId: string;
      normalizedSignature: string;
      windowDays: number;
    }): Promise<DedupSignatureRow | null> {
      const supabase = await getSupabaseClient();
      const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('dedup_signatures')
        .select('*')
        .eq('org_id', orgId)
        .eq('normalized_signature', normalizedSignature)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as DedupSignatureRow | null;
    },

    /**
     * Vector-similarity lookup via the `find_similar_tickets` Postgres RPC.
     * The RPC body enforces the `org_id` predicate inside the function (see
     * migration `2026-05-14_12`); passing the wrong `orgId` here cannot leak
     * cross-org rows even if a downstream caller forgets to filter.
     *
     * `queryEmbedding` is a 1536-dim float array (the dimensionality is
     * enforced at the DB layer by the `vector(1536)` column type).
     */
    async findSimilarTickets({
      orgId,
      queryEmbedding,
      windowDays,
      similarityThreshold,
      limit,
    }: {
      orgId: string;
      queryEmbedding: number[];
      windowDays: number;
      similarityThreshold: number;
      limit: number;
    }): Promise<SimilarTicketHit[]> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.rpc('find_similar_tickets', {
        p_org_id: orgId,
        p_query_embedding: serializeEmbedding(queryEmbedding),
        p_window_days: windowDays,
        p_similarity_threshold: similarityThreshold,
        p_limit: limit,
      });

      if (error) throw error;
      return (data ?? []).map((row) => ({
        ticketId: row.ticket_id,
        similarity: row.similarity,
      }));
    },

    /**
     * Create or refresh the canonical signature row. The `(org_id,
     * normalized_signature)` uniqueness constraint means there is only one
     * active signature pointer per org+signature; refreshing `created_at` is
     * what lets the per-org dedup window expire and later accept a new
     * canonical ticket for the same normalized text.
     *
     * The composite FK on `(canonical_ticket_id, org_id) → tickets(id,
     * org_id)` rejects the write at the DB layer if the canonical ticket
     * belongs to a different org.
     */
    async create({
      orgId,
      normalizedSignature,
      canonicalTicketId,
    }: {
      orgId: string;
      normalizedSignature: string;
      canonicalTicketId: string;
    }): Promise<DedupSignatureRow> {
      const supabase = await getSupabaseClient();
      const insertRow: NewDedupSignatureRow = {
        org_id: orgId,
        normalized_signature: normalizedSignature,
        canonical_ticket_id: canonicalTicketId,
        created_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('dedup_signatures')
        .upsert(insertRow, { onConflict: 'org_id,normalized_signature' })
        .select('*')
        .single();

      if (error) throw error;
      return data as DedupSignatureRow;
    },
  };
}

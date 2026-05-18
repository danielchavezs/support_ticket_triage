/**
 * Dedup Feature — orchestrator for pipeline step 2 (architecture doc).
 *
 * Inserted between `createTicketFeature`'s `received` emission and the inline
 * triage call. Implements the hybrid action locked by `BL-004`:
 *
 *   - Deterministic hash hit  → hard link
 *                                (`duplicate_of`, `status='duplicate'`,
 *                                 `dedup_signature`)
 *                              + emit `deduplicated` with
 *                                `detection='deterministic_hash'`.
 *   - Vector similarity hit   → soft flag
 *                              + emit `deduplicated` with
 *                                `detection='vector_similarity'` and the
 *                                candidate canonical id in the payload.
 *                                The row's `duplicate_of` and `status` are
 *                                NOT changed — the linkage stays in the
 *                                event log so downstream consumers can act
 *                                without committing the link prematurely.
 *   - No hit                  → record a new canonical signature in
 *                                `dedup_signatures`. Persist the embedding
 *                                (if generated) on the ticket row so the
 *                                vector index has a value for future
 *                                lookups.
 *
 * Per-org settings (`org_settings`):
 *   - `dedup_window_days`     defaults to `DEFAULT_DEDUP_WINDOW_DAYS` (90)
 *                              when the org has no row or the column is null.
 *   - `vector_dedup_enabled`  defaults to `false`. Vector strategy only runs
 *                              when this flag is `true` for the calling org.
 *
 * Errors are normalized to `FeatureError`. Provider/AI exceptions are caught
 * here and surfaced with one of: `VALIDATION_ERROR`, `DEDUP_LOOKUP_FAILED`,
 * `EMBEDDING_FAILED`, `DEDUP_PERSIST_FAILED`.
 */

import { fail, ok, type FeatureResult } from '@/services/features/types';
import { server as sources } from '@/services/providers/supabase/server';
import { TicketScopedInputSchema } from '@/services/features/tickets/schemas';
import { z } from 'zod';
import type { Json } from '@/assets/databaseTypes';
import { DEFAULT_DEDUP_WINDOW_DAYS } from '@/services/features/dedup/config';
import type { DedupOutcome } from '@/services/features/dedup/DedupStrategy';
import { hashNormalized, normalize } from '@/services/features/dedup/signatures';
import { runDeterministicHashStrategy } from '@/services/features/dedup/deterministicHash';
import { runVectorSimilarityStrategy } from '@/services/features/dedup/vectorSimilarity';

export const DedupInputSchema = TicketScopedInputSchema.extend({
  subject: z.string().trim().min(1, 'Subject is required.'),
  description: z.string().trim().min(1, 'Description is required.'),
});

export type DedupInput = z.infer<typeof DedupInputSchema>;

export async function dedupTicketFeature(input: DedupInput): Promise<FeatureResult<DedupOutcome>> {
  const parsed = DedupInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.');
  }
  const { orgId, ticketId, subject, description } = parsed.data;

  // Read per-org settings; fall back to defaults when the row is missing.
  let windowDays = DEFAULT_DEDUP_WINDOW_DAYS;
  let vectorEnabled = false;
  try {
    const settings = await sources.orgSettings.getByOrg({ orgId });
    if (settings) {
      windowDays = settings.dedup_window_days ?? DEFAULT_DEDUP_WINDOW_DAYS;
      vectorEnabled = settings.vector_dedup_enabled;
    }
  } catch (err) {
    console.error('Dedup: org_settings fetch failed (continuing with defaults):', err);
  }

  const normalizedText = normalize(subject, description);
  const signature = hashNormalized(normalizedText);

  // Stage 1: deterministic hash strategy.
  let deterministic: DedupOutcome;
  try {
    deterministic = await runDeterministicHashStrategy({
      orgId,
      ticketId,
      normalizedSignature: signature,
      windowDays,
    });
  } catch (err) {
    return fail('DEDUP_LOOKUP_FAILED', errorMessage(err));
  }

  if (deterministic.kind === 'deterministic_hit') {
    try {
      await sources.tickets.updateDedupState({
        orgId,
        ticketId,
        update: {
          dedupSignature: signature,
          duplicateOf: deterministic.canonicalTicketId,
          status: 'duplicate',
        },
      });
    } catch (err) {
      return fail('DEDUP_PERSIST_FAILED', errorMessage(err));
    }

    void emitDeduplicated(orgId, ticketId, {
      detection: 'deterministic_hash',
      canonical_ticket_id: deterministic.canonicalTicketId,
      window_days: windowDays,
    });

    return ok(deterministic);
  }

  // Stage 2: vector strategy (only when enabled for this org).
  if (vectorEnabled) {
    let embedding: number[];
    let vectorOutcome: DedupOutcome;
    try {
      const result = await runVectorSimilarityStrategy({
        orgId,
        description,
        windowDays,
      });
      embedding = result.embedding;
      vectorOutcome = result.outcome;
    } catch (err) {
      return fail('EMBEDDING_FAILED', errorMessage(err));
    }

    if (vectorOutcome.kind === 'vector_hit') {
      try {
        await sources.tickets.updateDedupState({
          orgId,
          ticketId,
          update: {
            dedupSignature: signature,
            descriptionEmbedding: embedding,
          },
        });
      } catch (err) {
        return fail('DEDUP_PERSIST_FAILED', errorMessage(err));
      }

      void emitDeduplicated(orgId, ticketId, {
        detection: 'vector_similarity',
        candidate_canonical_ticket_id: vectorOutcome.candidateCanonicalTicketId,
        similarity_score: vectorOutcome.similarity,
        window_days: windowDays,
      });

      return ok(vectorOutcome);
    }

    // Vector strategy ran but no hit — record canonical + persist embedding.
    return persistNoHit({
      orgId,
      ticketId,
      signature,
      embedding,
    });
  }

  // Vector disabled and deterministic missed — record canonical, no embedding.
  return persistNoHit({ orgId, ticketId, signature, embedding: null });
}

async function persistNoHit({
  orgId,
  ticketId,
  signature,
  embedding,
}: {
  orgId: string;
  ticketId: string;
  signature: string;
  embedding: number[] | null;
}): Promise<FeatureResult<DedupOutcome>> {
  try {
    await sources.dedupSignatures.create({
      orgId,
      normalizedSignature: signature,
      canonicalTicketId: ticketId,
    });
  } catch (err) {
    return fail('DEDUP_PERSIST_FAILED', errorMessage(err));
  }

  try {
    await sources.tickets.updateDedupState({
      orgId,
      ticketId,
      update: {
        dedupSignature: signature,
        ...(embedding != null ? { descriptionEmbedding: embedding } : {}),
      },
    });
  } catch (err) {
    return fail('DEDUP_PERSIST_FAILED', errorMessage(err));
  }

  return ok({ kind: 'no_hit' });
}

async function emitDeduplicated(
  orgId: string,
  ticketId: string,
  payload: { [key: string]: Json },
): Promise<void> {
  try {
    await sources.ticketEvents.create({
      orgId,
      ticketId,
      eventType: 'deduplicated',
      payload,
    });
  } catch (err) {
    console.error('ticket_events.deduplicated emission failed (non-fatal):', err);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}

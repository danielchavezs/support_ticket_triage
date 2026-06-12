/**
 * Provider-domain tests for `dedup_signatures`.
 *
 * Org-scoping invariants under test:
 *   - `findByNormalizedSignature` applies the `org_id` predicate.
 *   - `findSimilarTickets` passes `p_org_id` to the Postgres RPC; the RPC body
 *     enforces the predicate inside the function, but the client must still
 *     forward the correct org for the function to do its job.
 *   - `create` upserts with `org_id` set; the DB composite FK rejects
 *     cross-org canonical references and the test mocks the error path.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  makeDedupSignatures,
  type DedupSignatureRow,
} from '@/services/providers/supabase/domains/dedupSignatures';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const TICKET_C1 = '00000000-0000-0000-0000-0000000000c1';

type FluentBuilder = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  __eqCalls: Array<[string, unknown]>;
  __gteCalls: Array<[string, unknown]>;
  __insertCalls: Array<unknown>;
  __upsertCalls: Array<{ row: unknown; options: unknown }>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const eqCalls: Array<[string, unknown]> = [];
  const gteCalls: Array<[string, unknown]> = [];
  const insertCalls: Array<unknown> = [];
  const upsertCalls: Array<{ row: unknown; options: unknown }> = [];
  const builder = {
    __eqCalls: eqCalls,
    __gteCalls: gteCalls,
    __insertCalls: insertCalls,
    __upsertCalls: upsertCalls,
  } as unknown as FluentBuilder;

  builder.select = vi.fn(() => builder);
  builder.insert = vi.fn((row: unknown) => {
    insertCalls.push(row);
    return builder;
  });
  builder.upsert = vi.fn((row: unknown, options: unknown) => {
    upsertCalls.push({ row, options });
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.gte = vi.fn((column: string, value: unknown) => {
    gteCalls.push([column, value]);
    return builder;
  });
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  builder.single = vi.fn(() => Promise.resolve(finalResult));
  return builder;
}

function makeClient(builder: FluentBuilder, rpcResult?: { data: unknown; error: unknown }) {
  const fromMock = vi.fn(() => builder);
  const rpcMock = vi.fn(() => Promise.resolve(rpcResult ?? { data: [], error: null }));
  const client = { from: fromMock, rpc: rpcMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock, rpcMock };
}

const baseSignatureRow: DedupSignatureRow = {
  id: '22222222-2222-2222-2222-222222222222',
  org_id: ORG_A,
  normalized_signature: 'sig-abc',
  canonical_ticket_id: TICKET_C1,
  created_at: new Date(0).toISOString(),
};

describe('dedupSignatures domain', () => {
  describe('findByNormalizedSignature', () => {
    it('filters by org_id + normalized_signature + window lower bound', async () => {
      const builder = makeBuilder({ data: baseSignatureRow, error: null });
      const { client, fromMock } = makeClient(builder);
      const dedup = makeDedupSignatures(async () => client);

      const before = Date.now();
      const result = await dedup.findByNormalizedSignature({
        orgId: ORG_A,
        normalizedSignature: 'sig-abc',
        windowDays: 90,
      });

      expect(fromMock).toHaveBeenCalledWith('dedup_signatures');
      expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
      expect(builder.__eqCalls).toContainEqual(['normalized_signature', 'sig-abc']);

      // The window lower bound is now() - 90 days; verify it lands in a
      // sensible neighborhood of the expected timestamp.
      const [column, value] = builder.__gteCalls[0] ?? [];
      expect(column).toBe('created_at');
      const cutoff = new Date(value as string).getTime();
      const expectedCutoff = before - 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5_000);

      expect(builder.limit).toHaveBeenCalledWith(1);
      expect(builder.maybeSingle).toHaveBeenCalled();
      expect(result).toEqual(baseSignatureRow);
    });

    it('returns null when no matching signature exists in the window', async () => {
      const builder = makeBuilder({ data: null, error: null });
      const { client } = makeClient(builder);
      const dedup = makeDedupSignatures(async () => client);

      const result = await dedup.findByNormalizedSignature({
        orgId: ORG_A,
        normalizedSignature: 'never-seen',
        windowDays: 30,
      });
      expect(result).toBeNull();
    });

    it('throws on Supabase error', async () => {
      const builder = makeBuilder({ data: null, error: new Error('db down') });
      const { client } = makeClient(builder);
      const dedup = makeDedupSignatures(async () => client);

      await expect(
        dedup.findByNormalizedSignature({ orgId: ORG_A, normalizedSignature: 'x', windowDays: 90 }),
      ).rejects.toThrow('db down');
    });
  });

  describe('findSimilarTickets', () => {
    it('forwards every arg to the find_similar_tickets RPC and maps the result', async () => {
      const builder = makeBuilder({ data: null, error: null });
      const rpcRows = [
        { ticket_id: '00000000-0000-0000-0000-0000000000d1', similarity: 0.95 },
        { ticket_id: '00000000-0000-0000-0000-0000000000d2', similarity: 0.93 },
      ];
      const { client, rpcMock } = makeClient(builder, { data: rpcRows, error: null });
      const dedup = makeDedupSignatures(async () => client);

      const embedding = [0.1, 0.2, 0.3];
      const result = await dedup.findSimilarTickets({
        orgId: ORG_A,
        queryEmbedding: embedding,
        windowDays: 90,
        similarityThreshold: 0.92,
        limit: 5,
      });

      expect(rpcMock).toHaveBeenCalledWith('find_similar_tickets', {
        p_org_id: ORG_A,
        p_query_embedding: '[0.1,0.2,0.3]',
        p_window_days: 90,
        p_similarity_threshold: 0.92,
        p_limit: 5,
      });
      expect(result).toEqual([
        { ticketId: '00000000-0000-0000-0000-0000000000d1', similarity: 0.95 },
        { ticketId: '00000000-0000-0000-0000-0000000000d2', similarity: 0.93 },
      ]);
    });

    it('returns an empty array when the RPC returns no rows', async () => {
      const builder = makeBuilder({ data: null, error: null });
      const { client } = makeClient(builder, { data: null, error: null });
      const dedup = makeDedupSignatures(async () => client);

      const result = await dedup.findSimilarTickets({
        orgId: ORG_A,
        queryEmbedding: [0, 0, 0],
        windowDays: 90,
        similarityThreshold: 0.99,
        limit: 5,
      });
      expect(result).toEqual([]);
    });

    it('throws on RPC error', async () => {
      const builder = makeBuilder({ data: null, error: null });
      const { client } = makeClient(builder, { data: null, error: new Error('rpc fail') });
      const dedup = makeDedupSignatures(async () => client);

      await expect(
        dedup.findSimilarTickets({
          orgId: ORG_A,
          queryEmbedding: [0, 0, 0],
          windowDays: 90,
          similarityThreshold: 0.92,
          limit: 5,
        }),
      ).rejects.toThrow('rpc fail');
    });
  });

  describe('create', () => {
    it('upserts a row with org_id, normalized_signature, canonical_ticket_id, and refreshed created_at', async () => {
      const builder = makeBuilder({ data: baseSignatureRow, error: null });
      const { client, fromMock } = makeClient(builder);
      const dedup = makeDedupSignatures(async () => client);

      const result = await dedup.create({
        orgId: ORG_A,
        normalizedSignature: 'sig-abc',
        canonicalTicketId: TICKET_C1,
      });

      expect(fromMock).toHaveBeenCalledWith('dedup_signatures');
      expect(builder.__insertCalls).toEqual([]);
      expect(builder.__upsertCalls).toHaveLength(1);
      expect(builder.__upsertCalls[0]).toEqual({
        row: {
          org_id: ORG_A,
          normalized_signature: 'sig-abc',
          canonical_ticket_id: TICKET_C1,
          created_at: expect.any(String),
        },
        options: { onConflict: 'org_id,normalized_signature' },
      });
      expect(result).toEqual(baseSignatureRow);
    });

    it('propagates DB error (e.g., cross-org composite FK rejection)', async () => {
      const builder = makeBuilder({
        data: null,
        error: new Error('insert or update on table "dedup_signatures" violates foreign key constraint'),
      });
      const { client } = makeClient(builder);
      const dedup = makeDedupSignatures(async () => client);

      await expect(
        dedup.create({
          orgId: ORG_A,
          normalizedSignature: 'sig-abc',
          canonicalTicketId: TICKET_C1,
        }),
      ).rejects.toThrow(/foreign key constraint/);
    });
  });
});

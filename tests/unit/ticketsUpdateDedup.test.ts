/**
 * Provider-domain tests for `tickets.updateDedupState`.
 *
 * Asserts:
 *   - org_id + id predicates always applied.
 *   - Only fields present on `update` are written to the row (partial patch).
 *   - `descriptionEmbedding` is serialized to the pgvector text format.
 *   - Caller can clear `duplicate_of` with `null`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeTickets, type TicketRow } from '@/services/providers/supabase/domains/tickets';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const TICKET_A = '00000000-0000-0000-0000-0000000000d1';
const TICKET_CANONICAL = '00000000-0000-0000-0000-0000000000c1';

type FluentBuilder = {
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  __updateCalls: Array<Record<string, unknown>>;
  __eqCalls: Array<[string, unknown]>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const updateCalls: Array<Record<string, unknown>> = [];
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    __updateCalls: updateCalls,
    __eqCalls: eqCalls,
  } as unknown as FluentBuilder;

  builder.update = vi.fn((row: Record<string, unknown>) => {
    updateCalls.push(row);
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.single = vi.fn(() => Promise.resolve(finalResult));
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock };
}

const baseTicketRow: TicketRow = {
  id: TICKET_A,
  org_id: ORG_A,
  user_id: '00000000-0000-0000-0000-0000000000a1',
  source_kind: 'in_app',
  subject: 'My printer is broken',
  description: 'It just stopped working today.',
  type: null,
  severity: null,
  priority: null,
  confidence: null,
  customer_facing_summary: null,
  suggested_reply: null,
  status: 'received',
  triage_error: null,
  dedup_signature: null,
  duplicate_of: null,
  linear_issue_id: null,
  linear_state: null,
  description_embedding: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

describe('tickets.updateDedupState', () => {
  it('applies id + org_id predicates and writes only the fields supplied', async () => {
    const builder = makeBuilder({
      data: { ...baseTicketRow, dedup_signature: 'sig-abc', duplicate_of: TICKET_CANONICAL, status: 'duplicate' },
      error: null,
    });
    const { client, fromMock } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.updateDedupState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      update: {
        dedupSignature: 'sig-abc',
        duplicateOf: TICKET_CANONICAL,
        status: 'duplicate',
      },
    });

    expect(fromMock).toHaveBeenCalledWith('tickets');
    expect(builder.__eqCalls).toContainEqual(['id', TICKET_A]);
    expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
    expect(builder.__updateCalls).toEqual([
      {
        dedup_signature: 'sig-abc',
        duplicate_of: TICKET_CANONICAL,
        status: 'duplicate',
      },
    ]);
    expect(result.status).toBe('duplicate');
  });

  it('serializes descriptionEmbedding to the pgvector text format', async () => {
    const builder = makeBuilder({ data: baseTicketRow, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.updateDedupState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      update: {
        dedupSignature: 'sig-xyz',
        descriptionEmbedding: [0.5, -0.25, 1.0],
      },
    });

    expect(builder.__updateCalls[0]).toEqual({
      dedup_signature: 'sig-xyz',
      description_embedding: '[0.5,-0.25,1]',
    });
  });

  it('writes a null descriptionEmbedding when explicitly cleared', async () => {
    const builder = makeBuilder({ data: baseTicketRow, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.updateDedupState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      update: { descriptionEmbedding: null },
    });

    expect(builder.__updateCalls[0]).toEqual({ description_embedding: null });
  });

  it('allows clearing duplicate_of and resetting status (retry stale-duplicate path)', async () => {
    const builder = makeBuilder({ data: baseTicketRow, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.updateDedupState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      update: { duplicateOf: null, status: 'received' },
    });

    expect(builder.__updateCalls[0]).toEqual({ duplicate_of: null, status: 'received' });
  });

  it('throws on Supabase error', async () => {
    const builder = makeBuilder({ data: null, error: new Error('db down') });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await expect(
      tickets.updateDedupState({
        orgId: ORG_A,
        ticketId: TICKET_A,
        update: { status: 'duplicate' },
      }),
    ).rejects.toThrow('db down');
  });
});

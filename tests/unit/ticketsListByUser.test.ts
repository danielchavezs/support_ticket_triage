/**
 * Provider-domain tests for `tickets.listByUser` (Phase 3.5).
 *
 * Asserts:
 *   - both `org_id` AND `user_id` equality predicates are applied to every
 *     query (the Phase 3.5 tool factory leans on this for cross-org +
 *     cross-user isolation, since the agent has no way to inject either id).
 *   - the soft-delete filter (`deleted_at IS NULL`) is applied.
 *   - the caller-supplied `limit` is forwarded to Supabase.
 *   - rows are ordered newest-first by `created_at`.
 *   - Supabase errors propagate raw (Feature layer normalizes).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeTickets, type TicketRow } from '@/services/providers/supabase/domains/tickets';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const ORG_B = '00000000-0000-0000-0000-0000000000b0';
const USER_1 = '00000000-0000-0000-0000-0000000000a1';
const USER_2 = '00000000-0000-0000-0000-0000000000a2';

type FluentBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  __eqCalls: Array<[string, unknown]>;
  __isCalls: Array<[string, unknown]>;
  __orderCalls: Array<[string, { ascending: boolean } | undefined]>;
  __limitCalls: Array<number>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const eqCalls: Array<[string, unknown]> = [];
  const isCalls: Array<[string, unknown]> = [];
  const orderCalls: Array<[string, { ascending: boolean } | undefined]> = [];
  const limitCalls: Array<number> = [];

  const builder = {
    __eqCalls: eqCalls,
    __isCalls: isCalls,
    __orderCalls: orderCalls,
    __limitCalls: limitCalls,
  } as unknown as FluentBuilder;

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.is = vi.fn((column: string, value: unknown) => {
    isCalls.push([column, value]);
    return builder;
  });
  builder.order = vi.fn((column: string, options?: { ascending: boolean }) => {
    orderCalls.push([column, options]);
    return builder;
  });
  // `.limit(n)` is the terminal call — it resolves to the final result.
  builder.limit = vi.fn((n: number) => {
    limitCalls.push(n);
    return Promise.resolve(finalResult);
  });
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock };
}

const baseTicketRow: TicketRow = {
  id: '00000000-0000-0000-0000-0000000000d1',
  org_id: ORG_A,
  user_id: USER_1,
  source_kind: 'in_app',
  subject: 'Printer broken',
  description: 'No paper feed.',
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
  description_embedding: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

describe('tickets.listByUser', () => {
  it('applies org_id AND user_id predicates, soft-delete filter, and forwards limit', async () => {
    const builder = makeBuilder({ data: [baseTicketRow], error: null });
    const { client, fromMock } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.listByUser({ orgId: ORG_A, userId: USER_1, limit: 5 });

    expect(fromMock).toHaveBeenCalledWith('tickets');
    expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
    expect(builder.__eqCalls).toContainEqual(['user_id', USER_1]);
    expect(builder.__isCalls).toContainEqual(['deleted_at', null]);
    expect(builder.__orderCalls).toEqual([['created_at', { ascending: false }]]);
    expect(builder.__limitCalls).toEqual([5]);
    expect(result).toEqual([baseTicketRow]);
  });

  it('returns an empty array when Supabase returns no rows', async () => {
    const builder = makeBuilder({ data: null, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.listByUser({ orgId: ORG_A, userId: USER_1, limit: 5 });
    expect(result).toEqual([]);
  });

  it('isolates by user within the same org (predicate carries the user id verbatim)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.listByUser({ orgId: ORG_A, userId: USER_2, limit: 10 });

    expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
    expect(builder.__eqCalls).toContainEqual(['user_id', USER_2]);
    // No org_id leakage to another value.
    expect(builder.__eqCalls.filter(([col]) => col === 'org_id')).toEqual([['org_id', ORG_A]]);
  });

  it('isolates by org for the same user (cross-org assertion is impossible at the query layer)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.listByUser({ orgId: ORG_B, userId: USER_1, limit: 5 });

    expect(builder.__eqCalls).toContainEqual(['org_id', ORG_B]);
    expect(builder.__eqCalls).toContainEqual(['user_id', USER_1]);
  });

  it('throws on Supabase error', async () => {
    const builder = makeBuilder({ data: null, error: new Error('connection refused') });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await expect(
      tickets.listByUser({ orgId: ORG_A, userId: USER_1, limit: 5 }),
    ).rejects.toThrow('connection refused');
  });
});

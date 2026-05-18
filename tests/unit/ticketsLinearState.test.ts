/**
 * Provider-domain tests for the Phase 5 additions to the `tickets` domain:
 *   - `findByLinearIssueId(linearIssueId)` — no org predicate, soft-delete filter.
 *   - `updateLinearState({ orgId, ticketId, linearState, status? })` — partial
 *     update on `linear_state` (always) and `status` (when provided).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeTickets, type TicketRow } from '@/services/providers/supabase/domains/tickets';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const TICKET_A = '00000000-0000-0000-0000-0000000000d1';
const LINEAR_ISSUE = 'lin-uuid-1';

type FluentBuilder = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  __eqCalls: Array<[string, unknown]>;
  __isCalls: Array<[string, unknown]>;
  __updateCalls: Array<Record<string, unknown>>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const eqCalls: Array<[string, unknown]> = [];
  const isCalls: Array<[string, unknown]> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const builder = {
    __eqCalls: eqCalls,
    __isCalls: isCalls,
    __updateCalls: updateCalls,
  } as unknown as FluentBuilder;
  builder.select = vi.fn(() => builder);
  builder.update = vi.fn((row: Record<string, unknown>) => {
    updateCalls.push(row);
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.is = vi.fn((column: string, value: unknown) => {
    isCalls.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  builder.single = vi.fn(() => Promise.resolve(finalResult));
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  return { client: { from: fromMock } as unknown as SupabaseClient<Database>, fromMock };
}

const baseRow: TicketRow = {
  id: TICKET_A,
  org_id: ORG_A,
  user_id: '00000000-0000-0000-0000-0000000000a1',
  source_kind: 'in_app',
  subject: 'subj',
  description: 'desc',
  type: null,
  severity: null,
  priority: null,
  confidence: null,
  customer_facing_summary: null,
  suggested_reply: null,
  status: 'triaged',
  triage_error: null,
  dedup_signature: null,
  duplicate_of: null,
  linear_issue_id: LINEAR_ISSUE,
  linear_state: null,
  description_embedding: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

describe('tickets.findByLinearIssueId', () => {
  it('filters by linear_issue_id and soft-delete only (no org predicate)', async () => {
    const builder = makeBuilder({ data: baseRow, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.findByLinearIssueId(LINEAR_ISSUE);

    expect(builder.__eqCalls).toEqual([['linear_issue_id', LINEAR_ISSUE]]);
    expect(builder.__isCalls).toContainEqual(['deleted_at', null]);
    expect(result).toEqual(baseRow);
  });

  it('returns null when no row matches', async () => {
    const builder = makeBuilder({ data: null, error: null });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.findByLinearIssueId('lin-not-here');
    expect(result).toBeNull();
  });

  it('throws on Supabase error', async () => {
    const builder = makeBuilder({ data: null, error: new Error('db down') });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await expect(tickets.findByLinearIssueId(LINEAR_ISSUE)).rejects.toThrow('db down');
  });
});

describe('tickets.updateLinearState', () => {
  it('updates linear_state and applies org+id predicates; status is left unchanged when omitted', async () => {
    const builder = makeBuilder({
      data: { ...baseRow, linear_state: 'In Progress' },
      error: null,
    });
    const { client, fromMock } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    const result = await tickets.updateLinearState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      linearState: 'In Progress',
    });

    expect(fromMock).toHaveBeenCalledWith('tickets');
    expect(builder.__updateCalls).toEqual([{ linear_state: 'In Progress' }]);
    expect(builder.__eqCalls).toContainEqual(['id', TICKET_A]);
    expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
    expect(result.linear_state).toBe('In Progress');
  });

  it('also flips status when supplied (terminal-state transition)', async () => {
    const builder = makeBuilder({
      data: { ...baseRow, linear_state: 'Done', status: 'closed' },
      error: null,
    });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await tickets.updateLinearState({
      orgId: ORG_A,
      ticketId: TICKET_A,
      linearState: 'Done',
      status: 'closed',
    });

    expect(builder.__updateCalls).toEqual([{ linear_state: 'Done', status: 'closed' }]);
  });

  it('throws on Supabase error', async () => {
    const builder = makeBuilder({ data: null, error: new Error('connection refused') });
    const { client } = makeClient(builder);
    const tickets = makeTickets(async () => client);

    await expect(
      tickets.updateLinearState({ orgId: ORG_A, ticketId: TICKET_A, linearState: 'X' }),
    ).rejects.toThrow('connection refused');
  });
});

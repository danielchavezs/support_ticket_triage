/**
 * Phase 3.5 tool factory tests.
 *
 * Asserts:
 *   - `findSimilarTicketsForContext` and `getRecentUserTickets` bind
 *     `orgId` / `userId` from the closure; their `inputSchema` does not
 *     accept either identifier, so the agent cannot cross orgs.
 *   - The embedding for `findSimilarTicketsForContext` is generated at
 *     most once per `buildTriageTools(ctx)` invocation (memoized).
 *   - Similar-ticket hits are hydrated via `tickets.getById` and null rows
 *     are filtered out (a stale signature pointer cannot leak `null` into
 *     the model's view).
 *   - The per-org dedup window is fetched and forwarded to the RPC.
 *   - Provider errors propagate so the SDK surfaces them to the model.
 *   - `summarizeSteps` produces one audit entry per call, marks errors as
 *     `ok: false`, and never includes tool outputs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import {
  buildTriageTools,
  summarizeSteps,
  type TriageToolContext,
} from '@/services/features/triage/tools';

vi.mock('@/services/providers/ai', () => ({
  ai: {
    generateEmbedding: vi.fn(),
  },
}));

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    dedupSignatures: {
      findSimilarTickets: vi.fn(),
    },
    tickets: {
      getById: vi.fn(),
      listByUser: vi.fn(),
    },
    orgSettings: {
      getByOrg: vi.fn(),
    },
  },
}));

import { ai } from '@/services/providers/ai';
import { server as sources } from '@/services/providers/supabase/server';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const USER_1 = '00000000-0000-0000-0000-0000000000a1';
const TICKET_NEW = '00000000-0000-0000-0000-0000000000dd';

const CTX: TriageToolContext = {
  ticketId: TICKET_NEW,
  orgId: ORG_A,
  userId: USER_1,
  subject: 'Cannot log in after SSO redirect',
  description: 'After redirect the app loops back to the IdP.',
};

const generateEmbeddingMock = ai.generateEmbedding as unknown as MockedFunction<
  typeof ai.generateEmbedding
>;
const findSimilarMock = sources.dedupSignatures.findSimilarTickets as unknown as MockedFunction<
  typeof sources.dedupSignatures.findSimilarTickets
>;
const getByIdMock = sources.tickets.getById as unknown as MockedFunction<
  typeof sources.tickets.getById
>;
const listByUserMock = sources.tickets.listByUser as unknown as MockedFunction<
  typeof sources.tickets.listByUser
>;
const getByOrgMock = sources.orgSettings.getByOrg as unknown as MockedFunction<
  typeof sources.orgSettings.getByOrg
>;

type TicketRowFixture = NonNullable<Awaited<ReturnType<typeof sources.tickets.getById>>>;

const ticketRow = (
  id: string,
  overrides: Partial<{ subject: string; type: string | null; severity: string | null; status: string; userId: string }> = {},
): TicketRowFixture =>
  ({
    id,
    org_id: ORG_A,
    user_id: overrides.userId ?? USER_1,
    source_kind: 'in_app',
    subject: overrides.subject ?? 'Older ticket',
    description: 'desc',
    type: overrides.type ?? null,
    severity: overrides.severity ?? null,
    priority: null,
    confidence: null,
    customer_facing_summary: null,
    suggested_reply: null,
    status: overrides.status ?? 'received',
    triage_error: null,
    dedup_signature: null,
    duplicate_of: null,
    linear_issue_id: null,
    linear_state: null,
    description_embedding: null,
    created_at: '2026-05-15T10:00:00.000Z',
    updated_at: '2026-05-15T10:00:00.000Z',
    deleted_at: null,
  } as unknown as TicketRowFixture);

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbeddingMock.mockResolvedValue(Array.from({ length: 1536 }, () => 0));
  getByOrgMock.mockResolvedValue({
    id: 'os-1',
    org_id: ORG_A,
    dedup_window_days: 30,
    vector_dedup_enabled: true,
    created_at: '2026-05-14T00:00:00.000Z',
    updated_at: '2026-05-14T00:00:00.000Z',
    deleted_at: null,
  } as unknown as Awaited<ReturnType<typeof sources.orgSettings.getByOrg>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildTriageTools.findSimilarTicketsForContext', () => {
  it('binds orgId from context, hydrates hits, drops nulls, respects the per-org window', async () => {
    findSimilarMock.mockResolvedValue([
      { ticketId: TICKET_NEW, similarity: 1 }, // current ticket: should be filtered out
      { ticketId: 'tk-1', similarity: 0.91 },
      { ticketId: 'tk-stale', similarity: 0.85 }, // simulate a stale signature: getById returns null
      { ticketId: 'tk-2', similarity: 0.78 },
    ]);
    getByIdMock
      .mockResolvedValueOnce(ticketRow('tk-1', { subject: 'Login broken yesterday', type: 'bug', severity: 'major', status: 'triaged' }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ticketRow('tk-2', { subject: 'SSO loop after refresh', type: 'incident', severity: 'blocker', status: 'received' }));

    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected findSimilarTicketsForContext.execute');
    const output = await tool.execute(
      { limit: 3 },
      { toolCallId: 'tc-1', messages: [] } as unknown as Parameters<typeof tool.execute>[1],
    );

    // The RPC sees the context orgId and the org's window, not the dedup threshold.
    expect(findSimilarMock).toHaveBeenCalledTimes(1);
    expect(findSimilarMock.mock.calls[0][0]).toMatchObject({
      orgId: ORG_A,
      windowDays: 30,
      similarityThreshold: 0.7,
      limit: 4,
    });

    // Current ticket skipped, remaining hits hydrated, nulls dropped.
    expect(getByIdMock).not.toHaveBeenCalledWith({ orgId: ORG_A, ticketId: TICKET_NEW });
    expect(output).toEqual([
      {
        ticketId: 'tk-1',
        similarity: 0.91,
        type: 'bug',
        severity: 'major',
        status: 'triaged',
        subjectPreview: 'Login broken yesterday',
      },
      {
        ticketId: 'tk-2',
        similarity: 0.78,
        type: 'incident',
        severity: 'blocker',
        status: 'received',
        subjectPreview: 'SSO loop after refresh',
      },
    ]);
  });

  it('memoizes the embedding across multiple tool calls within one buildTriageTools(ctx) invocation', async () => {
    findSimilarMock.mockResolvedValue([]);

    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected findSimilarTicketsForContext.execute');

    await tool.execute({ limit: 3 }, { toolCallId: 'a', messages: [] } as unknown as Parameters<typeof tool.execute>[1]);
    await tool.execute({ limit: 5 }, { toolCallId: 'b', messages: [] } as unknown as Parameters<typeof tool.execute>[1]);

    // Both calls reused the same embedding promise.
    expect(generateEmbeddingMock).toHaveBeenCalledTimes(1);
    expect(generateEmbeddingMock).toHaveBeenCalledWith(`${CTX.subject}\n${CTX.description}`);
  });

  it('defaults limit to 5 when not supplied', async () => {
    findSimilarMock.mockResolvedValue([]);

    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected findSimilarTicketsForContext.execute');
    await tool.execute({}, { toolCallId: 'tc', messages: [] } as unknown as Parameters<typeof tool.execute>[1]);

    expect(findSimilarMock.mock.calls[0][0]).toMatchObject({ limit: 6 });
  });

  it('falls back to the default window when org_settings is missing', async () => {
    getByOrgMock.mockResolvedValue(null);
    findSimilarMock.mockResolvedValue([]);

    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected findSimilarTicketsForContext.execute');
    await tool.execute({}, { toolCallId: 'tc', messages: [] } as unknown as Parameters<typeof tool.execute>[1]);

    expect(findSimilarMock.mock.calls[0][0]).toMatchObject({ windowDays: 90 });
  });

  it('does NOT include orgId or userId in the tool input schema (cross-org injection is impossible by construction)', () => {
    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool) throw new Error('expected findSimilarTicketsForContext');
    // The runtime schema is a zod object — its parsed output cannot contain
    // keys it did not declare.
    const schema = tool.inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } };
    const parsed = schema.safeParse({ orgId: 'evil-org', userId: 'evil-user', limit: 2 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ limit: 2 });
  });

  it('propagates provider errors so the SDK can surface them to the model', async () => {
    findSimilarMock.mockRejectedValue(new Error('rpc down'));

    const tools = buildTriageTools(CTX);
    const tool = tools.findSimilarTicketsForContext;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected findSimilarTicketsForContext.execute');
    await expect(
      tool.execute({}, { toolCallId: 'tc', messages: [] } as unknown as Parameters<typeof tool.execute>[1]),
    ).rejects.toThrow('rpc down');
  });
});

describe('buildTriageTools.getRecentUserTickets', () => {
  it('forwards orgId + userId from the closure, returns the preview shape', async () => {
    listByUserMock.mockResolvedValue([
      ticketRow(TICKET_NEW, { subject: 'Current ticket' }),
      ticketRow('old-ticket-1', { subject: 'Old printer issue ' + 'x'.repeat(200), type: 'bug', severity: 'minor', status: 'triaged' }),
      ticketRow('old-ticket-2', { subject: 'Second old issue', type: 'question', severity: 'trivial', status: 'triaged' }),
      ticketRow('old-ticket-3', { subject: 'Third old issue', type: 'improvement', severity: 'minor', status: 'received' }),
    ]);

    const tools = buildTriageTools(CTX);
    const tool = tools.getRecentUserTickets;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected getRecentUserTickets.execute');
    const output = await tool.execute(
      { limit: 3 },
      { toolCallId: 'rt-1', messages: [] } as unknown as Parameters<typeof tool.execute>[1],
    );

    expect(listByUserMock).toHaveBeenCalledWith({ orgId: ORG_A, userId: USER_1, limit: 4 });
    expect(output).toHaveLength(3);
    expect(output).not.toContainEqual(expect.objectContaining({ ticketId: TICKET_NEW }));
    const [row] = output as Array<{ ticketId: string; createdAt: string; type: string | null; severity: string | null; status: string; subjectPreview: string }>;
    expect(row.ticketId).toBe('old-ticket-1');
    expect(row.subjectPreview.length).toBe(120);
    expect(row.subjectPreview.startsWith('Old printer issue')).toBe(true);
  });

  it('defaults limit to 5', async () => {
    listByUserMock.mockResolvedValue([]);

    const tools = buildTriageTools(CTX);
    const tool = tools.getRecentUserTickets;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected getRecentUserTickets.execute');
    await tool.execute({}, { toolCallId: 'rt', messages: [] } as unknown as Parameters<typeof tool.execute>[1]);
    expect(listByUserMock).toHaveBeenCalledWith({ orgId: ORG_A, userId: USER_1, limit: 6 });
  });

  it('does NOT include orgId or userId in the tool input schema', () => {
    const tools = buildTriageTools(CTX);
    const tool = tools.getRecentUserTickets;
    if (!tool) throw new Error('expected getRecentUserTickets');
    const schema = tool.inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } };
    const parsed = schema.safeParse({ orgId: 'evil-org', userId: 'evil-user', limit: 1 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ limit: 1 });
  });

  it('propagates provider errors', async () => {
    listByUserMock.mockRejectedValue(new Error('db down'));

    const tools = buildTriageTools(CTX);
    const tool = tools.getRecentUserTickets;
    if (!tool || typeof tool.execute !== 'function') throw new Error('expected getRecentUserTickets.execute');
    await expect(
      tool.execute({}, { toolCallId: 'rt', messages: [] } as unknown as Parameters<typeof tool.execute>[1]),
    ).rejects.toThrow('db down');
  });
});

describe('summarizeSteps', () => {
  type StepFixture = {
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    toolResults: Array<{ toolCallId: string }>;
    content: Array<{ type: string; toolCallId?: string }>;
  };

  const stepFixture = (overrides: Partial<StepFixture>): StepFixture => ({
    toolCalls: [],
    toolResults: [],
    content: [],
    ...overrides,
  });

  it('returns one audit per tool call, marks tools with matching results as ok', () => {
    const steps = [
      stepFixture({
        toolCalls: [
          { toolCallId: 'a', toolName: 'findSimilarTicketsForContext', input: { limit: 3 } },
          { toolCallId: 'b', toolName: 'getRecentUserTickets', input: {} },
        ],
        toolResults: [{ toolCallId: 'a' }, { toolCallId: 'b' }],
      }),
    ];

    const audits = summarizeSteps(steps as unknown as Parameters<typeof summarizeSteps>[0]);
    expect(audits).toEqual([
      { name: 'findSimilarTicketsForContext', input: { limit: 3 }, durationMs: 0, ok: true },
      { name: 'getRecentUserTickets', input: {}, durationMs: 0, ok: true },
    ]);
  });

  it('marks calls with a matching tool-error content part as ok=false', () => {
    const steps = [
      stepFixture({
        toolCalls: [{ toolCallId: 'a', toolName: 'findSimilarTicketsForContext', input: { limit: 5 } }],
        content: [{ type: 'tool-error', toolCallId: 'a' }],
      }),
    ];

    const audits = summarizeSteps(steps as unknown as Parameters<typeof summarizeSteps>[0]);
    expect(audits).toEqual([
      { name: 'findSimilarTicketsForContext', input: { limit: 5 }, durationMs: 0, ok: false },
    ]);
  });

  it('returns an empty array when no tool calls were made (zero-tool happy path)', () => {
    expect(summarizeSteps([] as unknown as Parameters<typeof summarizeSteps>[0])).toEqual([]);
  });
});

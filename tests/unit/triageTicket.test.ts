import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { triageTicketFeature } from '@/services/features/triage/triageTicket';
import { ai } from '@/services/providers/ai';
import { server as sources } from '@/services/providers/supabase/server';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/providers/ai', () => ({
  ai: {
    classifyTicket: vi.fn(),
    classifyTicketWithTools: vi.fn(),
  },
}));

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    tickets: {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      updateTriage: vi.fn(),
    },
    ticketEvents: {
      create: vi.fn(),
      listByTicket: vi.fn(),
    },
    orgs: { getById: vi.fn() },
    users: { getById: vi.fn(), findByEmail: vi.fn() },
  },
}));

// Stub the tool factory so triageTicket sees a deterministic `ToolSet`
// without dragging the real `buildTriageTools` (and its Provider reads)
// into these unit tests. `summarizeSteps` keeps its real implementation so
// we can assert the audit shape that lands in `ticket_events.triaged`.
vi.mock('@/services/features/triage/tools', async () => {
  const actual = await vi.importActual<typeof import('@/services/features/triage/tools')>(
    '@/services/features/triage/tools',
  );
  return {
    ...actual,
    buildTriageTools: vi.fn(() => ({} as never)),
  };
});

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const TICKET_ID = '00000000-0000-0000-0000-0000000000c1';
const USER_A = '00000000-0000-0000-0000-0000000000a1';

const classifyMock = ai.classifyTicket as unknown as MockedFunction<typeof ai.classifyTicket>;
const classifyWithToolsMock = ai.classifyTicketWithTools as unknown as MockedFunction<
  typeof ai.classifyTicketWithTools
>;
const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
const updateTriageMock = sources.tickets.updateTriage as unknown as MockedFunction<typeof sources.tickets.updateTriage>;
const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;

const successfulClassification = {
  type: 'bug' as const,
  severity: 'major' as const,
  customer_facing_summary: 'Login fails after SSO redirect.',
  suggested_reply: 'Thanks for reporting — we are looking into it.',
  confidence: 0.85,
};

function resolveTools<T>(value: T) {
  return Promise.resolve({ result: value, steps: [] as never });
}

describe('triageTicketFeature', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('zero-tool tool-loop happy path: classifies, persists, emits triaged with tool_calls = []', async () => {
    const ticket = makeTicketRow({ subject: 'Cannot SSO', description: 'Login fails after SSO redirect.' });
    getByIdMock.mockResolvedValue(ticket);
    classifyWithToolsMock.mockReturnValue(resolveTools(successfulClassification));
    const triaged = makeTicketRow({
      type: 'bug',
      severity: 'major',
      priority: 'P2',
      confidence: 0.85,
      status: 'triaged',
    });
    updateTriageMock.mockResolvedValue(triaged);

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyWithToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Cannot SSO',
        description: 'Login fails after SSO redirect.',
        schema: expect.any(Object),
        maxSteps: 4,
        timeoutMs: 15000,
        tools: expect.any(Object),
      }),
    );
    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateTriageMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      update: {
        type: 'bug',
        severity: 'major',
        priority: 'P2',
        confidence: 0.85,
        customerFacingSummary: 'Login fails after SSO redirect.',
        suggestedReply: 'Thanks for reporting — we are looking into it.',
        status: 'triaged',
        triageError: null,
      },
    });
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'triaged',
      payload: {
        type: 'bug',
        severity: 'major',
        priority: 'P2',
        confidence: 0.85,
        needs_human_triage: false,
        tool_calls: [],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(triaged);
  });

  it('one-tool happy path: records the tool call input in payload.tool_calls', async () => {
    const ticket = makeTicketRow();
    getByIdMock.mockResolvedValue(ticket);
    // A `StepResult`-shaped fixture with one tool call and a matching result.
    const steps = [
      {
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'findSimilarTicketsForContext', input: { limit: 3 } },
        ],
        toolResults: [{ toolCallId: 'call-1' }],
        content: [],
      },
    ];
    classifyWithToolsMock.mockReturnValue(
      Promise.resolve({ result: successfulClassification, steps }) as never,
    );
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged' }));

    await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'triaged',
        payload: expect.objectContaining({
          tool_calls: [
            { name: 'findSimilarTicketsForContext', input: { limit: 3 }, durationMs: 0, ok: true },
          ],
        }),
      }),
    );
  });

  it('tool-loop timeout → single-shot fallback runs, payload.fallback = single_shot, tool_calls = []', async () => {
    const ticket = makeTicketRow();
    getByIdMock.mockResolvedValue(ticket);
    classifyWithToolsMock.mockRejectedValue(new Error('Tool loop deadline exceeded'));
    classifyMock.mockResolvedValue(successfulClassification);
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyWithToolsMock).toHaveBeenCalledTimes(1);
    expect(classifyMock).toHaveBeenCalledTimes(1);
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'triaged',
        payload: expect.objectContaining({
          tool_calls: [],
          fallback: 'single_shot',
        }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it('tool-loop hard error → single-shot fallback', async () => {
    const ticket = makeTicketRow();
    getByIdMock.mockResolvedValue(ticket);
    classifyWithToolsMock.mockRejectedValue(new Error('boom'));
    classifyMock.mockResolvedValue(successfulClassification);
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('defense-in-depth Zod re-parse rejection on tool-loop result → single-shot fallback', async () => {
    const ticket = makeTicketRow();
    getByIdMock.mockResolvedValue(ticket);
    // Tool-loop returns a malformed object (missing fields).
    classifyWithToolsMock.mockReturnValue(resolveTools({ type: 'bug' } as never));
    classifyMock.mockResolvedValue(successfulClassification);
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyMock).toHaveBeenCalledTimes(1);
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'triaged',
        payload: expect.objectContaining({ fallback: 'single_shot' }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it('tool-loop + single-shot both fail → persistFailure runs with the fallback error message', async () => {
    const ticket = makeTicketRow();
    getByIdMock.mockResolvedValue(ticket);
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop boom'));
    classifyMock.mockRejectedValue(new Error('single-shot boom'));
    updateTriageMock.mockResolvedValue(
      makeTicketRow({ status: 'failed', triage_error: 'single-shot boom' }),
    );

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(updateTriageMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      update: {
        type: null,
        severity: null,
        priority: null,
        confidence: null,
        customerFacingSummary: null,
        suggestedReply: null,
        status: 'failed',
        triageError: 'single-shot boom',
      },
    });
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'failed',
      payload: { stage: 'triage', error: 'single-shot boom' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TRIAGE_FAILED');
      expect(result.error.message).toContain('single-shot boom');
    }
  });

  it('flags low-confidence results via the triaged event payload', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockReturnValue(
      resolveTools({
        type: 'question' as const,
        severity: 'minor' as const,
        customer_facing_summary: 'Quick question about pricing.',
        suggested_reply: 'Thanks — checking with the team.',
        confidence: 0.5,
      }),
    );
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged', confidence: 0.5 }));

    await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'triaged',
        payload: expect.objectContaining({ needs_human_triage: true, confidence: 0.5 }),
      }),
    );
  });

  it('single-shot fallback returning a malformed shape → persistFailure', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop boom'));
    classifyMock.mockResolvedValue({ type: 'bug', severity: 'major' } as never);
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TRIAGE_FAILED');
      expect(result.error.message).toContain('Schema validation failed');
    }
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
  });

  it('returns TICKET_NOT_FOUND with no mutations when the ticket is missing', async () => {
    getByIdMock.mockResolvedValue(null);

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyWithToolsMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateTriageMock).not.toHaveBeenCalled();
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns TICKET_FETCH_FAILED when the Provider throws on fetch', async () => {
    getByIdMock.mockRejectedValue(new Error('DB down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyWithToolsMock).not.toHaveBeenCalled();
    expect(updateTriageMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
  });

  it('treats event emission failures on the happy path as non-fatal', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockReturnValue(
      resolveTools({
        type: 'feature' as const,
        severity: 'minor' as const,
        customer_facing_summary: 'New filter request.',
        suggested_reply: 'Thanks for the suggestion.',
        confidence: 0.9,
      }),
    );
    const triaged = makeTicketRow({ status: 'triaged', priority: 'P3', confidence: 0.9 });
    updateTriageMock.mockResolvedValue(triaged);
    eventCreateMock.mockRejectedValue(new Error('events down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(triaged);
  });

  it('does not throw when the failure-state persist itself errors', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop down'));
    classifyMock.mockRejectedValue(new Error('single-shot down'));
    updateTriageMock.mockRejectedValue(new Error('DB down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
  });

  it('does not throw when the failed-event emission errors', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop down'));
    classifyMock.mockRejectedValue(new Error('single-shot down'));
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed', triage_error: 'single-shot down' }));
    eventCreateMock.mockRejectedValue(new Error('events table down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
  });

  it('handles non-Error single-shot rejection values (string) without losing the message', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop boom'));
    classifyMock.mockRejectedValue('rate-limited');
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(updateTriageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ triageError: 'rate-limited' }),
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe('rate-limited');
  });

  it('handles non-Error non-string single-shot rejection values with a generic message', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockRejectedValue(new Error('tool-loop boom'));
    classifyMock.mockRejectedValue({ code: 'wat' });
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe('Unknown error.');
  });

  it('on update-after-success failure: routes through the failure persist path', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyWithToolsMock.mockReturnValue(resolveTools(successfulClassification));
    updateTriageMock
      .mockRejectedValueOnce(new Error('DB transient'))
      .mockResolvedValueOnce(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
  });

  it('rejects an invalid orgId at the Feature boundary', async () => {
    const result = await triageTicketFeature({ orgId: 'not-a-uuid', ticketId: TICKET_ID });

    expect(getByIdMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

function makeTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: TICKET_ID,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    deleted_at: null,
    org_id: ORG_A,
    user_id: USER_A,
    source_kind: 'in_app',
    subject: 'Subject',
    description: 'Description',
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
    ...overrides,
  };
}

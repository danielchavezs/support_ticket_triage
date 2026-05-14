import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { triageTicketFeature } from '@/services/features/triage/triageTicket';
import { ai } from '@/services/providers/ai';
import { server as sources } from '@/services/providers/supabase/server';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/providers/ai', () => ({
  ai: { classifyTicket: vi.fn() },
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

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const TICKET_ID = '00000000-0000-0000-0000-0000000000c1';
const USER_A = '00000000-0000-0000-0000-0000000000a1';

const classifyMock = ai.classifyTicket as unknown as MockedFunction<typeof ai.classifyTicket>;
const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
const updateTriageMock = sources.tickets.updateTriage as unknown as MockedFunction<typeof sources.tickets.updateTriage>;
const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;

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

  it('classifies, persists, and emits triaged on the happy path', async () => {
    const ticket = makeTicketRow({ subject: 'Cannot SSO', description: 'Login fails after SSO redirect.' });
    getByIdMock.mockResolvedValue(ticket);
    classifyMock.mockResolvedValue({
      type: 'bug',
      severity: 'major',
      customer_facing_summary: 'Login fails after SSO redirect.',
      suggested_reply: 'Thanks for reporting — we are looking into it.',
      confidence: 0.85,
    });
    const triaged = makeTicketRow({
      type: 'bug',
      severity: 'major',
      priority: 'P2',
      confidence: 0.85,
      status: 'triaged',
    });
    updateTriageMock.mockResolvedValue(triaged);

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyMock).toHaveBeenCalledWith({
      subject: 'Cannot SSO',
      description: 'Login fails after SSO redirect.',
      schema: expect.any(Object),
    });
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
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(triaged);
  });

  it('flags low-confidence results via the triaged event payload', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockResolvedValue({
      type: 'question',
      severity: 'minor',
      customer_facing_summary: 'Quick question about pricing.',
      suggested_reply: 'Thanks — checking with the team.',
      confidence: 0.5,
    });
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'triaged', confidence: 0.5 }));

    await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'triaged',
        payload: expect.objectContaining({ needs_human_triage: true, confidence: 0.5 }),
      }),
    );
  });

  it('on AI Provider error: persists failure state, emits `failed`, returns TRIAGE_FAILED', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockRejectedValue(new Error('Gemini 503'));
    updateTriageMock.mockResolvedValue(
      makeTicketRow({ status: 'failed', triage_error: 'Gemini 503' }),
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
        triageError: 'Gemini 503',
      },
    });
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'failed',
      payload: { stage: 'triage', error: 'Gemini 503' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TRIAGE_FAILED');
      expect(result.error.message).toContain('Gemini 503');
    }
  });

  it('on schema validation failure: persists failure state and emits `failed`', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockResolvedValue({
      // Missing required fields; the Zod re-parse should reject.
      type: 'bug',
      severity: 'major',
    } as never);
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
    expect(updateTriageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
  });

  it('returns TICKET_NOT_FOUND with no mutations when the ticket is missing', async () => {
    getByIdMock.mockResolvedValue(null);

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateTriageMock).not.toHaveBeenCalled();
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns TICKET_FETCH_FAILED when the Provider throws on fetch', async () => {
    getByIdMock.mockRejectedValue(new Error('DB down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateTriageMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
  });

  it('treats event emission failures on the happy path as non-fatal', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockResolvedValue({
      type: 'feature',
      severity: 'minor',
      customer_facing_summary: 'New filter request.',
      suggested_reply: 'Thanks for the suggestion.',
      confidence: 0.9,
    });
    const triaged = makeTicketRow({ status: 'triaged', priority: 'P3', confidence: 0.9 });
    updateTriageMock.mockResolvedValue(triaged);
    eventCreateMock.mockRejectedValue(new Error('events down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(triaged);
  });

  it('does not throw when the failure-state persist itself errors', async () => {
    // Inner catch path: AI fails → updateTriage(failed) also fails → still
    // emit the `failed` event and return TRIAGE_FAILED.
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockRejectedValue(new Error('Gemini down'));
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
    classifyMock.mockRejectedValue(new Error('Gemini down'));
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed', triage_error: 'Gemini down' }));
    eventCreateMock.mockRejectedValue(new Error('events table down'));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
  });

  it('handles non-Error AI rejection values (string) without losing the message', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
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

  it('handles non-Error non-string AI rejection values with a generic message', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockRejectedValue({ code: 'wat' });
    updateTriageMock.mockResolvedValue(makeTicketRow({ status: 'failed' }));

    const result = await triageTicketFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe('Unknown error.');
  });

  it('on update-after-success failure: routes through the failure persist path', async () => {
    getByIdMock.mockResolvedValue(makeTicketRow());
    classifyMock.mockResolvedValue({
      type: 'bug',
      severity: 'major',
      customer_facing_summary: 'x',
      suggested_reply: 'y',
      confidence: 0.9,
    });
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

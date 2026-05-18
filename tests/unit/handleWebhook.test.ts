/**
 * handleWebhook Feature tests (Phase 5).
 *
 * Asserts:
 *   - Missing signature header returns LINEAR_WEBHOOK_SIGNATURE_INVALID.
 *   - Provider signature failure returns LINEAR_WEBHOOK_SIGNATURE_INVALID.
 *   - Bad JSON / shape returns LINEAR_WEBHOOK_PARSE_FAILED.
 *   - Duplicate deliveries short-circuit before any side effect.
 *   - Non-Issue events return `ignored`.
 *   - Issue updates without `updatedFrom.stateId` return `ignored` (no state change).
 *   - Unknown linear_issue_id returns `unknown_ticket`.
 *   - Happy path: state-only transition updates linear_state, emits
 *     status_changed, calls notifications stub.
 *   - Terminal transition (completed): also flips status='closed'.
 *   - DB lookup failure surfaces TICKET_FETCH_FAILED.
 *   - DB update failure surfaces TICKET_UPDATE_FAILED.
 *   - Event emission failure is non-fatal.
 *   - Stub failure is non-fatal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { handleWebhookFeature } from '@/services/features/linear-sync/handleWebhook';
import { LinearWebhookSignatureError } from '@/services/providers/linear/errors';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/providers/linear', () => ({
  linear: { parseWebhookPayload: vi.fn() },
}));

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    tickets: {
      findByLinearIssueId: vi.fn(),
      updateLinearState: vi.fn(),
    },
    ticketEvents: { create: vi.fn() },
    webhookDeliveries: {
      recordOrSkip: vi.fn(),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    },
  },
}));

vi.mock('@/services/features/notifications', () => ({
  sendStatusChangeStub: vi.fn(async () => undefined),
}));

import { linear } from '@/services/providers/linear';
import { server as sources } from '@/services/providers/supabase/server';
import { sendStatusChangeStub } from '@/services/features/notifications';

const parseMock = linear.parseWebhookPayload as unknown as MockedFunction<typeof linear.parseWebhookPayload>;
const findByLinearMock = sources.tickets.findByLinearIssueId as unknown as MockedFunction<
  typeof sources.tickets.findByLinearIssueId
>;
const updateLinearStateMock = sources.tickets.updateLinearState as unknown as MockedFunction<
  typeof sources.tickets.updateLinearState
>;
const recordMock = sources.webhookDeliveries.recordOrSkip as unknown as MockedFunction<
  typeof sources.webhookDeliveries.recordOrSkip
>;
const markProcessedMock = sources.webhookDeliveries.markProcessed as unknown as MockedFunction<
  typeof sources.webhookDeliveries.markProcessed
>;
const markFailedMock = sources.webhookDeliveries.markFailed as unknown as MockedFunction<
  typeof sources.webhookDeliveries.markFailed
>;
const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;
const stubMock = sendStatusChangeStub as unknown as MockedFunction<typeof sendStatusChangeStub>;

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const TICKET_A = '00000000-0000-0000-0000-0000000000c1';
const USER_A = '00000000-0000-0000-0000-0000000000a1';
const LINEAR_ISSUE = 'lin-uuid-1';

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: TICKET_A,
    org_id: ORG_A,
    user_id: USER_A,
    source_kind: 'in_app',
    subject: 'subj',
    description: 'desc',
    type: 'bug',
    severity: 'major',
    priority: 'P2',
    confidence: 0.9,
    customer_facing_summary: 'cfs',
    suggested_reply: 'reply',
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
    ...overrides,
  };
}

const stateChangePayload = {
  type: 'Issue',
  action: 'update',
  data: {
    id: LINEAR_ISSUE,
    state: { id: 'state-new', name: 'In Progress', type: 'started' },
  },
  updatedFrom: { stateId: 'state-old' },
};

const terminalPayload = {
  type: 'Issue',
  action: 'update',
  data: {
    id: LINEAR_ISSUE,
    state: { id: 'state-done', name: 'Done', type: 'completed' },
  },
  updatedFrom: { stateId: 'state-old' },
};

const rawBody = Buffer.from(JSON.stringify(stateChangePayload));
const SIG = 'sha256=abc';
const TIMESTAMP = '1700000000000';

beforeEach(() => {
  vi.clearAllMocks();
  recordMock.mockResolvedValue({
    alreadyDelivered: false,
    delivery: {
      id: 'wd-1',
      provider: 'linear',
      delivery_hash: 'h',
      received_at: new Date(0).toISOString(),
      ticket_id: null,
      org_id: null,
      event_type: 'Issue',
      processing_status: 'processing',
      processed_at: null,
      last_error: null,
    },
  });
  markProcessedMock.mockResolvedValue({
    id: 'wd-1',
    provider: 'linear',
    delivery_hash: 'h',
    received_at: new Date(0).toISOString(),
    ticket_id: null,
    org_id: null,
    event_type: 'Issue',
    processing_status: 'processed',
    processed_at: new Date(0).toISOString(),
    last_error: null,
  });
  markFailedMock.mockResolvedValue({
    id: 'wd-1',
    provider: 'linear',
    delivery_hash: 'h',
    received_at: new Date(0).toISOString(),
    ticket_id: null,
    org_id: null,
    event_type: 'Issue',
    processing_status: 'failed',
    processed_at: null,
    last_error: 'failed',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleWebhookFeature', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleWarnSpy?.mockRestore();
    consoleErrorSpy = null;
    consoleWarnSpy = null;
  });

  it('returns LINEAR_WEBHOOK_SIGNATURE_INVALID when the signature header is missing', async () => {
    const result = await handleWebhookFeature({
      rawBody,
      signatureHeader: null,
      timestampHeader: TIMESTAMP,
    });

    expect(parseMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_SIGNATURE_INVALID');
  });

  it('returns LINEAR_WEBHOOK_SIGNATURE_INVALID when the timestamp header is missing', async () => {
    const result = await handleWebhookFeature({
      rawBody,
      signatureHeader: SIG,
      timestampHeader: null,
    });

    expect(parseMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_SIGNATURE_INVALID');
  });

  it('returns LINEAR_WEBHOOK_SIGNATURE_INVALID when the Provider signals signature failure', async () => {
    parseMock.mockImplementation(() => {
      throw new LinearWebhookSignatureError('bad signature');
    });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(recordMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_SIGNATURE_INVALID');
  });

  it('returns LINEAR_WEBHOOK_PARSE_FAILED on a JSON parse error from the Provider', async () => {
    parseMock.mockImplementation(() => {
      throw new Error('Linear webhook payload JSON parse failed: Unexpected token');
    });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_PARSE_FAILED');
  });

  it('returns LINEAR_WEBHOOK_PARSE_FAILED on Zod shape mismatch', async () => {
    parseMock.mockReturnValue({ wrong: 'shape' });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(recordMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_PARSE_FAILED');
  });

  it('returns duplicate when the delivery is already recorded (idempotency)', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    recordMock.mockResolvedValue({ alreadyDelivered: true });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(findByLinearMock).not.toHaveBeenCalled();
    expect(updateLinearStateMock).not.toHaveBeenCalled();
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(stubMock).not.toHaveBeenCalled();
    expect(markProcessedMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('duplicate');
  });

  it('records the delivery before applying side effects (idempotency happens first)', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    updateLinearStateMock.mockResolvedValue(makeTicket({ linear_state: 'In Progress' }));

    await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    // The Feature computes the SHA-256 of the raw body and records it
    // before any ticket lookup or update.
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear', eventType: 'Issue' }),
    );
    const [{ deliveryHash }] = recordMock.mock.calls[0];
    expect(deliveryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns ignored when the payload is not an Issue update (e.g., Comment created)', async () => {
    parseMock.mockReturnValue({
      type: 'Comment',
      action: 'create',
      data: { id: 'c-1' },
    });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(findByLinearMock).not.toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear' }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('ignored');
  });

  it('returns ignored when an Issue update did not change state (no updatedFrom.stateId)', async () => {
    parseMock.mockReturnValue({
      type: 'Issue',
      action: 'update',
      data: { id: LINEAR_ISSUE, state: { id: 's', name: 'Backlog', type: 'unstarted' } },
      // updatedFrom omitted entirely
    });

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(findByLinearMock).not.toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('ignored');
  });

  it('returns unknown_ticket when no ticket has the matching linear_issue_id (200 to Linear)', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(null);

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(updateLinearStateMock).not.toHaveBeenCalled();
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('unknown_ticket');
  });

  it('applies a non-terminal state-only transition: updates linear_state, emits status_changed, calls stub', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    const updated = makeTicket({ linear_state: 'In Progress' });
    updateLinearStateMock.mockResolvedValue(updated);

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(updateLinearStateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_A,
      linearState: 'In Progress',
      status: undefined,
    });
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_A,
      eventType: 'status_changed',
      payload: {
        previous_linear_state_id: 'state-old',
        new_linear_state_id: 'state-new',
        new_linear_state_name: 'In Progress',
        new_linear_state_type: 'started',
        status_transitioned_to_closed: false,
      },
    });
    expect(stubMock).toHaveBeenCalledWith({
      ticket: updated,
      newLinearState: 'In Progress',
      newLinearStateType: 'started',
      internalStatusTransitionedToClosed: false,
    });
    expect(markProcessedMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear', ticketId: TICKET_A, orgId: ORG_A }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('applied');
      if (result.data.kind === 'applied') {
        expect(result.data.ticket).toEqual(updated);
        expect(result.data.transition.internalStatusTransitionedToClosed).toBe(false);
      }
    }
  });

  it('applies a terminal transition (completed): also flips internal status to closed', async () => {
    parseMock.mockReturnValue(terminalPayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    const updated = makeTicket({ linear_state: 'Done', status: 'closed' });
    updateLinearStateMock.mockResolvedValue(updated);

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(updateLinearStateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_A,
      linearState: 'Done',
      status: 'closed',
    });
    expect(eventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status_transitioned_to_closed: true }),
      }),
    );
    expect(result.success).toBe(true);
    if (result.success && result.data.kind === 'applied') {
      expect(result.data.transition.internalStatusTransitionedToClosed).toBe(true);
    }
  });

  it('also flips internal status to closed on canceled type transitions', async () => {
    parseMock.mockReturnValue({
      type: 'Issue',
      action: 'update',
      data: { id: LINEAR_ISSUE, state: { id: 'cs', name: 'Canceled', type: 'canceled' } },
      updatedFrom: { stateId: 'state-old' },
    });
    findByLinearMock.mockResolvedValue(makeTicket());
    updateLinearStateMock.mockResolvedValue(makeTicket({ linear_state: 'Canceled', status: 'closed' }));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(updateLinearStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed' }),
    );
    expect(result.success).toBe(true);
  });

  it('returns TICKET_FETCH_FAILED when the ticket lookup throws', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockRejectedValue(new Error('db down'));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(updateLinearStateMock).not.toHaveBeenCalled();
    expect(markFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear', errorMessage: 'db down' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
  });

  it('returns TICKET_UPDATE_FAILED when the state update throws', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    updateLinearStateMock.mockRejectedValue(new Error('persist down'));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(stubMock).not.toHaveBeenCalled();
    expect(markFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear', errorMessage: 'persist down' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_UPDATE_FAILED');
  });

  it('returns LINEAR_WEBHOOK_RECORD_FAILED when the idempotency record write throws (non-unique error)', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    recordMock.mockRejectedValue(new Error('connection refused'));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(findByLinearMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_WEBHOOK_RECORD_FAILED');
  });

  it('event emission failure is non-fatal — the applied outcome still returns success', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    updateLinearStateMock.mockResolvedValue(makeTicket({ linear_state: 'In Progress' }));
    eventCreateMock.mockRejectedValue(new Error('events table down'));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('applied');
    expect(stubMock).toHaveBeenCalled();
  });

  it('notification-stub failure is non-fatal', async () => {
    parseMock.mockReturnValue(stateChangePayload);
    findByLinearMock.mockResolvedValue(makeTicket());
    updateLinearStateMock.mockResolvedValue(makeTicket({ linear_state: 'In Progress' }));
    stubMock.mockRejectedValue(new Error('stub blew up'));

    const result = await handleWebhookFeature({ rawBody, signatureHeader: SIG, timestampHeader: TIMESTAMP });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('applied');
  });
});

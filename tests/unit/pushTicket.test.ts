/**
 * linear-sync Feature tests.
 *
 * Asserts:
 *   - Happy path: fetches ticket, calls Linear Provider with mapped input,
 *     persists `linear_issue_id`, emits `pushed_to_linear`.
 *   - Field mapping: subject → title, priority P1..P4 → 1..4, body includes
 *     summary + description + footer.
 *   - Idempotency: ticket with `linear_issue_id` already set is a no-op.
 *   - Skip: ticket with status ≠ 'triaged' is a no-op.
 *   - Transient failure: Linear createIssue rejection does NOT mutate the
 *     ticket row; emits `failed` event with `stage='linear_push'`.
 *   - Unique-violation on persist: refetch + treat as success.
 *   - Persist failure (non-unique): emits `failed`, returns LINEAR_PERSIST_FAILED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import {
  buildIssueInput,
  pushTicketToLinearFeature,
} from '@/services/features/linear-sync/pushTicket';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

const ENV_BACKUP = {
  LINEAR_TEAM_ID: process.env.LINEAR_TEAM_ID,
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
};

vi.mock('@/services/providers/linear', () => ({
  linear: { createIssue: vi.fn() },
}));

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    tickets: {
      getById: vi.fn(),
      updateLinearLink: vi.fn(),
    },
    ticketEvents: {
      create: vi.fn(),
    },
  },
}));

import { linear } from '@/services/providers/linear';
import { server as sources } from '@/services/providers/supabase/server';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const USER_A = '00000000-0000-0000-0000-0000000000a1';
const TICKET_ID = '00000000-0000-0000-0000-0000000000c1';
const TEAM_ID = 'team-uuid';

const createIssueMock = linear.createIssue as unknown as MockedFunction<typeof linear.createIssue>;
const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
const updateLinearLinkMock = sources.tickets.updateLinearLink as unknown as MockedFunction<
  typeof sources.tickets.updateLinearLink
>;
const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: TICKET_ID,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    deleted_at: null,
    org_id: ORG_A,
    user_id: USER_A,
    source_kind: 'in_app',
    subject: 'SSO broken',
    description: 'Redirect loops after login.',
    type: 'bug',
    severity: 'major',
    priority: 'P2',
    confidence: 0.85,
    customer_facing_summary: 'Login redirects loop.',
    suggested_reply: 'Thanks — we are investigating.',
    status: 'triaged',
    triage_error: null,
    dedup_signature: 'abc1234567890',
    duplicate_of: null,
    linear_issue_id: null,
    description_embedding: null,
    ...overrides,
  };
}

const createdLinearIssue = {
  issueId: 'lin-uuid-1',
  identifier: 'AIR-42',
  url: 'https://linear.app/airiamspace/issue/AIR-42',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINEAR_TEAM_ID = TEAM_ID;
  process.env.LINEAR_API_KEY = 'lin_api_test';
});

afterEach(() => {
  process.env.LINEAR_TEAM_ID = ENV_BACKUP.LINEAR_TEAM_ID;
  process.env.LINEAR_API_KEY = ENV_BACKUP.LINEAR_API_KEY;
});

describe('buildIssueInput', () => {
  it('maps subject -> title, priority P2 -> 2, includes summary + description + footer', () => {
    const draft = buildIssueInput(makeTicket(), TEAM_ID);
    expect(draft.teamId).toBe(TEAM_ID);
    expect(draft.title).toBe('SSO broken');
    expect(draft.priority).toBe(2);
    expect(draft.description).toContain('Login redirects loop.');
    expect(draft.description).toContain('Redirect loops after login.');
    expect(draft.description).toContain('**Type:** bug');
    expect(draft.description).toContain('**Severity:** major');
    expect(draft.description).toContain('**Confidence:** 0.85');
    expect(draft.description).toContain(`**Ticket ID:** \`${TICKET_ID}\``);
    expect(draft.description).toContain('**Suggested reply (draft, not sent):**');
    expect(draft.description).toContain('**Dedup signature:** `abc12345…`');
  });

  it('maps P1..P4 -> 1..4', () => {
    expect(buildIssueInput(makeTicket({ priority: 'P1' }), TEAM_ID).priority).toBe(1);
    expect(buildIssueInput(makeTicket({ priority: 'P2' }), TEAM_ID).priority).toBe(2);
    expect(buildIssueInput(makeTicket({ priority: 'P3' }), TEAM_ID).priority).toBe(3);
    expect(buildIssueInput(makeTicket({ priority: 'P4' }), TEAM_ID).priority).toBe(4);
  });

  it('throws when priority is null (defense-in-depth — should never reach push)', () => {
    expect(() => buildIssueInput(makeTicket({ priority: null }), TEAM_ID)).toThrow(/no priority/);
  });

  it('omits the suggested-reply block when suggested_reply is null', () => {
    const draft = buildIssueInput(makeTicket({ suggested_reply: null }), TEAM_ID);
    expect(draft.description).not.toContain('Suggested reply');
  });

  it('omits the dedup-signature footer line when dedup_signature is null', () => {
    const draft = buildIssueInput(makeTicket({ dedup_signature: null }), TEAM_ID);
    expect(draft.description).not.toContain('Dedup signature');
  });
});

describe('pushTicketToLinearFeature', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('happy path: creates Linear issue, persists linear_issue_id, emits pushed_to_linear', async () => {
    const ticket = makeTicket();
    getByIdMock.mockResolvedValue(ticket);
    createIssueMock.mockResolvedValue(createdLinearIssue);
    updateLinearLinkMock.mockResolvedValue({ ...ticket, linear_issue_id: createdLinearIssue.issueId });

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        title: 'SSO broken',
        priority: 2,
      }),
    );
    expect(updateLinearLinkMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      linearIssueId: createdLinearIssue.issueId,
    });
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'pushed_to_linear',
      payload: {
        linear_issue_id: createdLinearIssue.issueId,
        linear_identifier: createdLinearIssue.identifier,
        linear_url: createdLinearIssue.url,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('pushed');
      expect(result.data.ticket.linear_issue_id).toBe(createdLinearIssue.issueId);
    }
  });

  it('no-op when ticket already has linear_issue_id (already_linked)', async () => {
    getByIdMock.mockResolvedValue(makeTicket({ linear_issue_id: 'existing-uuid' }));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(updateLinearLinkMock).not.toHaveBeenCalled();
    expect(eventCreateMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('already_linked');
  });

  it('no-op when ticket status is not "triaged" (skipped)', async () => {
    getByIdMock.mockResolvedValue(makeTicket({ status: 'duplicate' }));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('skipped');
  });

  it('transient Linear failure: emits failed event, returns LINEAR_PUSH_FAILED, does not mutate ticket', async () => {
    getByIdMock.mockResolvedValue(makeTicket());
    createIssueMock.mockRejectedValue(new Error('rate limited'));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(updateLinearLinkMock).not.toHaveBeenCalled();
    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'failed',
      payload: { stage: 'linear_push', error: 'rate limited' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('LINEAR_PUSH_FAILED');
      expect(result.error.message).toBe('rate limited');
    }
  });

  it('unique-violation on persist: refetches and treats as already_linked', async () => {
    const ticket = makeTicket();
    getByIdMock
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({ ...ticket, linear_issue_id: 'concurrent-uuid' });
    createIssueMock.mockResolvedValue(createdLinearIssue);
    const dbError: Error & { code?: string } = new Error('duplicate key value');
    dbError.code = '23505';
    updateLinearLinkMock.mockRejectedValue(dbError);

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('already_linked');
      expect(result.data.ticket.linear_issue_id).toBe('concurrent-uuid');
    }
    // The failed event should NOT be emitted on a unique-violation success path.
    expect(eventCreateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
  });

  it('non-unique persist failure: emits failed event, returns LINEAR_PERSIST_FAILED', async () => {
    getByIdMock.mockResolvedValue(makeTicket());
    createIssueMock.mockResolvedValue(createdLinearIssue);
    updateLinearLinkMock.mockRejectedValue(new Error('connection refused'));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(eventCreateMock).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_ID,
      eventType: 'failed',
      payload: { stage: 'linear_push', error: 'connection refused' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_PERSIST_FAILED');
  });

  it('returns TICKET_NOT_FOUND when the ticket is missing', async () => {
    getByIdMock.mockResolvedValue(null);

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns TICKET_FETCH_FAILED when getById throws', async () => {
    getByIdMock.mockRejectedValue(new Error('db down'));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
  });

  it('returns LINEAR_CONFIG_MISSING when LINEAR_TEAM_ID is not set', async () => {
    delete process.env.LINEAR_TEAM_ID;
    getByIdMock.mockResolvedValue(makeTicket());

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('LINEAR_CONFIG_MISSING');
  });

  it('rejects an invalid orgId at the Feature boundary', async () => {
    const result = await pushTicketToLinearFeature({ orgId: 'not-a-uuid', ticketId: TICKET_ID });

    expect(getByIdMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('treats event emission failure on happy path as non-fatal', async () => {
    const ticket = makeTicket();
    getByIdMock.mockResolvedValue(ticket);
    createIssueMock.mockResolvedValue(createdLinearIssue);
    updateLinearLinkMock.mockResolvedValue({ ...ticket, linear_issue_id: createdLinearIssue.issueId });
    eventCreateMock.mockRejectedValue(new Error('events down'));

    const result = await pushTicketToLinearFeature({ orgId: ORG_A, ticketId: TICKET_ID });

    expect(result.success).toBe(true);
  });
});

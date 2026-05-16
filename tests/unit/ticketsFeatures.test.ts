import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import {
  createTicketFeature,
  getTicketFeature,
  listTicketsFeature,
  retryTicketTriageFeature,
} from '@/services/features/tickets/ticketsFeatures';
import { server as sources } from '@/services/providers/supabase/server';
import { triageTicketFeature } from '@/services/features/triage/triageTicket';
import { dedupTicketFeature } from '@/services/features/dedup/dedupTicket';
import { pushTicketToLinearFeature } from '@/services/features/linear-sync/pushTicket';
import type { TicketRow } from '@/services/providers/supabase/domains/tickets';

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    tickets: {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      updateTriage: vi.fn(),
      updateDedupState: vi.fn(),
    },
    ticketEvents: {
      create: vi.fn(),
      listByTicket: vi.fn(),
    },
    orgs: { getById: vi.fn() },
    users: { getById: vi.fn(), findByEmail: vi.fn() },
    orgSettings: { getByOrg: vi.fn() },
    dedupSignatures: {
      findByNormalizedSignature: vi.fn(),
      findSimilarTickets: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/services/features/triage/triageTicket', () => ({
  triageTicketFeature: vi.fn(),
}));

vi.mock('@/services/features/dedup/dedupTicket', () => ({
  dedupTicketFeature: vi.fn(),
}));

vi.mock('@/services/features/linear-sync/pushTicket', () => ({
  pushTicketToLinearFeature: vi.fn(),
}));

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const USER_A = '00000000-0000-0000-0000-0000000000a1';

describe('tickets feature', () => {
  const listMock = sources.tickets.list as unknown as MockedFunction<typeof sources.tickets.list>;
  const getByIdMock = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
  const createMock = sources.tickets.create as unknown as MockedFunction<typeof sources.tickets.create>;
  const updateDedupMock = sources.tickets.updateDedupState as unknown as MockedFunction<
    typeof sources.tickets.updateDedupState
  >;
  const eventCreateMock = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;
  const triageMock = triageTicketFeature as unknown as MockedFunction<typeof triageTicketFeature>;
  const dedupMock = dedupTicketFeature as unknown as MockedFunction<typeof dedupTicketFeature>;
  const linearPushMock = pushTicketToLinearFeature as unknown as MockedFunction<
    typeof pushTicketToLinearFeature
  >;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dedup returns `no_hit` so existing tests follow the normal
    // create → emit → dedup (no_hit) → triage path without per-test setup.
    dedupMock.mockResolvedValue({ success: true, data: { kind: 'no_hit' } });
    // Default: Linear push echoes back the triaged ticket as `pushed`. Tests
    // that care about the Linear branch (e.g. retry-after-transient-failure)
    // override per-test.
    linearPushMock.mockImplementation(async ({ ticketId }) =>
      ({
        success: true,
        data: {
          kind: 'pushed',
          ticket: makeTicketRow({
            id: ticketId,
            org_id: ORG_A,
            status: 'triaged',
            linear_issue_id: 'lin-default',
          }),
        },
      } as Awaited<ReturnType<typeof pushTicketToLinearFeature>>),
    );
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  describe('listTicketsFeature', () => {
    it('returns tickets on success and forwards orgId to the Provider', async () => {
      const mockTickets: TicketRow[] = [makeTicketRow({ id: 'aaa', org_id: ORG_A })];
      listMock.mockResolvedValue(mockTickets);

      const result = await listTicketsFeature({ orgId: ORG_A });

      expect(listMock).toHaveBeenCalledWith({ orgId: ORG_A });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(mockTickets);
    });

    it('isolates by org — listing for one org never reaches another org context', async () => {
      // Provider is the org-enforcement boundary. The Feature must pass through
      // exactly the orgId it received, never silently falling back to a default.
      listMock.mockResolvedValue([]);

      await listTicketsFeature({ orgId: ORG_B });

      expect(listMock).toHaveBeenCalledExactlyOnceWith({ orgId: ORG_B });
      expect(listMock).not.toHaveBeenCalledWith({ orgId: ORG_A });
    });

    it('rejects an invalid orgId at the Feature boundary', async () => {
      const result = await listTicketsFeature({ orgId: 'not-a-uuid' });

      expect(listMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns TICKETS_LIST_FAILED when the Provider throws', async () => {
      listMock.mockRejectedValue(new Error('DB Error'));

      const result = await listTicketsFeature({ orgId: ORG_A });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKETS_LIST_FAILED');
    });
  });

  describe('createTicketFeature', () => {
    const baseInput = {
      orgId: ORG_A,
      userId: USER_A,
      subject: 'Login issue',
      description: 'I cannot log in to my account.',
    };

    it('creates a ticket, emits received, inline-invokes triage, then inline-pushes to Linear', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A, user_id: USER_A, subject: baseInput.subject });
      const triaged = makeTicketRow({ id: '123', org_id: ORG_A, status: 'triaged', type: 'bug', priority: 'P2' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-create' });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-1',
        org_id: ORG_A,
        ticket_id: '123',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await createTicketFeature(baseInput);

      expect(createMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        userId: USER_A,
        subject: 'Login issue',
        description: 'I cannot log in to my account.',
        sourceKind: undefined,
      });
      expect(eventCreateMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        ticketId: '123',
        eventType: 'received',
      });
      expect(triageMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '123' });
      expect(linearPushMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '123' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('does not invoke Linear push when triage produces a non-triaged status', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      const failedTriage = makeTicketRow({ id: '123', org_id: ORG_A, status: 'failed', triage_error: 'boom' });
      createMock.mockResolvedValue(created);
      triageMock.mockResolvedValue({ success: true, data: failedTriage });

      const result = await createTicketFeature(baseInput);

      expect(triageMock).toHaveBeenCalled();
      expect(linearPushMock).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(failedTriage);
    });

    it('Linear push failure does not roll back ticket creation; returns the triaged row unchanged', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      const triaged = makeTicketRow({ id: '123', org_id: ORG_A, status: 'triaged', type: 'bug', priority: 'P2' });
      createMock.mockResolvedValue(created);
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({
        success: false,
        error: { code: 'LINEAR_PUSH_FAILED', message: 'rate limited' },
      });

      const result = await createTicketFeature(baseInput);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(triaged);
    });

    it('returns the persisted failed ticket when triage fails (recoverable state)', async () => {
      // Triage failures persist `status='failed'` + `triage_error` on the row.
      // The Feature returns success: the ticket exists, retry is available.
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      const failed = makeTicketRow({
        id: '123',
        org_id: ORG_A,
        status: 'failed',
        triage_error: 'Gemini 503',
      });
      createMock.mockResolvedValue(created);
      getByIdMock.mockResolvedValue(failed);
      eventCreateMock.mockResolvedValue({
        id: 'evt-1',
        org_id: ORG_A,
        ticket_id: '123',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      triageMock.mockResolvedValue({
        success: false,
        error: { code: 'TRIAGE_FAILED', message: 'Gemini 503' },
      });

      const result = await createTicketFeature(baseInput);

      expect(result.success).toBe(true);
      expect(getByIdMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '123' });
      if (result.success) expect(result.data).toEqual(failed);
    });

    it('falls back to the originally-created ticket if refetch after triage failure fails', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-1',
        org_id: ORG_A,
        ticket_id: '123',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      triageMock.mockResolvedValue({
        success: false,
        error: { code: 'TRIAGE_FAILED', message: 'Gemini 503' },
      });
      getByIdMock.mockRejectedValue(new Error('DB still down'));

      const result = await createTicketFeature(baseInput);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(created);
    });

    it.each([
      ['orgId', { orgId: 'not-a-uuid' }],
      ['userId', { userId: 'not-a-uuid' }],
      ['subject', { subject: '   ' }],
      ['description', { description: '   ' }],
    ])('returns VALIDATION_ERROR when %s is invalid', async (_field, overrides) => {
      const result = await createTicketFeature({ ...baseInput, ...overrides });

      expect(createMock).not.toHaveBeenCalled();
      expect(triageMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns TICKET_CREATE_FAILED when the Provider create throws (no triage invoked)', async () => {
      createMock.mockRejectedValue(new Error('DB Error'));

      const result = await createTicketFeature(baseInput);

      expect(eventCreateMock).not.toHaveBeenCalled();
      expect(triageMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_CREATE_FAILED');
    });

    it('treats event emission failure as non-fatal and still runs triage', async () => {
      const created = makeTicketRow({ id: '123', org_id: ORG_A });
      const triaged = makeTicketRow({ id: '123', org_id: ORG_A, status: 'triaged' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-evt' });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockRejectedValue(new Error('events table down'));
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await createTicketFeature(baseInput);

      expect(triageMock).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('forwards an explicit sourceKind when provided', async () => {
      const created = makeTicketRow({ id: '456', org_id: ORG_A });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-2',
        org_id: ORG_A,
        ticket_id: '456',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      triageMock.mockResolvedValue({ success: true, data: created });

      await createTicketFeature({ ...baseInput, sourceKind: 'aip_monitoring' });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKind: 'aip_monitoring' }),
      );
    });

    it('skips triage on deterministic dedup hit and returns the duplicate-state ticket', async () => {
      const created = makeTicketRow({ id: '789', org_id: ORG_A, user_id: USER_A });
      const duplicate = makeTicketRow({
        id: '789',
        org_id: ORG_A,
        status: 'duplicate',
        duplicate_of: '00000000-0000-0000-0000-0000000000c1',
        dedup_signature: 'sig-abc',
      });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-3',
        org_id: ORG_A,
        ticket_id: '789',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      dedupMock.mockResolvedValue({
        success: true,
        data: {
          kind: 'deterministic_hit',
          canonicalTicketId: '00000000-0000-0000-0000-0000000000c1',
        },
      });
      getByIdMock.mockResolvedValue(duplicate);

      const result = await createTicketFeature(baseInput);

      expect(dedupMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        ticketId: '789',
        subject: baseInput.subject,
        description: baseInput.description,
      });
      // Triage must NOT run on a deterministic dedup hit.
      expect(triageMock).not.toHaveBeenCalled();
      expect(getByIdMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '789' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(duplicate);
    });

    it('continues to triage on a vector dedup hit (soft-flag is event-only)', async () => {
      const created = makeTicketRow({ id: '790', org_id: ORG_A });
      const triaged = makeTicketRow({ id: '790', org_id: ORG_A, status: 'triaged', type: 'bug' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-vec' });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-4',
        org_id: ORG_A,
        ticket_id: '790',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      dedupMock.mockResolvedValue({
        success: true,
        data: {
          kind: 'vector_hit',
          candidateCanonicalTicketId: '00000000-0000-0000-0000-0000000000c2',
          similarity: 0.95,
        },
      });
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await createTicketFeature(baseInput);

      expect(triageMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '790' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('still runs triage when dedup itself fails (recoverable degradation)', async () => {
      const created = makeTicketRow({ id: '791', org_id: ORG_A });
      const triaged = makeTicketRow({ id: '791', org_id: ORG_A, status: 'triaged' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-dedup-fail' });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-5',
        org_id: ORG_A,
        ticket_id: '791',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      dedupMock.mockResolvedValue({
        success: false,
        error: { code: 'EMBEDDING_FAILED', message: 'OpenAI 503' },
      });
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await createTicketFeature(baseInput);

      expect(triageMock).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('falls back to the created row when refetch after deterministic hit fails', async () => {
      const created = makeTicketRow({ id: '792', org_id: ORG_A });
      createMock.mockResolvedValue(created);
      eventCreateMock.mockResolvedValue({
        id: 'evt-6',
        org_id: ORG_A,
        ticket_id: '792',
        event_type: 'received',
        payload: {},
        created_at: new Date(0).toISOString(),
      });
      dedupMock.mockResolvedValue({
        success: true,
        data: {
          kind: 'deterministic_hit',
          canonicalTicketId: '00000000-0000-0000-0000-0000000000c3',
        },
      });
      getByIdMock.mockRejectedValue(new Error('DB momentary outage'));

      const result = await createTicketFeature(baseInput);

      expect(triageMock).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(created);
    });
  });

  describe('getTicketFeature', () => {
    it('returns the ticket when found', async () => {
      const ticket = makeTicketRow({ id: '00000000-0000-0000-0000-0000000000c1', org_id: ORG_A });
      getByIdMock.mockResolvedValue(ticket);

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(getByIdMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(ticket);
    });

    it('returns TICKET_NOT_FOUND when the Provider returns null (including cross-org)', async () => {
      // The Provider returns null for both "really not in DB" and "exists in
      // a different org" cases. Feature treats them identically.
      getByIdMock.mockResolvedValue(null);

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('returns TICKET_FETCH_FAILED on Provider throw', async () => {
      getByIdMock.mockRejectedValue(new Error('DB Error'));

      const result = await getTicketFeature({ orgId: ORG_A, ticketId: '00000000-0000-0000-0000-0000000000c1' });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_FETCH_FAILED');
    });
  });

  describe('retryTicketTriageFeature', () => {
    const ticketId = '00000000-0000-0000-0000-0000000000c1';

    it('dispatches to triage when the ticket is in failed state; chains to Linear push on success', async () => {
      const failed = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'failed', type: null });
      const triaged = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'triaged', type: 'bug', priority: 'P2' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-1' });
      getByIdMock.mockResolvedValue(failed);
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({
        success: true,
        data: { kind: 'pushed', ticket: linked },
      });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId });
      expect(linearPushMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('dispatches to triage when type is null (received but never classified)', async () => {
      const received = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'received', type: null });
      const triaged = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'triaged', type: 'feature' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-2' });
      getByIdMock.mockResolvedValue(received);
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('triaged');
    });

    it('is a no-op for an already-triaged-and-Linear-linked ticket', async () => {
      const already = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'triaged',
        type: 'bug',
        priority: 'P2',
        linear_issue_id: 'lin-existing',
      });
      getByIdMock.mockResolvedValue(already);

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).not.toHaveBeenCalled();
      expect(linearPushMock).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(already);
    });

    it('re-runs the Linear push when status=triaged but linear_issue_id is missing (Phase 4)', async () => {
      const triagedNoLink = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'triaged',
        type: 'bug',
        priority: 'P2',
        linear_issue_id: null,
      });
      const linked = makeTicketRow({ ...triagedNoLink, linear_issue_id: 'lin-3' });
      getByIdMock.mockResolvedValue(triagedNoLink);
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).not.toHaveBeenCalled();
      expect(linearPushMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.linear_issue_id).toBe('lin-3');
    });

    it('surfaces the LINEAR_PUSH_FAILED error when the retry push itself fails', async () => {
      const triagedNoLink = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'triaged',
        type: 'bug',
        priority: 'P2',
        linear_issue_id: null,
      });
      getByIdMock.mockResolvedValue(triagedNoLink);
      linearPushMock.mockResolvedValue({
        success: false,
        error: { code: 'LINEAR_PUSH_FAILED', message: 'rate limited' },
      });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('LINEAR_PUSH_FAILED');
    });

    it('returns TICKET_NOT_FOUND when the ticket does not exist', async () => {
      getByIdMock.mockResolvedValue(null);

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('propagates triage failure to the caller', async () => {
      const failed = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'failed', type: null });
      getByIdMock.mockResolvedValue(failed);
      triageMock.mockResolvedValue({
        success: false,
        error: { code: 'TRIAGE_FAILED', message: 'Gemini 503' },
      });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('TRIAGE_FAILED');
    });

    it('no-ops when status=duplicate and canonical still exists', async () => {
      const canonicalId = '00000000-0000-0000-0000-0000000000c2';
      const duplicate = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'duplicate',
        duplicate_of: canonicalId,
        dedup_signature: 'sig-x',
      });
      const canonical = makeTicketRow({ id: canonicalId, org_id: ORG_A, status: 'triaged' });
      // The Feature fetches the ticket first, then the canonical. Both via getById.
      getByIdMock.mockImplementation(async ({ ticketId: id }) => {
        if (id === ticketId) return duplicate;
        if (id === canonicalId) return canonical;
        return null;
      });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).not.toHaveBeenCalled();
      expect(dedupMock).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(duplicate);
    });

    it('clears stale duplicate state and re-runs dedup when canonical is gone', async () => {
      const canonicalId = '00000000-0000-0000-0000-0000000000cd';
      const staleDuplicate = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'duplicate',
        duplicate_of: canonicalId,
        dedup_signature: 'sig-old',
      });
      const cleared = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'received',
        duplicate_of: null,
        dedup_signature: 'sig-old',
      });
      const triaged = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'triaged', type: 'bug' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-stale-clear' });
      getByIdMock.mockImplementation(async ({ ticketId: id }) => {
        if (id === ticketId) return staleDuplicate;
        if (id === canonicalId) return null; // canonical gone
        return null;
      });
      updateDedupMock.mockResolvedValue(cleared);
      // dedup re-run after clear: still a signature but no_hit on the canonical itself
      // (canonical_ticket_id pointed at the dead row). Treat as no_hit to fall through
      // to the triage branch — the cleared row has dedup_signature set so the signature
      // branch is skipped.
      dedupMock.mockResolvedValue({ success: true, data: { kind: 'no_hit' } });
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(updateDedupMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        ticketId,
        update: { duplicateOf: null, status: 'received' },
      });
      // Dedup signature is non-null on the cleared row, so Branch 2 (re-dedup)
      // should NOT fire — only Branch 3 (triage) and Branch 4 (Linear push) should.
      expect(dedupMock).not.toHaveBeenCalled();
      expect(triageMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId });
      expect(linearPushMock).toHaveBeenCalledWith({ orgId: ORG_A, ticketId });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('re-runs dedup when dedup_signature is missing on a received row', async () => {
      const fresh = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'received',
        dedup_signature: null,
        type: null,
      });
      const triaged = makeTicketRow({ id: ticketId, org_id: ORG_A, status: 'triaged', type: 'bug' });
      const linked = makeTicketRow({ ...triaged, linear_issue_id: 'lin-fresh' });
      getByIdMock.mockResolvedValue(fresh);
      dedupMock.mockResolvedValue({ success: true, data: { kind: 'no_hit' } });
      triageMock.mockResolvedValue({ success: true, data: triaged });
      linearPushMock.mockResolvedValue({ success: true, data: { kind: 'pushed', ticket: linked } });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(dedupMock).toHaveBeenCalledWith({
        orgId: ORG_A,
        ticketId,
        subject: fresh.subject,
        description: fresh.description,
      });
      // After no-hit dedup, triage still runs because type is null; then Linear push.
      expect(triageMock).toHaveBeenCalled();
      expect(linearPushMock).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(linked);
    });

    it('returns the duplicate row directly when retry dedup finds a deterministic hit', async () => {
      const fresh = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'received',
        dedup_signature: null,
        type: null,
      });
      const nowDuplicate = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'duplicate',
        duplicate_of: '00000000-0000-0000-0000-0000000000c1',
        dedup_signature: 'sig-new',
      });
      getByIdMock
        .mockResolvedValueOnce(fresh) // initial fetch
        .mockResolvedValueOnce(nowDuplicate); // refetch after dedup hit
      dedupMock.mockResolvedValue({
        success: true,
        data: {
          kind: 'deterministic_hit',
          canonicalTicketId: '00000000-0000-0000-0000-0000000000c1',
        },
      });

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(triageMock).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(nowDuplicate);
    });

    it('returns DEDUP_PERSIST_FAILED when the stale-duplicate clear write fails', async () => {
      const staleDuplicate = makeTicketRow({
        id: ticketId,
        org_id: ORG_A,
        status: 'duplicate',
        duplicate_of: '00000000-0000-0000-0000-0000000000ee',
        dedup_signature: 'sig-old',
      });
      getByIdMock.mockImplementation(async ({ ticketId: id }) => {
        if (id === ticketId) return staleDuplicate;
        return null;
      });
      updateDedupMock.mockRejectedValue(new Error('clear write failed'));

      const result = await retryTicketTriageFeature({ orgId: ORG_A, ticketId });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DEDUP_PERSIST_FAILED');
        expect(result.error.message).toContain('clear write failed');
      }
    });
  });
});

function makeTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
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

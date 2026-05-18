/**
 * Orchestrator tests for `dedupTicketFeature`.
 *
 * Coverage matrix:
 *   - Validation errors.
 *   - Deterministic hit  → hard link, deterministic-event emitted.
 *   - Vector hit only    → soft flag, embedding persisted, no duplicate_of.
 *   - No hit             → signature created, embedding persisted when generated.
 *   - Cross-org scoping  → org_id forwarded to every Provider/RPC call.
 *   - Window boundary    → windowDays read from org_settings overrides default.
 *   - Vector disabled    → embedding API never called; deterministic still runs.
 *   - org_settings null  → fallback defaults (90d, vector off).
 *   - Embedding failure  → returns EMBEDDING_FAILED on vector-enabled orgs.
 *
 * Both Provider and AI dependencies are module-mocked. The Feature is the
 * only piece under test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { dedupTicketFeature } from '@/services/features/dedup/dedupTicket';
import { DEFAULT_DEDUP_WINDOW_DAYS, VECTOR_SIMILARITY_THRESHOLD } from '@/services/features/dedup/config';
import { hashNormalized, normalize } from '@/services/features/dedup/signatures';

vi.mock('@/services/providers/supabase/server', () => ({
  server: {
    orgSettings: { getByOrg: vi.fn() },
    dedupSignatures: {
      findByNormalizedSignature: vi.fn(),
      findSimilarTickets: vi.fn(),
      create: vi.fn(),
    },
    tickets: {
      getById: vi.fn(),
      updateDedupState: vi.fn(),
    },
    ticketEvents: { create: vi.fn() },
  },
}));

vi.mock('@/services/providers/ai', () => ({
  ai: {
    generateEmbedding: vi.fn(),
  },
}));

import { server as sources } from '@/services/providers/supabase/server';
import { ai } from '@/services/providers/ai';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const ORG_B = '00000000-0000-0000-0000-0000000000b0';
const TICKET_NEW = '00000000-0000-0000-0000-0000000000d1';
const TICKET_CANONICAL = '00000000-0000-0000-0000-0000000000c1';

const SUBJECT = 'My printer is broken';
const DESCRIPTION = 'It just stopped working today.';

const mockedSettings = sources.orgSettings.getByOrg as unknown as MockedFunction<typeof sources.orgSettings.getByOrg>;
const mockedFindBySig = sources.dedupSignatures.findByNormalizedSignature as unknown as MockedFunction<
  typeof sources.dedupSignatures.findByNormalizedSignature
>;
const mockedFindSimilar = sources.dedupSignatures.findSimilarTickets as unknown as MockedFunction<
  typeof sources.dedupSignatures.findSimilarTickets
>;
const mockedCreateSig = sources.dedupSignatures.create as unknown as MockedFunction<
  typeof sources.dedupSignatures.create
>;
const mockedUpdateDedup = sources.tickets.updateDedupState as unknown as MockedFunction<
  typeof sources.tickets.updateDedupState
>;
const mockedGetById = sources.tickets.getById as unknown as MockedFunction<typeof sources.tickets.getById>;
const mockedEventCreate = sources.ticketEvents.create as unknown as MockedFunction<typeof sources.ticketEvents.create>;
const mockedEmbed = ai.generateEmbedding as unknown as MockedFunction<typeof ai.generateEmbedding>;

const expectedSignature = hashNormalized(normalize(SUBJECT, DESCRIPTION));

beforeEach(() => {
  vi.clearAllMocks();

  // Default: org_settings missing → fallback defaults (90d, vector off).
  mockedSettings.mockResolvedValue(null);
  mockedFindBySig.mockResolvedValue(null);
  mockedFindSimilar.mockResolvedValue([]);
  mockedCreateSig.mockResolvedValue({} as never);
  mockedUpdateDedup.mockResolvedValue({} as never);
  mockedGetById.mockResolvedValue({} as never);
  mockedEventCreate.mockResolvedValue({} as never);
  mockedEmbed.mockResolvedValue(new Array(1536).fill(0));
});

describe('dedupTicketFeature — validation', () => {
  it('rejects when orgId is not a UUID', async () => {
    const result = await dedupTicketFeature({
      orgId: 'not-a-uuid',
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects when subject is blank', async () => {
    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: '   ',
      description: DESCRIPTION,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects when description is blank', async () => {
    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('dedupTicketFeature — deterministic hit', () => {
  it('hard-links the ticket and emits the deterministic-hash event', async () => {
    mockedFindBySig.mockResolvedValue({
      id: 'sig-id',
      org_id: ORG_A,
      normalized_signature: expectedSignature,
      canonical_ticket_id: TICKET_CANONICAL,
      created_at: new Date(0).toISOString(),
    });

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('deterministic_hit');
      if (result.data.kind === 'deterministic_hit') {
        expect(result.data.canonicalTicketId).toBe(TICKET_CANONICAL);
      }
    }

    // Row updated with duplicate linkage + status='duplicate'.
    expect(mockedUpdateDedup).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      update: {
        dedupSignature: expectedSignature,
        duplicateOf: TICKET_CANONICAL,
        status: 'duplicate',
      },
    });

    // Event emitted with the right detection tag + canonical id.
    expect(mockedEventCreate).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      eventType: 'deduplicated',
      payload: {
        detection: 'deterministic_hash',
        canonical_ticket_id: TICKET_CANONICAL,
        window_days: DEFAULT_DEDUP_WINDOW_DAYS,
      },
    });

    // Vector strategy must NOT have run.
    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(mockedFindSimilar).not.toHaveBeenCalled();
    // No new signature recorded (this ticket IS a duplicate of an existing one).
    expect(mockedCreateSig).not.toHaveBeenCalled();
    expect(mockedGetById).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_CANONICAL,
    });
  });

  it('passes the org-specific window when org_settings overrides the default', async () => {
    mockedSettings.mockResolvedValue({
      id: 'settings-id',
      org_id: ORG_A,
      dedup_window_days: 30,
      vector_dedup_enabled: false,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      deleted_at: null,
    });

    await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(mockedFindBySig).toHaveBeenCalledWith({
      orgId: ORG_A,
      normalizedSignature: expectedSignature,
      windowDays: 30,
    });
  });
});

describe('dedupTicketFeature — stale deterministic signatures', () => {
  it('ignores a signature whose canonical ticket is missing and refreshes this ticket as canonical', async () => {
    mockedFindBySig.mockResolvedValue({
      id: 'sig-id',
      org_id: ORG_A,
      normalized_signature: expectedSignature,
      canonical_ticket_id: TICKET_CANONICAL,
      created_at: new Date().toISOString(),
    });
    mockedGetById.mockResolvedValue(null);

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('no_hit');
    expect(mockedCreateSig).toHaveBeenCalledWith({
      orgId: ORG_A,
      normalizedSignature: expectedSignature,
      canonicalTicketId: TICKET_NEW,
    });
    expect(mockedUpdateDedup).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      update: { dedupSignature: expectedSignature },
    });
  });

  it('does not hard-link a ticket to itself when its own signature row already exists', async () => {
    mockedFindBySig.mockResolvedValue({
      id: 'sig-id',
      org_id: ORG_A,
      normalized_signature: expectedSignature,
      canonical_ticket_id: TICKET_NEW,
      created_at: new Date().toISOString(),
    });

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('no_hit');
    expect(mockedGetById).not.toHaveBeenCalled();
    expect(mockedUpdateDedup).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      update: { dedupSignature: expectedSignature },
    });
  });
});

describe('dedupTicketFeature — vector hit', () => {
  beforeEach(() => {
    // Enable vector dedup for this org.
    mockedSettings.mockResolvedValue({
      id: 'settings-id',
      org_id: ORG_A,
      dedup_window_days: null, // → fallback 90
      vector_dedup_enabled: true,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      deleted_at: null,
    });
  });

  it('soft-flags via event only, persists embedding, leaves duplicate_of untouched', async () => {
    const embedding = new Array(1536).fill(0.5);
    mockedEmbed.mockResolvedValue(embedding);
    mockedFindSimilar.mockResolvedValue([
      { ticketId: TICKET_CANONICAL, similarity: 0.96 },
    ]);

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('vector_hit');
      if (result.data.kind === 'vector_hit') {
        expect(result.data.candidateCanonicalTicketId).toBe(TICKET_CANONICAL);
        expect(result.data.similarity).toBe(0.96);
      }
    }

    // Row updated with signature + embedding, NO duplicate_of, NO status change.
    expect(mockedUpdateDedup).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      update: {
        dedupSignature: expectedSignature,
        descriptionEmbedding: embedding,
      },
    });
    const updateArg = mockedUpdateDedup.mock.calls[0][0];
    expect('duplicateOf' in updateArg.update).toBe(false);
    expect('status' in updateArg.update).toBe(false);

    // Event emitted with vector_similarity detection.
    expect(mockedEventCreate).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      eventType: 'deduplicated',
      payload: {
        detection: 'vector_similarity',
        candidate_canonical_ticket_id: TICKET_CANONICAL,
        similarity_score: 0.96,
        window_days: DEFAULT_DEDUP_WINDOW_DAYS,
      },
    });

    // Vector strategy queried with the right threshold + window.
    expect(mockedFindSimilar).toHaveBeenCalledWith({
      orgId: ORG_A,
      queryEmbedding: embedding,
      windowDays: DEFAULT_DEDUP_WINDOW_DAYS,
      similarityThreshold: VECTOR_SIMILARITY_THRESHOLD,
      limit: expect.any(Number),
    });

    // No signature created — vector hits don't claim canonical status.
    expect(mockedCreateSig).not.toHaveBeenCalled();
  });
});

describe('dedupTicketFeature — no hit', () => {
  it('records a new canonical signature and persists embedding when vector enabled', async () => {
    mockedSettings.mockResolvedValue({
      id: 'settings-id',
      org_id: ORG_A,
      dedup_window_days: null,
      vector_dedup_enabled: true,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      deleted_at: null,
    });
    const embedding = new Array(1536).fill(0.1);
    mockedEmbed.mockResolvedValue(embedding);
    mockedFindSimilar.mockResolvedValue([]);

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('no_hit');

    expect(mockedCreateSig).toHaveBeenCalledWith({
      orgId: ORG_A,
      normalizedSignature: expectedSignature,
      canonicalTicketId: TICKET_NEW,
    });

    expect(mockedUpdateDedup).toHaveBeenCalledWith({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      update: {
        dedupSignature: expectedSignature,
        descriptionEmbedding: embedding,
      },
    });

    // No 'deduplicated' event on no_hit.
    expect(mockedEventCreate).not.toHaveBeenCalled();
  });

  it('records the canonical signature without embedding when vector is disabled', async () => {
    // Default beforeEach sets org_settings = null → vector off.
    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('no_hit');

    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(mockedFindSimilar).not.toHaveBeenCalled();
    expect(mockedCreateSig).toHaveBeenCalledWith({
      orgId: ORG_A,
      normalizedSignature: expectedSignature,
      canonicalTicketId: TICKET_NEW,
    });

    // updateDedupState called with signature only (no embedding key).
    const updateArg = mockedUpdateDedup.mock.calls[0][0];
    expect(updateArg.update).toEqual({ dedupSignature: expectedSignature });
  });
});

describe('dedupTicketFeature — cross-org isolation', () => {
  it('forwards orgId to every Provider/RPC call', async () => {
    mockedSettings.mockResolvedValue({
      id: 'settings-id',
      org_id: ORG_B,
      dedup_window_days: null,
      vector_dedup_enabled: true,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      deleted_at: null,
    });

    await dedupTicketFeature({
      orgId: ORG_B,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(mockedSettings.mock.calls[0][0]).toEqual({ orgId: ORG_B });
    expect(mockedFindBySig.mock.calls[0][0].orgId).toBe(ORG_B);
    expect(mockedFindSimilar.mock.calls[0][0].orgId).toBe(ORG_B);
    expect(mockedCreateSig.mock.calls[0][0].orgId).toBe(ORG_B);
    expect(mockedUpdateDedup.mock.calls[0][0].orgId).toBe(ORG_B);
  });
});

describe('dedupTicketFeature — error paths', () => {
  it('returns EMBEDDING_FAILED when the AI embedding call rejects on a vector-enabled org', async () => {
    mockedSettings.mockResolvedValue({
      id: 'settings-id',
      org_id: ORG_A,
      dedup_window_days: null,
      vector_dedup_enabled: true,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      deleted_at: null,
    });
    mockedEmbed.mockRejectedValue(new Error('OpenAI 503'));

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('EMBEDDING_FAILED');
      expect(result.error.message).toContain('OpenAI 503');
    }
  });

  it('returns DEDUP_LOOKUP_FAILED when the deterministic Provider rejects', async () => {
    mockedFindBySig.mockRejectedValue(new Error('db down'));

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DEDUP_LOOKUP_FAILED');
  });

  it('returns DEDUP_PERSIST_FAILED when updateDedupState rejects on a deterministic hit', async () => {
    mockedFindBySig.mockResolvedValue({
      id: 'sig-id',
      org_id: ORG_A,
      normalized_signature: expectedSignature,
      canonical_ticket_id: TICKET_CANONICAL,
      created_at: new Date(0).toISOString(),
    });
    mockedUpdateDedup.mockRejectedValue(new Error('persist down'));

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DEDUP_PERSIST_FAILED');
  });

  it('continues with defaults when org_settings fetch rejects', async () => {
    mockedSettings.mockRejectedValue(new Error('settings fetch down'));

    const result = await dedupTicketFeature({
      orgId: ORG_A,
      ticketId: TICKET_NEW,
      subject: SUBJECT,
      description: DESCRIPTION,
    });

    // Falls through to no-hit with default window, vector off (defensive fallback).
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('no_hit');
    expect(mockedFindBySig).toHaveBeenCalledWith({
      orgId: ORG_A,
      normalizedSignature: expectedSignature,
      windowDays: DEFAULT_DEDUP_WINDOW_DAYS,
    });
    expect(mockedEmbed).not.toHaveBeenCalled();
  });
});

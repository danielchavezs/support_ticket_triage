/**
 * Provider-domain tests for `webhook_deliveries.recordOrSkip` (Phase 5).
 *
 * Asserts:
 *   - Successful insert returns the persisted row with `alreadyDelivered: false`.
 *   - Postgres unique-violation (code 23505) returns `alreadyDelivered: true`
 *     without surfacing the error.
 *   - Other Supabase errors propagate raw.
 *   - The insert row carries provider, delivery_hash, and the optional
 *     ticket_id / org_id / event_type backfill fields.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeWebhookDeliveries } from '@/services/providers/supabase/domains/webhookDeliveries';
import type { Database } from '@/assets/databaseTypes';

type FluentBuilder = {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  __insertCalls: Array<Record<string, unknown>>;
  __updateCalls: Array<Record<string, unknown>>;
  __eqCalls: Array<[string, unknown]>;
};

function makeBuilder(
  finalResult: { data: unknown; error: unknown },
  options: {
    singleResult?: { data: unknown; error: unknown };
    maybeSingleResult?: { data: unknown; error: unknown };
  } = {},
): FluentBuilder {
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    __insertCalls: insertCalls,
    __updateCalls: updateCalls,
    __eqCalls: eqCalls,
  } as unknown as FluentBuilder;
  builder.insert = vi.fn((row: Record<string, unknown>) => {
    insertCalls.push(row);
    return builder;
  });
  builder.update = vi.fn((row: Record<string, unknown>) => {
    updateCalls.push(row);
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.single = vi.fn(() => Promise.resolve(options.singleResult ?? finalResult));
  builder.maybeSingle = vi.fn(() => Promise.resolve(options.maybeSingleResult ?? finalResult));
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock };
}

describe('webhook_deliveries.recordOrSkip', () => {
  const DELIVERY_HASH = 'a'.repeat(64);
  const TICKET_ID = '00000000-0000-0000-0000-0000000000c1';
  const ORG_ID = '00000000-0000-0000-0000-0000000000a0';

  it('inserts and returns alreadyDelivered=false on first delivery', async () => {
    const builder = makeBuilder({
      data: {
        id: 'wd-1',
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        received_at: new Date(0).toISOString(),
        ticket_id: TICKET_ID,
        org_id: ORG_ID,
        event_type: 'Issue',
        processing_status: 'processing',
        processed_at: null,
        last_error: null,
      },
      error: null,
    });
    const { client, fromMock } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    const result = await deliveries.recordOrSkip({
      provider: 'linear',
      deliveryHash: DELIVERY_HASH,
      ticketId: TICKET_ID,
      orgId: ORG_ID,
      eventType: 'Issue',
    });

    expect(fromMock).toHaveBeenCalledWith('webhook_deliveries');
    expect(builder.__insertCalls).toEqual([
      {
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        ticket_id: TICKET_ID,
        org_id: ORG_ID,
        event_type: 'Issue',
        processing_status: 'processing',
      },
    ]);
    expect(result.alreadyDelivered).toBe(false);
    if (!result.alreadyDelivered) {
      expect(result.delivery.delivery_hash).toBe(DELIVERY_HASH);
    }
  });

  it('returns alreadyDelivered=true on unique-violation when the existing delivery is processed', async () => {
    const existing = {
        id: 'wd-existing',
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        received_at: new Date(0).toISOString(),
        ticket_id: null,
        org_id: null,
        event_type: 'Issue',
        processing_status: 'processed',
        processed_at: new Date(0).toISOString(),
        last_error: null,
      };
    const builder = makeBuilder(
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { maybeSingleResult: { data: existing, error: null } },
    );
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    const result = await deliveries.recordOrSkip({
      provider: 'linear',
      deliveryHash: DELIVERY_HASH,
    });

    expect(result.alreadyDelivered).toBe(true);
  });

  it('returns alreadyDelivered=false on unique-violation when the existing delivery is failed/incomplete', async () => {
    const existing = {
      id: 'wd-existing',
      provider: 'linear',
      delivery_hash: DELIVERY_HASH,
      received_at: new Date(0).toISOString(),
      ticket_id: null,
      org_id: null,
      event_type: 'Issue',
      processing_status: 'failed',
      processed_at: null,
      last_error: 'db down',
    };
    const builder = makeBuilder(
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { maybeSingleResult: { data: existing, error: null } },
    );
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    const result = await deliveries.recordOrSkip({
      provider: 'linear',
      deliveryHash: DELIVERY_HASH,
    });

    expect(result.alreadyDelivered).toBe(false);
    if (!result.alreadyDelivered) expect(result.delivery).toEqual(existing);
  });

  it('defaults optional backfill fields to null when omitted', async () => {
    const builder = makeBuilder({
      data: {
        id: 'wd-2',
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        received_at: new Date(0).toISOString(),
        ticket_id: null,
        org_id: null,
        event_type: null,
        processing_status: 'processing',
        processed_at: null,
        last_error: null,
      },
      error: null,
    });
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    await deliveries.recordOrSkip({ provider: 'linear', deliveryHash: DELIVERY_HASH });

    expect(builder.__insertCalls[0]).toEqual({
      provider: 'linear',
      delivery_hash: DELIVERY_HASH,
      ticket_id: null,
      org_id: null,
      event_type: null,
      processing_status: 'processing',
    });
  });

  it('marks a delivery processed and backfills ticket/org ids', async () => {
    const builder = makeBuilder({
      data: {
        id: 'wd-1',
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        received_at: new Date(0).toISOString(),
        ticket_id: TICKET_ID,
        org_id: ORG_ID,
        event_type: 'Issue',
        processing_status: 'processed',
        processed_at: new Date(0).toISOString(),
        last_error: null,
      },
      error: null,
    });
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    await deliveries.markProcessed({
      provider: 'linear',
      deliveryHash: DELIVERY_HASH,
      ticketId: TICKET_ID,
      orgId: ORG_ID,
    });

    expect(builder.__updateCalls[0]).toMatchObject({
      processing_status: 'processed',
      last_error: null,
      ticket_id: TICKET_ID,
      org_id: ORG_ID,
    });
    expect(builder.__eqCalls).toContainEqual(['provider', 'linear']);
    expect(builder.__eqCalls).toContainEqual(['delivery_hash', DELIVERY_HASH]);
  });

  it('marks a delivery failed so a later retry can reprocess it', async () => {
    const builder = makeBuilder({
      data: {
        id: 'wd-1',
        provider: 'linear',
        delivery_hash: DELIVERY_HASH,
        received_at: new Date(0).toISOString(),
        ticket_id: null,
        org_id: null,
        event_type: 'Issue',
        processing_status: 'failed',
        processed_at: null,
        last_error: 'persist down',
      },
      error: null,
    });
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    await deliveries.markFailed({
      provider: 'linear',
      deliveryHash: DELIVERY_HASH,
      errorMessage: 'persist down',
    });

    expect(builder.__updateCalls[0]).toEqual({
      processing_status: 'failed',
      processed_at: null,
      last_error: 'persist down',
    });
  });

  it('propagates non-unique Supabase errors raw', async () => {
    const builder = makeBuilder({
      data: null,
      error: { code: '23503', message: 'foreign key violation' },
    });
    const { client } = makeClient(builder);
    const deliveries = makeWebhookDeliveries(async () => client);

    await expect(
      deliveries.recordOrSkip({ provider: 'linear', deliveryHash: DELIVERY_HASH }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

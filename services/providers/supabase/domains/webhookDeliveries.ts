/**
 * `webhook_deliveries` domain — inbound idempotency log for Phase 5+
 * webhooks.
 *
 * The Feature uses `recordOrSkip` to register a delivery before doing any
 * side-effect work. The unique constraint on `(provider, delivery_hash)` is
 * the source of truth, but a repeated hash is only considered processed when
 * its row has `processing_status='processed'`. Failed/incomplete deliveries
 * remain retryable so a transient DB error after the initial record cannot
 * permanently swallow a Linear retry.
 *
 * The table is NOT org-scoped — some webhook deliveries (signature failures,
 * unknown-ticket cases) happen before we can resolve an org. The Feature
 * may backfill `ticket_id` and `org_id` after the fact via a separate
 * update call; v1 doesn't need that path yet, but the columns exist.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/assets/databaseTypes';

export type WebhookDeliveryRow = Tables<'webhook_deliveries'>;
export type NewWebhookDeliveryRow = TablesInsert<'webhook_deliveries'>;

export type WebhookDeliveriesSource = ReturnType<typeof makeWebhookDeliveries>;

export type RecordOrSkipResult =
  | { alreadyDelivered: false; delivery: WebhookDeliveryRow }
  | { alreadyDelivered: true };

export type RecordOrSkipInput = {
  provider: string;
  deliveryHash: string;
  ticketId?: string | null;
  orgId?: string | null;
  eventType?: string | null;
};

export type CompleteDeliveryInput = {
  provider: string;
  deliveryHash: string;
  ticketId?: string | null;
  orgId?: string | null;
  errorMessage?: string | null;
};

export function makeWebhookDeliveries(
  getSupabaseClient: () => Promise<SupabaseClient<Database>>,
) {
  return {
    /**
     * Idempotently record a webhook delivery. Returns `alreadyDelivered: true`
     * only when the `(provider, delivery_hash)` pair already exists and was
     * previously marked `processed`. Existing failed/incomplete rows are
     * retryable and return `alreadyDelivered: false`.
     *
     * All other Postgres errors propagate raw; the Feature layer normalizes
     * them.
     */
    async recordOrSkip(input: RecordOrSkipInput): Promise<RecordOrSkipResult> {
      const supabase = await getSupabaseClient();
      const insertRow: NewWebhookDeliveryRow = {
        provider: input.provider,
        delivery_hash: input.deliveryHash,
        ticket_id: input.ticketId ?? null,
        org_id: input.orgId ?? null,
        event_type: input.eventType ?? null,
        processing_status: 'processing',
      };
      const { data, error } = await supabase
        .from('webhook_deliveries')
        .insert(insertRow)
        .select('*')
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          const existing = await findByProviderAndHash(supabase, input.provider, input.deliveryHash);
          if (!existing) {
            throw new Error('webhook_deliveries unique violation but existing row was not found.');
          }
          if (existing?.processing_status === 'processed') {
            return { alreadyDelivered: true };
          }
          return { alreadyDelivered: false, delivery: existing };
        }
        throw error;
      }
      return { alreadyDelivered: false, delivery: data as WebhookDeliveryRow };
    },

    async markProcessed(input: CompleteDeliveryInput): Promise<WebhookDeliveryRow> {
      const supabase = await getSupabaseClient();
      const patch: TablesUpdate<'webhook_deliveries'> = {
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
        last_error: null,
      };
      if (input.ticketId !== undefined) patch.ticket_id = input.ticketId;
      if (input.orgId !== undefined) patch.org_id = input.orgId;

      const { data, error } = await supabase
        .from('webhook_deliveries')
        .update(patch)
        .eq('provider', input.provider)
        .eq('delivery_hash', input.deliveryHash)
        .select('*')
        .single();

      if (error) throw error;
      return data as WebhookDeliveryRow;
    },

    async markFailed(input: CompleteDeliveryInput): Promise<WebhookDeliveryRow> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('webhook_deliveries')
        .update({
          processing_status: 'failed',
          processed_at: null,
          last_error: input.errorMessage ?? null,
        } satisfies TablesUpdate<'webhook_deliveries'>)
        .eq('provider', input.provider)
        .eq('delivery_hash', input.deliveryHash)
        .select('*')
        .single();

      if (error) throw error;
      return data as WebhookDeliveryRow;
    },
  };
}

async function findByProviderAndHash(
  supabase: SupabaseClient<Database>,
  provider: string,
  deliveryHash: string,
): Promise<WebhookDeliveryRow | null> {
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('*')
    .eq('provider', provider)
    .eq('delivery_hash', deliveryHash)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as WebhookDeliveryRow | null;
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code === '23505';
  }
  return false;
}

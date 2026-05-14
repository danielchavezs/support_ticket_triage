/**
 * `ticket_events` domain — Supabase Provider adapter for the append-only
 * ticket event log.
 *
 * The table is append-only by design; this Provider only exposes `create`
 * and `listByTicket`. There is no `update` or `delete` method by intent —
 * if a future workflow needs to mutate events (e.g., GDPR erasure) it should
 * be a deliberate, scoped addition.
 *
 * Org consistency is enforced at the DB level via the composite FK on
 * `(ticket_id, org_id) → tickets(id, org_id)`. An attempt to insert an
 * event referencing a ticket from a different org will be rejected by
 * Postgres before reaching application code.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables, TablesInsert } from '@/assets/databaseTypes';

export type TicketEventRow = Tables<'ticket_events'>;
export type NewTicketEventRow = TablesInsert<'ticket_events'>;
export type TicketEventType = Database['public']['Enums']['ticket_event_type'];

export type TicketEventsSource = ReturnType<typeof makeTicketEvents>;

export type CreateTicketEventInput = {
  orgId: string;
  ticketId: string;
  eventType: TicketEventType;
  payload?: Json;
};

export function makeTicketEvents(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    async create(input: CreateTicketEventInput): Promise<TicketEventRow> {
      const supabase = await getSupabaseClient();
      const insertRow: NewTicketEventRow = {
        org_id: input.orgId,
        ticket_id: input.ticketId,
        event_type: input.eventType,
        payload: input.payload ?? {},
      };
      const { data, error } = await supabase
        .from('ticket_events')
        .insert(insertRow)
        .select('*')
        .single();

      if (error) throw error;
      return data as TicketEventRow;
    },

    /**
     * List events for a ticket in chronological order. Filters by `org_id`
     * to keep the read explicitly scoped even though the FK guarantees
     * org consistency at the data layer.
     */
    async listByTicket({ orgId, ticketId }: { orgId: string; ticketId: string }): Promise<TicketEventRow[]> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('ticket_events')
        .select('*')
        .eq('org_id', orgId)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as TicketEventRow[];
    },
  };
}

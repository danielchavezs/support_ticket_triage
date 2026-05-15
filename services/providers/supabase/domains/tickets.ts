/**
 * `tickets` domain — Supabase Provider adapter for the `tickets` table.
 *
 * Org-scoping invariant: every method requires `orgId` (and, for inserts,
 * `userId`) as an explicit parameter, and the value is applied as an equality
 * predicate in the underlying query.
 *
 * Why this matters in v1: the Provider runs behind the Supabase service-role
 * client, which BYPASSES Row Level Security. RLS policies on `tickets` exist
 * as defense-in-depth for any future user-JWT path, but they do not protect
 * service-role reads/writes. The only safeguard against cross-org leakage on
 * the service-role path is the explicit `org_id` predicate in every method
 * below. Code review checklist item: any new query in this file must show an
 * `org_id` filter — no exceptions.
 *
 * Triage fields (`type`, `severity`, `priority`, `confidence`,
 * `customer_facing_summary`, `suggested_reply`) are filled in Phase 2 via
 * `updateTriage`. Phase 1 inserts persist them as null and the ticket lands
 * with `status='received'`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/assets/databaseTypes';
import { serializeEmbedding } from '@/services/providers/supabase/vectorEncoding';

export type TicketRow = Tables<'tickets'>;
export type NewTicketRow = TablesInsert<'tickets'>;

export type TicketType = Database['public']['Enums']['ticket_type'];
export type TicketSeverity = Database['public']['Enums']['ticket_severity'];
export type TicketPriority = Database['public']['Enums']['ticket_priority'];
export type TicketStatus = Database['public']['Enums']['ticket_status'];
export type TicketSourceKind = Database['public']['Enums']['ticket_source_kind'];

export type TicketsSource = ReturnType<typeof makeTickets>;

/**
 * Partial update for Phase 3 dedup-state fields. Only keys present on the
 * object are written to the row — missing keys leave the column untouched.
 * Pass `null` explicitly to clear a column (e.g., clearing a stale
 * `duplicate_of` link during retry).
 */
export type TicketDedupUpdate = {
  dedupSignature?: string | null;
  descriptionEmbedding?: number[] | null;
  duplicateOf?: string | null;
  status?: TicketStatus;
};

export type CreateTicketInput = {
  orgId: string;
  userId: string;
  subject: string;
  description: string;
  sourceKind?: TicketSourceKind;
};

export type TicketTriageUpdate = {
  // On the success path these are non-null; on the failure path they are
  // cleared to null alongside `status='failed'` and a populated `triageError`.
  // The DB columns are nullable to support both states.
  type: TicketType | null;
  severity: TicketSeverity | null;
  priority: TicketPriority | null;
  confidence: number | null;
  customerFacingSummary: string | null;
  suggestedReply: string | null;
  status: TicketStatus;
  triageError: string | null;
};

export function makeTickets(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    /**
     * List non-deleted tickets for an org, newest first.
     */
    async list({ orgId }: { orgId: string }): Promise<TicketRow[]> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },

    /**
     * Fetch a single ticket by id, scoped to its org. Returns null when the
     * ticket does not exist OR exists in a different org.
     */
    async getById({ orgId, ticketId }: { orgId: string; ticketId: string }): Promise<TicketRow | null> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as TicketRow | null;
    },

    /**
     * Insert a new ticket. Triage fields are left null; Phase 2 backfills via
     * `updateTriage`. The composite FK on `(user_id, org_id)` rejects the
     * insert at the DB layer if the user does not belong to the org.
     */
    async create(input: CreateTicketInput): Promise<TicketRow> {
      const supabase = await getSupabaseClient();
      const insertRow: NewTicketRow = {
        org_id: input.orgId,
        user_id: input.userId,
        subject: input.subject,
        description: input.description,
        source_kind: input.sourceKind ?? 'in_app',
      };
      const { data, error } = await supabase
        .from('tickets')
        .insert(insertRow)
        .select('*')
        .single();

      if (error) throw error;
      return data as TicketRow;
    },

    /**
     * Apply triage results to a ticket. Phase 2 wires this; Phase 1 leaves
     * triage fields null after insert.
     */
    async updateTriage({
      orgId,
      ticketId,
      update,
    }: {
      orgId: string;
      ticketId: string;
      update: TicketTriageUpdate;
    }): Promise<TicketRow> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tickets')
        .update({
          type: update.type,
          severity: update.severity,
          priority: update.priority,
          confidence: update.confidence,
          customer_facing_summary: update.customerFacingSummary,
          suggested_reply: update.suggestedReply,
          status: update.status,
          triage_error: update.triageError,
        })
        .eq('id', ticketId)
        .eq('org_id', orgId)
        .select('*')
        .single();

      if (error) throw error;
      return data as TicketRow;
    },

    /**
     * Apply Phase 3 dedup-state fields to a ticket. Partial: only fields
     * present on `update` are written. `descriptionEmbedding` is accepted as
     * a `number[]` and serialized to the pgvector text format inside this
     * method so callers never deal with the wire format.
     *
     * Ordering caveat: dedup state and triage state can both reach the same
     * row, but never concurrently in the happy path — `createTicketFeature`
     * runs dedup strictly before triage, and the retry dispatcher serializes
     * the two paths.
     */
    async updateDedupState({
      orgId,
      ticketId,
      update,
    }: {
      orgId: string;
      ticketId: string;
      update: TicketDedupUpdate;
    }): Promise<TicketRow> {
      const supabase = await getSupabaseClient();

      const patch: TablesUpdate<'tickets'> = {};
      if ('dedupSignature' in update) {
        patch.dedup_signature = update.dedupSignature ?? null;
      }
      if ('descriptionEmbedding' in update) {
        patch.description_embedding =
          update.descriptionEmbedding == null
            ? null
            : serializeEmbedding(update.descriptionEmbedding);
      }
      if ('duplicateOf' in update) {
        patch.duplicate_of = update.duplicateOf ?? null;
      }
      if (update.status !== undefined) {
        patch.status = update.status;
      }

      const { data, error } = await supabase
        .from('tickets')
        .update(patch)
        .eq('id', ticketId)
        .eq('org_id', orgId)
        .select('*')
        .single();

      if (error) throw error;
      return data as TicketRow;
    },
  };
}

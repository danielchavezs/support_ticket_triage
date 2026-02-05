import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/assets/databaseTypes';

export type TicketPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TicketCategory = 'Billing' | 'Technical' | 'Account' | 'General';
export type TicketTriageStatus = 'succeeded' | 'failed';

export type TicketRow = Tables<'tickets'>;
export type NewTicketRow = TablesInsert<'tickets'>;

export type TicketsSource = ReturnType<typeof makeTickets>;

export function makeTickets(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    async list(): Promise<TicketRow[]> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },

    async create(input: NewTicketRow): Promise<TicketRow> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tickets')
        .insert(input)
        .select('*')
        .single();

      if (error) throw error;
      return data as TicketRow;
    },
  };
}

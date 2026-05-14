/**
 * `users` domain — Supabase Provider adapter for the `users` table.
 *
 * Every read is org-scoped. `findByEmail` performs an exact case-insensitive
 * comparison in the Provider so caller-supplied LIKE wildcards never broaden
 * the lookup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/assets/databaseTypes';

export type UserRow = Tables<'users'>;
export type UsersSource = ReturnType<typeof makeUsers>;

export function makeUsers(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    /**
     * Fetch a user by id within an org. Returns null when the user does not
     * exist OR exists in a different org OR has been soft-deleted.
     */
    async getById({ orgId, userId }: { orgId: string; userId: string }): Promise<UserRow | null> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as UserRow | null;
    },

    /**
     * Find a user by email within an org. Case-insensitive exact match.
     * Returns null when no match exists in this org.
     */
    async findByEmail({ orgId, email }: { orgId: string; email: string }): Promise<UserRow | null> {
      const supabase = await getSupabaseClient();
      const normalizedEmail = email.trim().toLowerCase();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('org_id', orgId)
        .ilike('email', escapeLikePattern(normalizedEmail))
        .is('deleted_at', null)
        .limit(10);

      if (error) throw error;
      const exactMatch = (data ?? []).find((row) => row.email.toLowerCase() === normalizedEmail);
      return (exactMatch ?? null) as UserRow | null;
    },
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

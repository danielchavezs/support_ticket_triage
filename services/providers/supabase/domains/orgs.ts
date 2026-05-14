/**
 * `orgs` domain — Supabase Provider adapter for the `orgs` table.
 *
 * Org provisioning is not application-managed in v1; rows are seeded manually
 * (see `migrations/dev/2026-05-13_seed_dev_default.sql`). The Provider only
 * exposes reads; writes are intentionally absent until programmatic org
 * management is justified.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/assets/databaseTypes';

export type OrgRow = Tables<'orgs'>;
export type OrgsSource = ReturnType<typeof makeOrgs>;

export function makeOrgs(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    /**
     * Fetch an org by id. Returns null when the org does not exist OR has
     * been soft-deleted.
     */
    async getById(orgId: string): Promise<OrgRow | null> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('orgs')
        .select('*')
        .eq('id', orgId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as OrgRow | null;
    },
  };
}

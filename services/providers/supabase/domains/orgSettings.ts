/**
 * `org_settings` domain — Supabase Provider adapter for the per-org dedup
 * configuration table introduced in Phase 3 (BL-005, BL-006).
 *
 * Read-only surface in v1: settings are managed via the dev seed
 * (`migrations/dev/2026-05-14_seed_org_settings.sql`) and, later, an admin
 * tooling path. There is no `upsert` here on purpose — Feature-layer code
 * has no business writing settings during the dedup hot path.
 *
 * Org-scoping invariant: `getByOrg` always filters by `org_id`. The table
 * has a UNIQUE constraint on `org_id` so at most one row is ever returned.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/assets/databaseTypes';

export type OrgSettingsRow = Tables<'org_settings'>;
export type OrgSettingsSource = ReturnType<typeof makeOrgSettings>;

export function makeOrgSettings(getSupabaseClient: () => Promise<SupabaseClient<Database>>) {
  return {
    /**
     * Fetch the settings row for an org. Returns null when no row exists
     * (settings have never been set) OR the row has been soft-deleted; in
     * either case the Feature layer should fall back to system defaults.
     */
    async getByOrg({ orgId }: { orgId: string }): Promise<OrgSettingsRow | null> {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('org_settings')
        .select('*')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as OrgSettingsRow | null;
    },
  };
}

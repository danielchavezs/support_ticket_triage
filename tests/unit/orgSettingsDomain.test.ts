/**
 * Provider-domain tests for `org_settings`.
 *
 * Org scoping is the load-bearing invariant: `getByOrg` MUST filter by
 * `org_id`. These tests fail the moment that predicate is dropped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeOrgSettings, type OrgSettingsRow } from '@/services/providers/supabase/domains/orgSettings';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';

type FluentBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  __eqCalls: Array<[string, unknown]>;
  __isCalls: Array<[string, unknown]>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const eqCalls: Array<[string, unknown]> = [];
  const isCalls: Array<[string, unknown]> = [];
  const builder = {
    __eqCalls: eqCalls,
    __isCalls: isCalls,
  } as unknown as FluentBuilder;

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.is = vi.fn((column: string, value: unknown) => {
    isCalls.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock };
}

const baseRow: OrgSettingsRow = {
  id: '11111111-1111-1111-1111-111111111111',
  org_id: ORG_A,
  dedup_window_days: null,
  vector_dedup_enabled: true,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

describe('orgSettings domain', () => {
  describe('getByOrg', () => {
    let builder: FluentBuilder;
    let fromMock: ReturnType<typeof vi.fn>;
    let orgSettings: ReturnType<typeof makeOrgSettings>;

    beforeEach(() => {
      builder = makeBuilder({ data: baseRow, error: null });
      const c = makeClient(builder);
      fromMock = c.fromMock;
      orgSettings = makeOrgSettings(async () => c.client);
    });

    it('applies the org_id predicate and filters soft-deleted rows', async () => {
      const result = await orgSettings.getByOrg({ orgId: ORG_A });

      expect(fromMock).toHaveBeenCalledWith('org_settings');
      expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
      expect(builder.__isCalls).toContainEqual(['deleted_at', null]);
      expect(result).toEqual(baseRow);
    });

    it('returns null when no settings row exists for the org', async () => {
      builder = makeBuilder({ data: null, error: null });
      const c = makeClient(builder);
      orgSettings = makeOrgSettings(async () => c.client);

      const result = await orgSettings.getByOrg({ orgId: ORG_A });
      expect(result).toBeNull();
    });

    it('throws on Supabase error', async () => {
      builder = makeBuilder({ data: null, error: new Error('db down') });
      const c = makeClient(builder);
      orgSettings = makeOrgSettings(async () => c.client);

      await expect(orgSettings.getByOrg({ orgId: ORG_A })).rejects.toThrow('db down');
    });
  });
});

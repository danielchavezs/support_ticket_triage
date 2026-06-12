/**
 * Provider-domain tests for `orgs` and `users`.
 *
 * The org-scoping invariant is the load-bearing property here: every
 * service-role read MUST apply an `org_id` (or for `orgs`, `id`) predicate
 * to the underlying query. These tests fail if any future refactor drops
 * that predicate, even when the Supabase mock returns plausible rows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { makeOrgs, type OrgRow } from '@/services/providers/supabase/domains/orgs';
import { makeUsers, type UserRow } from '@/services/providers/supabase/domains/users';
import type { Database } from '@/assets/databaseTypes';

const ORG_A = '00000000-0000-0000-0000-0000000000a0';
const ORG_B = '00000000-0000-0000-0000-0000000000b0';
const USER_A = '00000000-0000-0000-0000-0000000000a1';

type FluentBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
  __eqCalls: Array<[string, unknown]>;
  __isCalls: Array<[string, unknown]>;
  __ilikeCalls: Array<[string, unknown]>;
};

function makeBuilder(finalResult: { data: unknown; error: unknown }): FluentBuilder {
  const eqCalls: Array<[string, unknown]> = [];
  const isCalls: Array<[string, unknown]> = [];
  const ilikeCalls: Array<[string, unknown]> = [];
  const builder = {
    __eqCalls: eqCalls,
    __isCalls: isCalls,
    __ilikeCalls: ilikeCalls,
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
  builder.ilike = vi.fn((column: string, value: unknown) => {
    ilikeCalls.push([column, value]);
    return builder;
  });
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  // Thenable for chains that end with `.limit()` and are awaited directly
  // (e.g., users.findByEmail).
  builder.then = (resolve, reject) => Promise.resolve(finalResult).then(resolve, reject);
  return builder;
}

function makeClient(builder: FluentBuilder) {
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, fromMock };
}

const baseOrgRow: OrgRow = {
  id: ORG_A,
  name: 'ATD-internal',
  status: 'active',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

const baseUserRow: UserRow = {
  id: USER_A,
  org_id: ORG_A,
  email: 'dev@airiam.local',
  display_name: 'ATD Dev User',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  deleted_at: null,
};

describe('orgs domain', () => {
  let builder: FluentBuilder;
  let fromMock: ReturnType<typeof vi.fn>;
  let orgs: ReturnType<typeof makeOrgs>;

  beforeEach(() => {
    builder = makeBuilder({ data: baseOrgRow, error: null });
    const c = makeClient(builder);
    fromMock = c.fromMock;
    orgs = makeOrgs(async () => c.client);
  });

  describe('getById', () => {
    it('queries the orgs table scoped to the supplied id', async () => {
      const result = await orgs.getById(ORG_A);

      expect(fromMock).toHaveBeenCalledWith('orgs');
      // The org-scoping invariant for the `orgs` table is keyed on `id`,
      // not `org_id` (the table has no such column).
      expect(builder.__eqCalls).toContainEqual(['id', ORG_A]);
      expect(builder.__isCalls).toContainEqual(['deleted_at', null]);
      expect(result).toEqual(baseOrgRow);
    });

    it('returns null when the row does not exist', async () => {
      builder = makeBuilder({ data: null, error: null });
      const c = makeClient(builder);
      orgs = makeOrgs(async () => c.client);

      const result = await orgs.getById(ORG_A);
      expect(result).toBeNull();
    });

    it('throws on Supabase error', async () => {
      builder = makeBuilder({ data: null, error: new Error('db down') });
      const c = makeClient(builder);
      orgs = makeOrgs(async () => c.client);

      await expect(orgs.getById(ORG_A)).rejects.toThrow('db down');
    });
  });
});

describe('users domain', () => {
  describe('getById', () => {
    it('applies BOTH the id and org_id predicates', async () => {
      // Without the org_id predicate, a user-id lookup could leak rows from
      // a different org. This test fails the moment that predicate is removed.
      const builder = makeBuilder({ data: baseUserRow, error: null });
      const { client, fromMock } = makeClient(builder);
      const users = makeUsers(async () => client);

      const result = await users.getById({ orgId: ORG_A, userId: USER_A });

      expect(fromMock).toHaveBeenCalledWith('users');
      expect(builder.__eqCalls).toContainEqual(['id', USER_A]);
      expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
      expect(builder.__isCalls).toContainEqual(['deleted_at', null]);
      expect(result).toEqual(baseUserRow);
    });

    it('returns null when no matching user exists in this org', async () => {
      const builder = makeBuilder({ data: null, error: null });
      const { client } = makeClient(builder);
      const users = makeUsers(async () => client);

      const result = await users.getById({ orgId: ORG_B, userId: USER_A });
      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('applies the org_id predicate and an escaped ilike pattern', async () => {
      const builder = makeBuilder({ data: [baseUserRow], error: null });
      const { client } = makeClient(builder);
      const users = makeUsers(async () => client);

      const result = await users.findByEmail({ orgId: ORG_A, email: 'Dev@Airiam.Local' });

      // org-scoping: required predicate
      expect(builder.__eqCalls).toContainEqual(['org_id', ORG_A]);
      // Email is normalized to lowercase before being sent to ilike.
      expect(builder.__ilikeCalls).toContainEqual(['email', 'dev@airiam.local']);
      // Exact case-insensitive match returns the canonical row.
      expect(result).toEqual(baseUserRow);
    });

    it('escapes %, _, and \\ in the email before passing to ilike', async () => {
      // The Provider must never let caller-supplied input act as a LIKE
      // wildcard — otherwise a single lookup could fan out to many rows.
      const builder = makeBuilder({ data: [], error: null });
      const { client } = makeClient(builder);
      const users = makeUsers(async () => client);

      await users.findByEmail({ orgId: ORG_A, email: 'evil_user%@example.com' });

      const [, pattern] = builder.__ilikeCalls[0] ?? [];
      expect(pattern).toBe('evil\\_user\\%@example.com');
    });

    it('returns null when no exact case-folded match exists', async () => {
      // Even if the ilike pre-filter returns rows, the final exact-match
      // check rejects any case where the email does not equal the input
      // after normalization.
      const builder = makeBuilder({
        data: [{ ...baseUserRow, email: 'someone.else@example.com' }],
        error: null,
      });
      const { client } = makeClient(builder);
      const users = makeUsers(async () => client);

      const result = await users.findByEmail({ orgId: ORG_A, email: 'dev@airiam.local' });
      expect(result).toBeNull();
    });
  });
});

-- Migration: 04 — Create `users` table
-- Phase:     1 (Org/User Schema, Enums, RLS)
-- Created:   2026-05-13
--
-- Purpose:
--   Users that calling apps assert when submitting tickets. Always scoped to
--   an `org_id`; cross-org user reuse is not supported in v1.
--
--   No role column in v1 (BL-003 resolved 2026-05-13). If/when roles become
--   necessary, the additive path is documented in the architecture's
--   "Roadmap and Modularity Seams" table — either a `role` column on this
--   table or a separate `roles` join table; both are additive migrations.
--
-- Columns:
--   id           : UUID PK. Default via pgcrypto.
--   org_id       : FK → orgs. Required; cascades on delete to clean up users
--                  when an org is hard-deleted (v1 uses soft-delete in
--                  practice, so cascade is a defense-in-depth measure).
--   email        : plain `text`. Case-insensitive uniqueness is enforced by
--                  the expression index below (`lower(email)`), not by the
--                  `citext` extension. Keeps queries explicit and the schema
--                  portable.
--   display_name : optional human-readable name.
--   created_at / updated_at / deleted_at : same pattern as `orgs`.
--
-- Uniqueness:
--   A user is identified by `(org_id, lower(email))`. The expression unique
--   index below enforces that. Application code must query with
--   `where org_id = $1 and lower(email) = lower($2)` to hit the index.
--
--   The `(id, org_id)` unique constraint exists so `tickets` can use a
--   composite FK and prove that the submitted user belongs to the submitted
--   org. Without that constraint a ticket could carry org A while pointing at
--   a user from org B.
--
-- Idempotency:
--   `IF NOT EXISTS` everywhere.
--
-- Rollback:
--   `DROP TRIGGER users_set_updated_at ON users; DROP TABLE users;`

create table if not exists users (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references orgs(id) on delete cascade,
  email        text        not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint users_id_org_uq unique (id, org_id)
);

-- Case-insensitive uniqueness for (org_id, email). Use lower(email) here and
-- in every lookup; pure `text` keeps citext out of the dependency surface.
create unique index if not exists users_org_email_lower_uq
  on users (org_id, lower(email));

-- Explicit FK index. Queries that fan out from an org (e.g., "list users in
-- this org") can use the unique index's leading column, but a dedicated
-- non-unique index on org_id is clearer for query planners and explicit
-- intent.
create index if not exists users_org_id_idx on users (org_id)
  where deleted_at is null;

-- Maintain updated_at via the shared trigger function defined in 03.
drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

comment on table  users              is 'Authorized users per org. Asserted by calling apps (Source A) or by AIP monitoring (Source B, deferred).';
comment on column users.org_id       is 'FK to orgs(id). Cascades on org hard-delete; v1 uses soft-delete in practice.';
comment on column users.email        is 'Plain text. Case-insensitive uniqueness enforced by users_org_email_lower_uq.';
comment on column users.deleted_at   is 'Soft-delete sentinel. Provider wrappers filter `is null` by default.';
comment on constraint users_id_org_uq on users is 'Composite unique enabling tickets(user_id, org_id) FK to enforce user/org consistency.';

-- Support Ticket Triage System
-- Migration: create tickets table
-- Created: 2026-02-05

begin;

create extension if not exists pgcrypto;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  customer_name text not null,
  email text not null,
  subject text not null,
  description text not null,

  priority text not null check (priority in ('Critical','High','Medium','Low')),
  category text not null check (category in ('Billing','Technical','Account','General')),
  suggested_response text not null,

  triage_status text not null default 'succeeded' check (triage_status in ('succeeded','failed')),
  triage_error text null
);

create index if not exists tickets_created_at_idx on public.tickets (created_at desc);

-- MVP is public (no auth). Grant minimal privileges to anon/authenticated.
grant usage on schema public to anon, authenticated;
grant select, insert on table public.tickets to anon, authenticated;

commit;

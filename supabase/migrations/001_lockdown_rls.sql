-- ══════════════════════════════════════════════════════════════════════
-- JewelOS security lockdown — closes the critical finding from the
-- July 21, 2026 audit: the Supabase anon key is public (it ships inside
-- client-side JS — anyone can view-source it), and with RLS off or
-- permissive, that means ANY visitor to ANY JewelOS shop can run
--   GET /rest/v1/store?select=*
-- and read every shop's products, customers, KYC data, girvi (pawn loan)
-- records, and sales — the entire platform's tenant data, unauthenticated.
--
-- WHY THIS CAN'T BE FIXED WITH A PER-TENANT RLS POLICY ALONE:
-- RLS decides "which rows can this request see" based on who Postgres
-- thinks is asking. Every JewelOS client currently authenticates to
-- Supabase with the SAME shared anon key — there is no per-shop identity
-- at the database layer (auth_store is a custom, app-level login system,
-- not Supabase Auth). So Postgres cannot tell shop A's browser apart from
-- shop B's browser; any RLS policy keyed on the anon role necessarily
-- either allows everyone or blocks everyone.
--
-- THE FIX: stop letting the browser talk to these tables directly at all.
--   1. This migration revokes anon/authenticated access entirely.
--   2. All reads/writes now go through the store-proxy Edge Function,
--      which holds the service_role key server-side (never shipped to
--      the browser) and enforces "this request's shop-key secret must
--      match the row it's asking for" before touching the table.
-- Run this AFTER deploying supabase/functions/store-proxy and
-- supabase/functions/auth-gateway, and AFTER updating the client to call
-- them (see js/01-sync-core.js changes) — otherwise the app goes dark
-- the moment this runs.
-- ══════════════════════════════════════════════════════════════════════

-- ── STORE TABLE (per-shop business data blob) ──────────────────────────
alter table public.store enable row level security;
-- No policies added for anon/authenticated => default-deny. Only
-- service_role (used exclusively by the store-proxy Edge Function,
-- which runs server-side) can read or write. service_role bypasses RLS
-- by design in Supabase, so it needs no explicit policy here.
revoke all on public.store from anon;
revoke all on public.store from authenticated;

-- ── AUTH_STORE TABLE (custom login system: users + shops blobs) ────────
-- This table is even more sensitive than `store` — its two rows
-- (id='users', id='shops') hold every user's email + password hash +
-- salt and every shop's config, for the ENTIRE platform, in two rows.
-- Same fix: lock it down entirely; all login/signup/staff-management now
-- goes through the auth-gateway Edge Function.
alter table public.auth_store enable row level security;
revoke all on public.auth_store from anon;
revoke all on public.auth_store from authenticated;

-- ── RATE LIMITING TABLE (new — used by auth-gateway) ────────────────────
-- Tracks failed login attempts server-side so a client refreshing the
-- page can no longer reset the limiter (the audit's "login rate limiting
-- is client-side only" finding).
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_time_idx
  on public.login_attempts (email, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon;
revoke all on public.login_attempts from authenticated;
-- Only service_role (auth-gateway) touches this table.

-- ── PAYMENT EVENTS TABLE (new — used by razorpay-webhook) ──────────────
-- Server-side record of verified Razorpay events, so plan activation is
-- never driven by a client-reported "payment succeeded" message (the
-- audit's "Razorpay handled client-side, no server-side webhook
-- verification" finding).
create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  razorpay_event_id text unique not null,
  razorpay_payment_id text,
  shop_row_key text not null,
  plan text not null,
  raw_payload jsonb not null,
  verified_at timestamptz not null default now()
);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon;
revoke all on public.payment_events from authenticated;

-- ── PASSWORD RESET TOKENS TABLE (new — used by auth-gateway) ───────────
-- Backs the real forgot-password flow (request-password-reset /
-- reset-password routes). Never stores the code itself — only its
-- SHA-256 hash, so a DB read alone can't be used to reset an account.
create table if not exists public.password_reset_tokens (
  id bigint generated always as identity primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_email_time_idx
  on public.password_reset_tokens (email, created_at desc);
alter table public.password_reset_tokens enable row level security;
revoke all on public.password_reset_tokens from anon;
revoke all on public.password_reset_tokens from authenticated;
-- Only service_role (auth-gateway) touches this table.

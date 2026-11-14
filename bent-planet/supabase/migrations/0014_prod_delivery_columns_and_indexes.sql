-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 — BETA READINESS (production subset): delivery tracking + indexes
--
-- STATUS: APPLIED (approved 2026-11-14) to production "bent-planet"
-- (tpkrakymxgffonefxqfc) as migration
-- `beta_readiness_delivery_columns_and_indexes`.
--
-- This is the subset of 0013 that production actually needed. Production's
-- notifications RLS is already church-scoped via `is_church_member()` /
-- `is_super_admin()` (with `user_churches` membership and an
-- `auth.users.is_super_admin` claim), so the policy section of 0013 was
-- deliberately not applied there — it would have widened access to
-- platform-level rows for any authenticated user.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.email_log
  add column if not exists delivered boolean default false,
  add column if not exists bounced boolean default false,
  add column if not exists complained boolean default false,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz;

alter table public.subscribers
  add column if not exists unsubscribed_at timestamptz;

create index if not exists subscribers_conference_reminder_7d_idx
  on public.subscribers (conference_id, reminder_7d_sent);

create index if not exists subscribers_conference_reminder_24h_idx
  on public.subscribers (conference_id, reminder_24h_sent);

create index if not exists subscribers_conference_replay_idx
  on public.subscribers (conference_id, replay_email_sent);

create index if not exists auth_rate_limits_lookup_idx
  on public.auth_rate_limits (identifier, action, requested_at);

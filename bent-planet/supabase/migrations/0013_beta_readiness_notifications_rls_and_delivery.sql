-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 — BETA READINESS: notifications RLS scoping, delivery tracking, indexes
--
-- STATUS: APPLIED (approved 2026-11-14).
--   • Test project "Bent planet test" (jqqfkflcesbxswsilucg): applied in full
--     as migration `beta_readiness_notifications_rls_delivery_indexes`.
--   • Production "bent-planet" (tpkrakymxgffonefxqfc): only the delivery
--     columns + indexes were applied (see 0014). The policy section was NOT
--     applied there: production's notifications RLS is already scoped via
--     `is_church_member(church_id)` / `is_super_admin()` (backed by a
--     `user_churches` membership table and an `auth.users.is_super_admin`
--     claim) — the policies below would have WEAKENED that setup. Production
--     and the test project have drifted; reconcile separately.
--
-- What this fixes (verified against the live test project on 2026-11-14):
--
-- 1. notifications RLS is currently wide open:
--      "churches can read own notifications"   USING (true)  FOR ALL ROLES
--      "churches can update own notifications" USING (true)  FOR ALL ROLES
--    Any holder of the anon/authenticated key can read or mark-read EVERY
--    church's notifications via PostgREST, bypassing the (now scoped) API
--    routes. This migration scopes reads/updates to the owning church's
--    admin, keeps platform-level rows (church_id IS NULL) readable to
--    authenticated users so super-admin tooling keeps working, and preserves
--    the existing church-scoped realtime subscriptions.
--
-- 2. email_log cannot express real delivery outcomes. The dashboard used to
--    label every unopened email "Delivered" with no data behind it. The UI is
--    now honest (Sent / Opened / Clicked); these columns allow tracking true
--    delivery, bounces and complaints from Resend webhook events once the
--    webhook handler is wired to them (follow-up code change after approval).
--
-- 3. Missing indexes for hot paths: webhook updates by resend_email_id and
--    cron flag scans per conference.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. notifications: real ownership scoping
-- ───────────────────────────────────────────────────────────────────────────
drop policy if exists "churches can read own notifications" on public.notifications;
drop policy if exists "churches can update own notifications" on public.notifications;

-- Read: own church's rows, or platform rows (church_id IS NULL).
create policy "notifications_select_scoped"
on public.notifications
for select
to authenticated
using (
  (
    church_id is not null
    and exists (
      select 1 from public.churches c
      where c.id = notifications.church_id
        and c.admin_email = (auth.jwt() ->> 'email')
    )
  )
  or church_id is null
);

-- Mark-as-read: same scope. Cross-church updates match zero rows.
create policy "notifications_update_scoped"
on public.notifications
for update
to authenticated
using (
  (
    church_id is not null
    and exists (
      select 1 from public.churches c
      where c.id = notifications.church_id
        and c.admin_email = (auth.jwt() ->> 'email')
    )
  )
  or church_id is null
)
with check (
  (
    church_id is not null
    and exists (
      select 1 from public.churches c
      where c.id = notifications.church_id
        and c.admin_email = (auth.jwt() ->> 'email')
    )
  )
  or church_id is null
);

-- Inserts stay service-role only (the app writes via the admin client).

-- ───────────────────────────────────────────────────────────────────────────
-- 2. email_log: truthful delivery tracking (additive, nullable-safe)
-- ───────────────────────────────────────────────────────────────────────────
alter table public.email_log
  add column if not exists delivered boolean default false,
  add column if not exists bounced boolean default false,
  add column if not exists complained boolean default false,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz;

-- Optional audit field for unsubscribe timing (the unsubscribed flag on
-- subscribers needs no change).
alter table public.subscribers
  add column if not exists unsubscribed_at timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Performance indexes for hot paths
-- ───────────────────────────────────────────────────────────────────────────
create index if not exists email_log_resend_email_id_idx
  on public.email_log (resend_email_id);

create index if not exists subscribers_conference_reminder_7d_idx
  on public.subscribers (conference_id, reminder_7d_sent);

create index if not exists subscribers_conference_reminder_24h_idx
  on public.subscribers (conference_id, reminder_24h_sent);

create index if not exists subscribers_conference_replay_idx
  on public.subscribers (conference_id, replay_email_sent);

create index if not exists auth_rate_limits_lookup_idx
  on public.auth_rate_limits (identifier, action, requested_at);

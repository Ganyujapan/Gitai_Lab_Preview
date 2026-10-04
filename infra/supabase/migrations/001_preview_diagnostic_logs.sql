-- Gitai_Lab Preview diagnostic upload (TEST ONLY)
-- No public policies are created. Edge Function uses the service-role key.

create extension if not exists pgcrypto;

create table if not exists public.gitai_preview_log_control (
  id integer primary key check (id = 1),
  enabled boolean not null default true,
  max_payload_bytes integer not null default 8388608,
  max_per_client_hour integer not null default 3,
  max_global_hour integer not null default 6,
  max_global_day integer not null default 20,
  max_active_logs integer not null default 50,
  retention_days integer not null default 30,
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  updated_at timestamptz not null default now()
);

insert into public.gitai_preview_log_control (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.gitai_preview_diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  log_id text not null unique,
  share_token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  client_key_hash text not null,
  payload_bytes integer not null check (payload_bytes > 0),
  environment_id text,
  evolution_model_id text,
  run_id text,
  current_generation_id text,
  payload jsonb not null
);

create index if not exists gitai_preview_logs_created_at_idx
  on public.gitai_preview_diagnostic_logs (created_at desc);

create index if not exists gitai_preview_logs_client_created_idx
  on public.gitai_preview_diagnostic_logs (client_key_hash, created_at desc);

create index if not exists gitai_preview_logs_expires_at_idx
  on public.gitai_preview_diagnostic_logs (expires_at);

alter table public.gitai_preview_log_control enable row level security;
alter table public.gitai_preview_diagnostic_logs enable row level security;

-- Intentionally no anon/authenticated policies.
-- Manual emergency stop:
-- update public.gitai_preview_log_control
-- set enabled = false,
--     auto_disabled_at = now(),
--     auto_disabled_reason = 'manual stop',
--     updated_at = now()
-- where id = 1;
--
-- Re-enable after checking:
-- update public.gitai_preview_log_control
-- set enabled = true,
--     auto_disabled_at = null,
--     auto_disabled_reason = null,
--     updated_at = now()
-- where id = 1;

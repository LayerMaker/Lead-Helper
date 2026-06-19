create table if not exists public.lead_helper_app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.lead_helper_app_state enable row level security;

revoke all on public.lead_helper_app_state from anon;
revoke all on public.lead_helper_app_state from authenticated;
grant all on public.lead_helper_app_state to service_role;

create index if not exists lead_helper_app_state_updated_at_idx
  on public.lead_helper_app_state (updated_at desc);

-- AEGIS Stardust Sheets - World Viewer
-- Additive setup: no existing character, DM session, or legacy encounter data is changed.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.world_admin (
  id text primary key default 'main',
  dm_secret text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.world_admin from public, anon, authenticated;

create table if not exists public.world_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('map', 'scene', 'token')),
  name text not null default '',
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  natural_w integer,
  natural_h integer,
  bytes bigint,
  original_w integer,
  original_h integer,
  original_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.world_maps (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.world_assets(id) on delete cascade,
  title text not null default '',
  grid_type text not null default 'square'
    check (grid_type in ('square', 'hex_pointy', 'hex_flat')),
  cell_px numeric not null default 70 check (cell_px > 0),
  offset_x numeric not null default 0,
  offset_y numeric not null default 0,
  grid_scale numeric not null default 1 check (grid_scale > 0),
  grid_opacity numeric not null default 0.5 check (grid_opacity between 0 and 1),
  grid_color text not null default '#7f99bd',
  grid_visible boolean not null default true,
  snap_enabled boolean not null default true,
  diagonal_rule text not null default 'seven_five'
    check (diagonal_rule in ('five', 'seven_five', 'alternating')),
  feet_per_cell integer not null default 5 check (feet_per_cell > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.world_state (
  id text primary key default 'main',
  mode text not null default 'encounter' check (mode in ('encounter', 'scene')),
  active_map_id uuid references public.world_maps(id) on delete set null,
  active_scene_asset_id uuid references public.world_assets(id) on delete set null,
  movement_locked boolean not null default false,
  scene_changing boolean not null default false,
  rev integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.world_tokens (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.world_maps(id) on delete cascade,
  kind text not null check (kind in ('pc', 'ally', 'neutral', 'foe')),
  slug text,
  name text not null default '',
  art_asset_id uuid references public.world_assets(id) on delete set null,
  size text not null default 'medium'
    check (size in ('medium', 'large', 'huge', 'gargantuan')),
  x numeric not null default 0,
  y numeric not null default 0,
  facing numeric,
  staged boolean not null default true,
  locked boolean not null default true,
  owner_slug text,
  initiative numeric,
  init_mod integer not null default 0,
  armor_class text not null default '',
  current_hp integer not null default 0,
  max_hp integer not null default 0,
  temp_hp integer not null default 0,
  conditions text not null default '',
  notes text not null default '',
  defeated boolean not null default false,
  rev integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.world_turn_state (
  id text primary key default 'main',
  combat_active boolean not null default false,
  round integer not null default 1 check (round > 0),
  order_ids jsonb not null default '[]'::jsonb,
  active_index integer not null default 0 check (active_index >= 0),
  delayed_ids jsonb not null default '[]'::jsonb,
  rev integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.world_turn_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  turn_rev integer not null,
  turn_state jsonb not null,
  token_positions jsonb not null
);

create table if not exists public.world_templates (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.world_maps(id) on delete cascade,
  shape text not null check (shape in ('ruler', 'cone', 'circle', 'ping')),
  origin_x numeric,
  origin_y numeric,
  target_x numeric,
  target_y numeric,
  radius_ft numeric,
  color text not null default '#ff5a3c',
  owner_slug text,
  pinned boolean not null default false,
  expires_at timestamptz,
  expires_on_token_id uuid references public.world_tokens(id) on delete cascade,
  created_turn_rev integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_token_defaults (
  slug text primary key,
  art_asset_id uuid references public.world_assets(id) on delete set null,
  size text not null default 'medium'
    check (size in ('medium', 'large', 'huge', 'gargantuan')),
  updated_at timestamptz not null default now()
);

create index if not exists world_tokens_map_idx on public.world_tokens(map_id);
create index if not exists world_tokens_slug_idx on public.world_tokens(slug);
create unique index if not exists world_tokens_map_slug_unique
  on public.world_tokens(map_id, slug) where slug is not null;
create index if not exists world_templates_map_idx on public.world_templates(map_id);
create index if not exists world_templates_expiry_idx on public.world_templates(expires_at)
  where pinned = false;
create index if not exists world_maps_asset_idx on public.world_maps(asset_id);
create index if not exists world_tokens_art_asset_idx on public.world_tokens(art_asset_id);
create index if not exists world_templates_expires_token_idx on public.world_templates(expires_on_token_id);
create index if not exists world_state_active_map_idx on public.world_state(active_map_id);
create index if not exists world_state_active_scene_idx on public.world_state(active_scene_asset_id);
create index if not exists character_token_defaults_asset_idx
  on public.character_token_defaults(art_asset_id);
create index if not exists snapshots_takenat_idx
  on public.world_turn_snapshots(taken_at desc);

insert into public.world_state (id) values ('main')
on conflict (id) do nothing;

insert into public.world_turn_state (id) values ('main')
on conflict (id) do nothing;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'world',
  'world',
  true,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.world_assets enable row level security;
alter table public.world_maps enable row level security;
alter table public.world_state enable row level security;
alter table public.world_tokens enable row level security;
alter table public.world_turn_state enable row level security;
alter table public.world_turn_snapshots enable row level security;
alter table public.world_templates enable row level security;
alter table public.character_token_defaults enable row level security;

drop policy if exists "World assets are public" on public.world_assets;
create policy "World assets are public"
on public.world_assets for select
to anon, authenticated
using (true);

drop policy if exists "World maps are public" on public.world_maps;
create policy "World maps are public"
on public.world_maps for select
to anon, authenticated
using (true);

drop policy if exists "World state is public" on public.world_state;
create policy "World state is public"
on public.world_state for select
to anon, authenticated
using (true);

drop policy if exists "World tokens are public" on public.world_tokens;
create policy "World tokens are public"
on public.world_tokens for select
to anon, authenticated
using (true);

drop policy if exists "World token positions are writable" on public.world_tokens;
create policy "World token positions are writable"
on public.world_tokens for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "World turn state is public" on public.world_turn_state;
create policy "World turn state is public"
on public.world_turn_state for select
to anon, authenticated
using (true);

drop policy if exists "World templates are public" on public.world_templates;
create policy "World templates are public"
on public.world_templates for select
to anon, authenticated
using (true);

drop policy if exists "World templates can be created" on public.world_templates;
create policy "World templates can be created"
on public.world_templates for insert
to anon, authenticated
with check (pinned = false);

drop policy if exists "World templates can be updated" on public.world_templates;
create policy "World templates can be updated"
on public.world_templates for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "World templates can be deleted" on public.world_templates;
create policy "World templates can be deleted"
on public.world_templates for delete
to anon, authenticated
using (true);

drop policy if exists "World token defaults are public" on public.character_token_defaults;
create policy "World token defaults are public"
on public.character_token_defaults for select
to anon, authenticated
using (true);

revoke all on public.world_assets from anon, authenticated;
revoke all on public.world_maps from anon, authenticated;
revoke all on public.world_state from anon, authenticated;
revoke all on public.world_tokens from anon, authenticated;
revoke all on public.world_turn_state from anon, authenticated;
revoke all on public.world_turn_snapshots from anon, authenticated;
revoke all on public.world_templates from anon, authenticated;
revoke all on public.character_token_defaults from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.world_assets to anon, authenticated;
grant select on public.world_maps to anon, authenticated;
grant select on public.world_state to anon, authenticated;
grant select on public.world_tokens to anon, authenticated;
grant update (x, y, rev, updated_at) on public.world_tokens to anon, authenticated;
grant select on public.world_turn_state to anon, authenticated;
grant select, insert, update, delete on public.world_templates to anon, authenticated;
grant select on public.character_token_defaults to anon, authenticated;

drop policy if exists "World bucket objects are public" on storage.objects;

create or replace function private.world_admin_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.world_admin
    where id = 'main'
      and dm_secret = extensions.crypt(coalesce(p_secret, ''), dm_secret)
  );
$$;

revoke all on function private.world_admin_valid(text) from public, anon, authenticated;

create or replace function private.world_set_admin_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_secret, '')) < 3 then
    raise exception 'World command key must contain at least three characters.';
  end if;

  insert into private.world_admin (id, dm_secret, updated_at)
  values (
    'main',
    extensions.crypt(p_secret, extensions.gen_salt('bf')),
    now()
  )
  on conflict (id) do update set
    dm_secret = excluded.dm_secret,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function private.world_set_admin_secret(text) from public, anon, authenticated;

create or replace function public.world_verify_admin_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.world_admin_valid(p_secret);
$$;

revoke all on function public.world_verify_admin_secret(text) from public;
grant execute on function public.world_verify_admin_secret(text) to anon, authenticated, service_role;

create or replace function public.world_set_state(
  p_secret text,
  p_expected_rev integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.world_state%rowtype;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_state
  from public.world_state
  where id = 'main'
  for update;

  if p_expected_rev is not null and v_state.rev <> p_expected_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'state', to_jsonb(v_state));
  end if;

  update public.world_state
  set
    mode = case
      when p_patch ? 'mode' then coalesce(nullif(p_patch->>'mode', ''), mode)
      else mode
    end,
    active_map_id = case
      when p_patch ? 'active_map_id' and nullif(p_patch->>'active_map_id', '') is not null
        then (p_patch->>'active_map_id')::uuid
      when p_patch ? 'active_map_id' then null
      else active_map_id
    end,
    active_scene_asset_id = case
      when p_patch ? 'active_scene_asset_id'
        and nullif(p_patch->>'active_scene_asset_id', '') is not null
        then (p_patch->>'active_scene_asset_id')::uuid
      when p_patch ? 'active_scene_asset_id' then null
      else active_scene_asset_id
    end,
    movement_locked = case
      when p_patch ? 'movement_locked' then (p_patch->>'movement_locked')::boolean
      else movement_locked
    end,
    scene_changing = case
      when p_patch ? 'scene_changing' then (p_patch->>'scene_changing')::boolean
      else scene_changing
    end,
    rev = rev + 1,
    updated_at = now()
  where id = 'main'
  returning * into v_state;

  return jsonb_build_object('ok', true, 'state', to_jsonb(v_state));
end;
$$;

revoke all on function public.world_set_state(text, integer, jsonb) from public;
grant execute on function public.world_set_state(text, integer, jsonb) to anon, authenticated;

create or replace function public.world_register_asset(
  p_secret text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.world_assets%rowtype;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.world_assets (
    kind,
    name,
    storage_path,
    mime_type,
    natural_w,
    natural_h,
    bytes,
    original_w,
    original_h,
    original_bytes
  )
  values (
    p_payload->>'kind',
    coalesce(p_payload->>'name', ''),
    p_payload->>'storage_path',
    coalesce(p_payload->>'mime_type', 'application/octet-stream'),
    nullif(p_payload->>'natural_w', '')::integer,
    nullif(p_payload->>'natural_h', '')::integer,
    nullif(p_payload->>'bytes', '')::bigint,
    nullif(p_payload->>'natural_w', '')::integer,
    nullif(p_payload->>'natural_h', '')::integer,
    nullif(p_payload->>'bytes', '')::bigint
  )
  on conflict (storage_path) do update set
    name = excluded.name,
    mime_type = excluded.mime_type,
    natural_w = excluded.natural_w,
    natural_h = excluded.natural_h,
    bytes = excluded.bytes,
    original_w = excluded.original_w,
    original_h = excluded.original_h,
    original_bytes = excluded.original_bytes,
    updated_at = now()
  returning * into v_asset;

  return jsonb_build_object('ok', true, 'asset', to_jsonb(v_asset));
end;
$$;

revoke all on function public.world_register_asset(text, jsonb) from public;
grant execute on function public.world_register_asset(text, jsonb) to anon, authenticated;

create or replace function public.world_upsert_map(
  p_secret text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.world_maps%rowtype;
  v_id uuid;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is null then
    insert into public.world_maps (
      asset_id,
      title,
      grid_type,
      cell_px,
      offset_x,
      offset_y,
      grid_scale,
      grid_opacity,
      grid_color,
      grid_visible,
      snap_enabled,
      diagonal_rule,
      feet_per_cell
    )
    values (
      (p_payload->>'asset_id')::uuid,
      coalesce(p_payload->>'title', ''),
      coalesce(p_payload->>'grid_type', 'square'),
      coalesce(nullif(p_payload->>'cell_px', '')::numeric, 70),
      coalesce(nullif(p_payload->>'offset_x', '')::numeric, 0),
      coalesce(nullif(p_payload->>'offset_y', '')::numeric, 0),
      coalesce(nullif(p_payload->>'grid_scale', '')::numeric, 1),
      coalesce(nullif(p_payload->>'grid_opacity', '')::numeric, 0.5),
      coalesce(p_payload->>'grid_color', '#7f99bd'),
      coalesce(nullif(p_payload->>'grid_visible', '')::boolean, true),
      coalesce(nullif(p_payload->>'snap_enabled', '')::boolean, true),
      coalesce(p_payload->>'diagonal_rule', 'seven_five'),
      coalesce(nullif(p_payload->>'feet_per_cell', '')::integer, 5)
    )
    returning * into v_map;
  else
    update public.world_maps
    set
      title = coalesce(p_payload->>'title', title),
      grid_type = coalesce(p_payload->>'grid_type', grid_type),
      cell_px = coalesce(nullif(p_payload->>'cell_px', '')::numeric, cell_px),
      offset_x = coalesce(nullif(p_payload->>'offset_x', '')::numeric, offset_x),
      offset_y = coalesce(nullif(p_payload->>'offset_y', '')::numeric, offset_y),
      grid_scale = coalesce(nullif(p_payload->>'grid_scale', '')::numeric, grid_scale),
      grid_opacity = coalesce(nullif(p_payload->>'grid_opacity', '')::numeric, grid_opacity),
      grid_color = coalesce(p_payload->>'grid_color', grid_color),
      grid_visible = coalesce(nullif(p_payload->>'grid_visible', '')::boolean, grid_visible),
      snap_enabled = coalesce(nullif(p_payload->>'snap_enabled', '')::boolean, snap_enabled),
      diagonal_rule = coalesce(p_payload->>'diagonal_rule', diagonal_rule),
      feet_per_cell = coalesce(nullif(p_payload->>'feet_per_cell', '')::integer, feet_per_cell),
      updated_at = now()
    where id = v_id
    returning * into v_map;
  end if;

  if v_map.id is null then
    return jsonb_build_object('ok', false, 'error', 'map_not_found');
  end if;

  return jsonb_build_object('ok', true, 'map', to_jsonb(v_map));
end;
$$;

revoke all on function public.world_upsert_map(text, jsonb) from public;
grant execute on function public.world_upsert_map(text, jsonb) to anon, authenticated;

create or replace function public.world_create_token(
  p_secret text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.world_tokens%rowtype;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.world_tokens (
    map_id,
    kind,
    slug,
    name,
    art_asset_id,
    size,
    x,
    y,
    staged,
    locked,
    owner_slug,
    initiative,
    init_mod,
    armor_class,
    current_hp,
    max_hp,
    temp_hp,
    conditions,
    notes
  )
  values (
    (p_payload->>'map_id')::uuid,
    coalesce(p_payload->>'kind', 'foe'),
    nullif(p_payload->>'slug', ''),
    coalesce(p_payload->>'name', 'Combatant'),
    nullif(p_payload->>'art_asset_id', '')::uuid,
    coalesce(p_payload->>'size', 'medium'),
    coalesce(nullif(p_payload->>'x', '')::numeric, 0),
    coalesce(nullif(p_payload->>'y', '')::numeric, 0),
    coalesce(nullif(p_payload->>'staged', '')::boolean, true),
    coalesce(nullif(p_payload->>'locked', '')::boolean, true),
    nullif(p_payload->>'owner_slug', ''),
    nullif(p_payload->>'initiative', '')::numeric,
    coalesce(nullif(p_payload->>'init_mod', '')::integer, 0),
    coalesce(p_payload->>'armor_class', ''),
    coalesce(nullif(p_payload->>'current_hp', '')::integer, 0),
    coalesce(nullif(p_payload->>'max_hp', '')::integer, 0),
    coalesce(nullif(p_payload->>'temp_hp', '')::integer, 0),
    coalesce(p_payload->>'conditions', ''),
    coalesce(p_payload->>'notes', '')
  )
  returning * into v_token;

  return jsonb_build_object('ok', true, 'token', to_jsonb(v_token));
end;
$$;

revoke all on function public.world_create_token(text, jsonb) from public;
grant execute on function public.world_create_token(text, jsonb) to anon, authenticated;

create or replace function public.world_add_party(
  p_secret text,
  p_map_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.world_tokens (
    map_id,
    kind,
    slug,
    name,
    size,
    staged,
    locked,
    owner_slug,
    initiative,
    init_mod
  )
  select
    p_map_id,
    'pc',
    c.slug,
    c.name,
    coalesce(d.size, 'medium'),
    true,
    true,
    c.slug,
    null,
    0
  from public.characters c
  left join public.character_token_defaults d on d.slug = c.slug
  where c.is_public = true
  on conflict (map_id, slug) where slug is not null do update set
    name = excluded.name,
    owner_slug = excluded.owner_slug;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke all on function public.world_add_party(text, uuid) from public;
grant execute on function public.world_add_party(text, uuid) to anon, authenticated;

create or replace function public.world_update_token(
  p_secret text,
  p_token_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.world_tokens%rowtype;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.world_tokens
  set
    kind = coalesce(p_payload->>'kind', kind),
    name = coalesce(p_payload->>'name', name),
    art_asset_id = case
      when p_payload ? 'art_asset_id' and nullif(p_payload->>'art_asset_id', '') is not null
        then (p_payload->>'art_asset_id')::uuid
      when p_payload ? 'art_asset_id' then null
      else art_asset_id
    end,
    size = coalesce(p_payload->>'size', size),
    x = coalesce(nullif(p_payload->>'x', '')::numeric, x),
    y = coalesce(nullif(p_payload->>'y', '')::numeric, y),
    staged = coalesce(nullif(p_payload->>'staged', '')::boolean, staged),
    locked = coalesce(nullif(p_payload->>'locked', '')::boolean, locked),
    initiative = case
      when p_payload ? 'initiative' and nullif(p_payload->>'initiative', '') is not null
        then (p_payload->>'initiative')::numeric
      when p_payload ? 'initiative' then null
      else initiative
    end,
    init_mod = coalesce(nullif(p_payload->>'init_mod', '')::integer, init_mod),
    armor_class = coalesce(p_payload->>'armor_class', armor_class),
    current_hp = coalesce(nullif(p_payload->>'current_hp', '')::integer, current_hp),
    max_hp = coalesce(nullif(p_payload->>'max_hp', '')::integer, max_hp),
    temp_hp = coalesce(nullif(p_payload->>'temp_hp', '')::integer, temp_hp),
    conditions = coalesce(p_payload->>'conditions', conditions),
    notes = coalesce(p_payload->>'notes', notes),
    defeated = coalesce(nullif(p_payload->>'defeated', '')::boolean, defeated),
    rev = rev + 1,
    updated_at = now()
  where id = p_token_id
  returning * into v_token;

  if v_token.id is null then
    return jsonb_build_object('ok', false, 'error', 'token_not_found');
  end if;

  return jsonb_build_object('ok', true, 'token', to_jsonb(v_token));
end;
$$;

revoke all on function public.world_update_token(text, uuid, jsonb) from public;
grant execute on function public.world_update_token(text, uuid, jsonb) to anon, authenticated;

create or replace function public.world_delete_token(
  p_secret text,
  p_token_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.world_tokens where id = p_token_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.world_delete_token(text, uuid) from public;
grant execute on function public.world_delete_token(text, uuid) to anon, authenticated;

create or replace function public.world_set_character_token(
  p_secret text,
  p_slug text,
  p_art_asset_id uuid,
  p_size text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.character_token_defaults (slug, art_asset_id, size, updated_at)
  values (p_slug, p_art_asset_id, coalesce(p_size, 'medium'), now())
  on conflict (slug) do update set
    art_asset_id = excluded.art_asset_id,
    size = excluded.size,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.world_set_character_token(text, text, uuid, text) from public;
grant execute on function public.world_set_character_token(text, text, uuid, text)
  to anon, authenticated;

create or replace function public.world_patch_turn(
  p_secret text,
  p_expected_rev integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn public.world_turn_state%rowtype;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_turn
  from public.world_turn_state
  where id = 'main'
  for update;

  if p_expected_rev is not null and v_turn.rev <> p_expected_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'state', to_jsonb(v_turn));
  end if;

  update public.world_turn_state
  set
    combat_active = coalesce(nullif(p_patch->>'combat_active', '')::boolean, combat_active),
    round = coalesce(nullif(p_patch->>'round', '')::integer, round),
    order_ids = case when p_patch ? 'order_ids' then p_patch->'order_ids' else order_ids end,
    active_index = coalesce(nullif(p_patch->>'active_index', '')::integer, active_index),
    delayed_ids = case when p_patch ? 'delayed_ids' then p_patch->'delayed_ids' else delayed_ids end,
    rev = rev + 1,
    updated_at = now()
  where id = 'main'
  returning * into v_turn;

  if not v_turn.combat_active then
    update public.world_tokens
    set locked = true, rev = rev + 1, updated_at = now()
    where kind = 'pc' and locked = false;
  end if;

  return jsonb_build_object('ok', true, 'state', to_jsonb(v_turn));
end;
$$;

revoke all on function public.world_patch_turn(text, integer, jsonb) from public;
grant execute on function public.world_patch_turn(text, integer, jsonb) to anon, authenticated;

create or replace function public.world_advance_turn(
  p_secret_or_owner text,
  p_action text,
  p_target_id uuid,
  p_expected_rev integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn public.world_turn_state%rowtype;
  v_snapshot public.world_turn_snapshots%rowtype;
  v_active_map uuid;
  v_len integer;
  v_current_id uuid;
  v_next_id uuid;
  v_next_index integer;
  v_target_index integer;
  v_player_name text;
  v_delayed jsonb;
  v_token record;
begin
  select * into v_turn
  from public.world_turn_state
  where id = 'main'
  for update;

  if p_expected_rev is not null and v_turn.rev <> p_expected_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'state', to_jsonb(v_turn));
  end if;

  if p_action = 'undo' then
    if not private.world_admin_valid(p_secret_or_owner) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    select * into v_snapshot
    from public.world_turn_snapshots
    order by taken_at desc, id desc
    limit 1
    for update;

    if v_snapshot.id is null then
      return jsonb_build_object('ok', false, 'error', 'nothing_to_undo');
    end if;

    update public.world_turn_state
    set
      combat_active = coalesce((v_snapshot.turn_state->>'combat_active')::boolean, combat_active),
      round = coalesce((v_snapshot.turn_state->>'round')::integer, round),
      order_ids = coalesce(v_snapshot.turn_state->'order_ids', '[]'::jsonb),
      active_index = coalesce((v_snapshot.turn_state->>'active_index')::integer, 0),
      delayed_ids = coalesce(v_snapshot.turn_state->'delayed_ids', '[]'::jsonb),
      rev = rev + 1,
      updated_at = now()
    where id = 'main'
    returning * into v_turn;

    for v_token in
      select *
      from jsonb_to_recordset(v_snapshot.token_positions)
        as restored(id uuid, x numeric, y numeric, staged boolean, locked boolean)
    loop
      update public.world_tokens
      set
        x = v_token.x,
        y = v_token.y,
        staged = v_token.staged,
        locked = v_token.locked,
        rev = rev + 1,
        updated_at = now()
      where id = v_token.id;
    end loop;

    delete from public.world_turn_snapshots where id = v_snapshot.id;
    return jsonb_build_object('ok', true, 'state', to_jsonb(v_turn));
  end if;

  v_len := jsonb_array_length(v_turn.order_ids);
  if v_len = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_order');
  end if;

  if v_turn.active_index >= v_len then
    v_turn.active_index := 0;
  end if;

  v_current_id := (v_turn.order_ids->>v_turn.active_index)::uuid;

  if p_action = 'end_turn' then
    if p_target_id is distinct from v_current_id then
      return jsonb_build_object('ok', false, 'error', 'not_active');
    end if;

    select c.name into v_player_name
    from public.world_tokens t
    join public.characters c on c.slug = t.owner_slug
    where t.id = v_current_id and t.kind = 'pc';

    if v_player_name is null
      or (
        lower(trim(coalesce(p_secret_or_owner, '')))
          <> lower(trim(v_player_name || ' 712'))
        and not private.world_admin_valid(p_secret_or_owner)
      )
    then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  elsif not private.world_admin_valid(p_secret_or_owner) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select active_map_id into v_active_map
  from public.world_state
  where id = 'main';

  insert into public.world_turn_snapshots (
    turn_rev,
    turn_state,
    token_positions
  )
  values (
    v_turn.rev,
    jsonb_build_object(
      'combat_active', v_turn.combat_active,
      'round', v_turn.round,
      'order_ids', v_turn.order_ids,
      'active_index', v_turn.active_index,
      'delayed_ids', v_turn.delayed_ids
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'x', x,
        'y', y,
        'staged', staged,
        'locked', locked
      ))
      from public.world_tokens
      where map_id = v_active_map
    ), '[]'::jsonb)
  );

  v_next_index := v_turn.active_index;
  v_delayed := v_turn.delayed_ids;

  if p_action in ('advance', 'skip', 'end_turn', 'delay') then
    if p_action = 'delay'
      and not (v_delayed @> jsonb_build_array(v_current_id::text))
    then
      v_delayed := v_delayed || jsonb_build_array(v_current_id::text);
    end if;

    v_next_index := v_turn.active_index + 1;
    if v_next_index >= v_len then
      v_next_index := 0;
      v_turn.round := v_turn.round + 1;
    end if;
  elsif p_action = 'select' then
    select ordinality - 1 into v_target_index
    from jsonb_array_elements_text(v_turn.order_ids) with ordinality
    where value = p_target_id::text;

    if v_target_index is null then
      return jsonb_build_object('ok', false, 'error', 'target_not_in_order');
    end if;

    v_next_index := v_target_index;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_delayed
    from jsonb_array_elements(v_delayed) as delayed(value)
    where value <> to_jsonb(p_target_id::text);
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  v_next_id := (v_turn.order_ids->>v_next_index)::uuid;

  update public.world_tokens
  set locked = true, rev = rev + 1, updated_at = now()
  where kind = 'pc' and locked = false;

  update public.world_tokens
  set locked = false, rev = rev + 1, updated_at = now()
  where id = v_next_id and kind = 'pc';

  update public.world_turn_state
  set
    round = v_turn.round,
    active_index = v_next_index,
    delayed_ids = v_delayed,
    rev = rev + 1,
    updated_at = now()
  where id = 'main'
  returning * into v_turn;

  delete from public.world_templates
  where pinned = false
    and (
      expires_at <= now()
      or (
        expires_on_token_id = v_next_id
        and coalesce(created_turn_rev, -1) < v_turn.rev
      )
    );

  delete from public.world_turn_snapshots
  where id in (
    select id
    from public.world_turn_snapshots
    order by taken_at desc, id desc
    offset 20
  );

  return jsonb_build_object('ok', true, 'state', to_jsonb(v_turn));
end;
$$;

revoke all on function public.world_advance_turn(text, text, uuid, integer) from public;
grant execute on function public.world_advance_turn(text, text, uuid, integer)
  to anon, authenticated;

create or replace function public.world_roll_initiative(
  p_secret text,
  p_scope text,
  p_expected_rev integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn public.world_turn_state%rowtype;
  v_active_map uuid;
  v_order jsonb;
  v_active_id uuid;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_turn
  from public.world_turn_state
  where id = 'main'
  for update;

  if p_expected_rev is not null and v_turn.rev <> p_expected_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'state', to_jsonb(v_turn));
  end if;

  select active_map_id into v_active_map
  from public.world_state
  where id = 'main';

  if v_active_map is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_map');
  end if;

  if p_scope in ('all', 'dm') then
    update public.world_tokens
    set
      initiative = floor(random() * 20 + 1)::integer + init_mod,
      rev = rev + 1,
      updated_at = now()
    where map_id = v_active_map
      and staged = false
      and defeated = false
      and (p_scope = 'all' or kind <> 'pc');
  elsif p_scope <> 'manual' then
    return jsonb_build_object('ok', false, 'error', 'invalid_scope');
  end if;

  select coalesce(jsonb_agg(id::text order by
    initiative desc nulls last,
    case kind when 'pc' then 0 when 'ally' then 1 when 'neutral' then 2 else 3 end,
    created_at,
    id
  ), '[]'::jsonb)
  into v_order
  from public.world_tokens
  where map_id = v_active_map
    and staged = false
    and defeated = false;

  v_active_id := nullif(v_order->>0, '')::uuid;

  update public.world_tokens
  set locked = true, rev = rev + 1, updated_at = now()
  where map_id = v_active_map and kind = 'pc';

  update public.world_tokens
  set locked = false, rev = rev + 1, updated_at = now()
  where id = v_active_id and kind = 'pc';

  update public.world_turn_state
  set
    combat_active = jsonb_array_length(v_order) > 0,
    round = 1,
    order_ids = v_order,
    active_index = 0,
    delayed_ids = '[]'::jsonb,
    rev = rev + 1,
    updated_at = now()
  where id = 'main'
  returning * into v_turn;

  return jsonb_build_object('ok', true, 'state', to_jsonb(v_turn));
end;
$$;

revoke all on function public.world_roll_initiative(text, text, integer) from public;
grant execute on function public.world_roll_initiative(text, text, integer)
  to anon, authenticated;

create or replace function public.world_delete_asset(
  p_secret text,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not private.world_admin_valid(p_secret) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select storage_path into v_path
  from public.world_assets
  where id = p_asset_id;

  delete from public.world_assets where id = p_asset_id;
  return jsonb_build_object('ok', true, 'storage_path', v_path);
end;
$$;

revoke all on function public.world_delete_asset(text, uuid) from public;
grant execute on function public.world_delete_asset(text, uuid) to anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'world_assets',
    'world_maps',
    'world_state',
    'world_tokens',
    'world_turn_state',
    'world_templates'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table
      );
    end if;
  end loop;
end;
$$;

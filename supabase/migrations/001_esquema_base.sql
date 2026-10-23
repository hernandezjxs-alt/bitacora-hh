-- Bitácora HH · Etapa 1 · esquema base (proyecto Supabase propio: bitacora-hh)
create extension if not exists btree_gist with schema extensions;

-- ===== Perfiles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  full_name text,
  role text not null default 'user' check (role in ('admin','user')),
  consent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function public.current_role_name() returns text
language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = auth.uid() $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and role = 'user');
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = public.current_role_name());

-- ===== Clientes y proyectos =====
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index clients_user_name_uq on public.clients (user_id, lower(name));
alter table public.clients enable row level security;
create policy clients_select on public.clients for select to authenticated using (user_id = (select auth.uid()));
create policy clients_insert on public.clients for insert to authenticated with check (user_id = (select auth.uid()));
create policy clients_update on public.clients for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy clients_delete on public.clients for delete to authenticated using (user_id = (select auth.uid()));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index projects_user_client_name_uq on public.projects
  (user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index projects_client_idx on public.projects (client_id);
alter table public.projects enable row level security;
create policy projects_select on public.projects for select to authenticated using (user_id = (select auth.uid()));
create policy projects_insert on public.projects for insert to authenticated
  with check (user_id = (select auth.uid())
    and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.user_id = (select auth.uid()))));
create policy projects_update on public.projects for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.user_id = (select auth.uid()))));
create policy projects_delete on public.projects for delete to authenticated using (user_id = (select auth.uid()));

-- ===== Categorías y etiquetas oficiales (las administra el admin) =====
create table public.taxonomy (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tag','category')),
  name text not null check (char_length(name) between 2 and 60),
  created_at timestamptz not null default now()
);
create unique index taxonomy_kind_name_uq on public.taxonomy (kind, lower(name));
alter table public.taxonomy enable row level security;
create policy taxonomy_select on public.taxonomy for select to authenticated using (true);
create policy taxonomy_insert on public.taxonomy for insert to authenticated with check (public.is_admin());
create policy taxonomy_update on public.taxonomy for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy taxonomy_delete on public.taxonomy for delete to authenticated using (public.is_admin());
insert into public.taxonomy (kind, name) values
  ('category','Proyecto'),('category','Daily'),('category','Reunión'),('category','Soporte'),
  ('category','Capacitación'),('category','Administrativo'),('category','Otro')
on conflict do nothing;

-- ===== Configuración de jornada, metas y días sin actividad =====
create table public.work_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  work_start time not null default '09:00',
  work_end time not null default '18:30',
  lunch_start time not null default '14:00',
  lunch_end time not null default '15:00',
  daily_start time not null default '09:30',
  daily_end time not null default '10:00',
  max_imputable_day_minutes integer not null default 480 check (max_imputable_day_minutes between 60 and 1440),
  step_minutes integer not null default 15 check (step_minutes in (5,10,15,30)),
  auto_daily boolean not null default true,
  check (lunch_end > lunch_start and work_end > work_start and daily_end > daily_start)
);
alter table public.work_settings enable row level security;
create policy work_settings_select on public.work_settings for select to authenticated using (user_id = (select auth.uid()));
create policy work_settings_insert on public.work_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy work_settings_update on public.work_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy work_settings_delete on public.work_settings for delete to authenticated using (user_id = (select auth.uid()));

create table public.goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  week_target_hours numeric(5,2) not null default 40 check (week_target_hours > 0 and week_target_hours <= 168)
);
alter table public.goals enable row level security;
create policy goals_select on public.goals for select to authenticated using (user_id = (select auth.uid()));
create policy goals_insert on public.goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_delete on public.goals for delete to authenticated using (user_id = (select auth.uid()));

create table public.day_flags (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  flag_date date not null,
  kind text not null check (kind in ('feriado','permiso','vacaciones','sin_actividad')),
  note text check (note is null or char_length(note) <= 200),
  primary key (user_id, flag_date)
);
alter table public.day_flags enable row level security;
create policy day_flags_select on public.day_flags for select to authenticated using (user_id = (select auth.uid()));
create policy day_flags_insert on public.day_flags for insert to authenticated with check (user_id = (select auth.uid()));
create policy day_flags_update on public.day_flags for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy day_flags_delete on public.day_flags for delete to authenticated using (user_id = (select auth.uid()));

-- ===== Registro de horas =====
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  task text not null check (char_length(task) between 1 and 300),
  category text not null default 'Proyecto' check (char_length(category) between 1 and 60),
  description text check (description is null or char_length(description) <= 1000),
  ticket text check (ticket is null or char_length(ticket) <= 60),
  ticket_status text check (ticket_status is null or char_length(ticket_status) <= 60),
  entry_date date not null,
  start_time time not null,
  end_time time not null,
  duration_minutes integer generated always as ((extract(epoch from (end_time - start_time)) / 60)::integer) stored,
  tags text[] not null default '{}',
  imputable boolean not null default true,
  created_at timestamptz not null default now(),
  constraint time_entries_end_after_start check (end_time > start_time),
  constraint time_entries_no_overlap exclude using gist (
    user_id with =,
    tsrange(entry_date + start_time, entry_date + end_time) with &&
  )
);
create index time_entries_user_date_idx on public.time_entries (user_id, entry_date);
create index time_entries_project_idx on public.time_entries (project_id);
alter table public.time_entries enable row level security;
create policy time_entries_select on public.time_entries for select to authenticated using (user_id = (select auth.uid()));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy time_entries_delete on public.time_entries for delete to authenticated using (user_id = (select auth.uid()));

create function public.time_entries_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_ls time := '14:00';
  v_le time := '15:00';
  v_mins integer;
begin
  v_mins := (extract(epoch from (new.end_time - new.start_time)) / 60)::integer;
  if v_mins % 15 <> 0 then
    raise exception 'La duración debe ser múltiplo de 15 minutos';
  end if;
  select coalesce(ws.lunch_start, v_ls), coalesce(ws.lunch_end, v_le)
    into v_ls, v_le
    from public.work_settings ws where ws.user_id = new.user_id;
  v_ls := coalesce(v_ls, '14:00');
  v_le := coalesce(v_le, '15:00');
  if new.start_time < v_le and new.end_time > v_ls then
    raise exception 'La entrada cruza el horario de almuerzo';
  end if;
  return new;
end $$;
create trigger time_entries_guard_trg before insert or update on public.time_entries
  for each row execute function public.time_entries_guard();

create table public.active_timer (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  task text not null check (char_length(task) between 1 and 300),
  category text not null default 'Proyecto',
  description text check (description is null or char_length(description) <= 1000),
  started_at timestamptz not null default now()
);
create index active_timer_project_idx on public.active_timer (project_id);
alter table public.active_timer enable row level security;
create policy active_timer_select on public.active_timer for select to authenticated using (user_id = (select auth.uid()));
create policy active_timer_insert on public.active_timer for insert to authenticated with check (user_id = (select auth.uid()));
create policy active_timer_update on public.active_timer for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy active_timer_delete on public.active_timer for delete to authenticated using (user_id = (select auth.uid()));

-- ===== Avisos al admin y contacto =====
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  username text,
  kind text not null default 'info',
  message text not null check (char_length(message) between 1 and 500),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id);
alter table public.notifications enable row level security;
create policy notifications_insert on public.notifications for insert to authenticated with check (user_id = (select auth.uid()));
create policy notifications_select on public.notifications for select to authenticated using (public.is_admin());
create policy notifications_update on public.notifications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy notifications_delete on public.notifications for delete to authenticated using (public.is_admin());

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 5 and 160 and email like '%@%'),
  message text not null check (char_length(message) between 5 and 2000),
  hp text check (hp is null or hp = ''),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.contact_messages enable row level security;
create policy contact_messages_insert on public.contact_messages for insert to anon, authenticated with check (hp is null or hp = '');
create policy contact_messages_select on public.contact_messages for select to authenticated using (public.is_admin());
create policy contact_messages_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contact_messages_delete on public.contact_messages for delete to authenticated using (public.is_admin());

-- ===== Alta de usuario: la primera cuenta es admin =====
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := case when exists (select 1 from public.profiles) then 'user' else 'admin' end;
  insert into public.profiles (id, email, username, full_name, role, consent_at)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)),
    nullif(new.raw_user_meta_data->>'full_name',''),
    v_role,
    case when (new.raw_user_meta_data->>'consent') in ('true','1') then now() else null end
  );
  insert into public.work_settings (user_id) values (new.id);
  insert into public.goals (user_id) values (new.id);
  insert into public.projects (user_id, name) values (new.id, 'General');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== Funciones de consulta =====
create function public.my_day_totals(p_from date, p_to date)
returns table (entry_date date, imputable_minutes integer, internal_minutes integer)
language sql stable set search_path = '' as $$
  select e.entry_date,
         coalesce(sum(e.duration_minutes) filter (where e.imputable), 0)::integer,
         coalesce(sum(e.duration_minutes) filter (where not e.imputable), 0)::integer
  from public.time_entries e
  where e.user_id = (select auth.uid()) and e.entry_date between p_from and p_to
  group by e.entry_date order by e.entry_date
$$;

create function public.admin_users()
returns table (id uuid, email text, username text, full_name text, role text, created_at timestamptz, entries bigint, last_entry date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  return query
    select p.id, p.email, p.username, p.full_name, p.role, p.created_at, count(e.id), max(e.entry_date)
    from public.profiles p left join public.time_entries e on e.user_id = p.id
    group by p.id order by p.created_at;
end $$;

create function public.team_hours(p_from date, p_to date)
returns table (user_id uuid, username text, client text, project text, imputable_minutes bigint, internal_minutes bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  return query
    select e.user_id, pr.username, c.name, p.name,
           coalesce(sum(e.duration_minutes) filter (where e.imputable), 0),
           coalesce(sum(e.duration_minutes) filter (where not e.imputable), 0)
    from public.time_entries e
    join public.profiles pr on pr.id = e.user_id
    join public.projects p on p.id = e.project_id
    left join public.clients c on c.id = p.client_id
    where e.entry_date between p_from and p_to
    group by e.user_id, pr.username, c.name, p.name
    order by pr.username, c.name, p.name;
end $$;

create function public.team_entries(p_from date, p_to date)
returns table (user_id uuid, username text, entry_date date, start_time time, end_time time, client text, project text, task text, ticket text, imputable boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  return query
    select e.user_id, pr.username, e.entry_date, e.start_time, e.end_time, c.name, p.name, e.task, e.ticket, e.imputable
    from public.time_entries e
    join public.profiles pr on pr.id = e.user_id
    join public.projects p on p.id = e.project_id
    left join public.clients c on c.id = p.client_id
    where e.entry_date between p_from and p_to
    order by pr.username, e.entry_date, e.start_time;
end $$;

-- ===== Permisos de ejecución =====
revoke all on function public.current_role_name() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.my_day_totals(date, date) from public, anon;
revoke all on function public.admin_users() from public, anon;
revoke all on function public.team_hours(date, date) from public, anon;
revoke all on function public.team_entries(date, date) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.time_entries_guard() from public, anon, authenticated;
grant execute on function public.current_role_name() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_day_totals(date, date) to authenticated;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.team_hours(date, date) to authenticated;
grant execute on function public.team_entries(date, date) to authenticated;

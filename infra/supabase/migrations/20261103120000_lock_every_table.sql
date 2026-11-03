-- Lock every table (PLAN.md step 1.5, approved 3 November 2026; blueprint section 5).
--
-- Row-level security means a table shows each user only the rows its rules (policies)
-- allow, and nothing at all until rules are written. This migration makes it impossible
-- to have a table of ours without it:
--   1. every new table gets row-level security the moment it is created;
--   2. switching it off on a table is refused;
--   3. private.unprotected_tables() lists any table that still lacks it, for the checks
--      on every pull request and after every staging migration (it must always be empty).
--
-- "Ours" means every schema except Postgres's own and the ones Supabase manages itself.
-- The project-level "automatic row-level security" option doesn't reach tables made in
-- code (found on 3 November 2026), which is why this lives in a migration: staging and
-- production both get it the same way.
--
-- Based on Supabase's documented example (Event triggers: "Automatically enable Row Level
-- Security on new tables"), widened from `public` to all of our schemas, plus the refusal.

create schema if not exists private;
comment on schema private is
  'Internal functions and tables. Never exposed to the browser or the app.';
revoke all on schema private from public;

-- Schemas that are not ours: Postgres's own, and the ones Supabase manages.
create or replace function private.is_managed_schema(schema_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select schema_name = any (array[
           'information_schema', 'auth', 'storage', 'realtime', '_realtime',
           'supabase_functions', 'supabase_migrations', 'extensions', 'graphql',
           'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron',
           'pgbouncer', '_analytics', '_supavisor'
         ])
      or schema_name like 'pg\_%';
$$;

-- Every table of ours without row-level security. Must always be empty.
create or replace function private.unprotected_tables()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select format('%I.%I', n.nspname, c.relname)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and not private.is_managed_schema(n.nspname::text)
  order by 1;
$$;

-- Runs after every CREATE TABLE, CREATE TABLE AS, SELECT INTO and ALTER TABLE, and after
-- CREATE SCHEMA and CREATE EXTENSION, which can create tables inside themselves (each table
-- they create is listed as its own CREATE TABLE).
create or replace function private.lock_tables()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmd record;
  locked boolean;
begin
  for cmd in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is null or private.is_managed_schema(cmd.schema_name) then
      continue;
    end if;

    if cmd.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') then
      execute format('alter table %s enable row level security', cmd.object_identity);
    else
      select c.relrowsecurity into locked from pg_catalog.pg_class c where c.oid = cmd.objid;
      if locked is false then
        raise exception 'Row-level security must stay on for %', cmd.object_identity
          using hint = 'Every table keeps row-level security (blueprint section 5). '
                       'To let people read or change rows, write a policy instead.';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.is_managed_schema(text) from public;
revoke all on function private.unprotected_tables() from public;
revoke all on function private.lock_tables() from public;

drop event trigger if exists lock_new_tables;
create event trigger lock_new_tables
  on ddl_command_end
  when tag in (
    'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE',
    'CREATE SCHEMA', 'CREATE EXTENSION'
  )
  execute function private.lock_tables();

-- Any table of ours that already exists gets locked too (there are none on 3 November 2026).
do $$
declare
  t text;
begin
  for t in select table_name from private.unprotected_tables() loop
    execute format('alter table %s enable row level security', t);
  end loop;
end;
$$;

-- Tests for migrations/*_social.sql, who may call what (docs/social/build.md, D11 and section 4): the app's
-- role may run every function in schema social whose name doesn't start with an underscore, and no helper;
-- Supabase's roles run none and can't see social or intake; nobody but the owner may run an intake function; every
-- granted function runs as its owner, trusts no search path, takes only built-in types and answers jsonb. This
-- is a property, not a list, so a later relay's new function is held to it without editing this test. Run by
-- the Database check on every pull request against a fresh database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select is_empty(
  $$select p.oid::regprocedure::text || ' can''t be run by the app''s role'
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_'
      and not pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  'the app''s role may run every function in social whose name doesn''t start with an underscore'
);
select is_empty(
  $$select p.oid::regprocedure::text || ' is a helper the app''s role can run'
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.proname ~ '^_'
      and pg_catalog.has_function_privilege('hrizzup_app', p.oid, 'EXECUTE')$$,
  'and no helper (a name starting with an underscore)'
);
select ok(
  (select count(*) > 30 from pg_catalog.pg_proc p where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_'),
  'there are calls to hold to it (more than thirty)'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where p.pronamespace in ('social'::regnamespace, 'intake'::regnamespace)
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'Supabase''s own roles may run no function in social or intake'
);
select is_empty(
  $$select r.rolname || ' may run ' || p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    cross join pg_catalog.pg_roles r
    where p.pronamespace = 'keys'::regnamespace and p.proname in ('find', 'make_agent_key', 'agent_keys', 'revoke_agent_key', 'agent_key_view', 'guard_agent_key', '_owners_agent')
      and r.rolname in ('anon', 'authenticated', 'service_role')
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')$$,
  'nor any of the posting keys'' functions'
);
select is_empty(
  $$select r.rolname from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and (pg_catalog.has_schema_privilege(r.oid, 'social', 'USAGE') or pg_catalog.has_schema_privilege(r.oid, 'intake', 'USAGE'))$$,
  'and can''t even see social or intake'
);
select is_empty(
  $$select format('%s: %s on %s', a.grantee::regrole, a.privilege_type, p.oid::regprocedure)
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'intake'::regnamespace and a.grantee <> p.proowner$$,
  'nobody but the owner may run an intake function: not the app''s role, not Supabase''s, not everyone'
);
select is_empty(
  $$select format('%s: %s on %s', coalesce(a.grantee::regrole::text, 'everyone'), a.privilege_type, p.oid::regprocedure)
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace in ('social'::regnamespace, 'keys'::regnamespace) and a.grantee = 0$$,
  'no function in social or keys is open to everyone (the rights are named, never left at their default)'
);
select is_empty(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_'
      and not (p.prosecdef and p.proconfig @> array['search_path=""'])$$,
  'every granted function in social runs as its owner and trusts no search path'
);
select is_empty(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'intake'::regnamespace and not (p.prosecdef and p.proconfig @> array['search_path=""'])$$,
  'and so does every function in intake'
);
select is_empty(
  $$select p.oid::regprocedure::text || ' takes ' || t::regtype::text
    from pg_catalog.pg_proc p
    cross join lateral unnest(p.proargtypes::oid[]) t
    where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_'
      and t not in ('text'::regtype, 'text[]'::regtype, 'uuid'::regtype, 'bytea'::regtype, 'jsonb'::regtype,
                    'integer'::regtype, 'boolean'::regtype, 'timestamptz'::regtype)$$,
  'a granted function takes only built-in types (the app''s role can''t reach the agreement''s own)'
);
select is_empty(
  $$select p.oid::regprocedure::text || ' answers ' || p.prorettype::regtype::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_'
      and p.prorettype not in ('jsonb'::regtype, 'void'::regtype)$$,
  'and answers jsonb (the one call that answers nothing is job_end)'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc p
   where p.pronamespace = 'social'::regnamespace and p.proname !~ '^_' and p.prorettype = 'void'::regtype),
  array['job_end'],
  'only job_end answers nothing'
);
select is_empty(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname !~ '^_'$$,
  'no trigger function is a call: each starts with an underscore'
);

select * from finish();
rollback;

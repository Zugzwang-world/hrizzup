-- Tests for migrations/20261109114721_refuse_password_sessions.sql, the Custom Access Token
-- hook that refuses sessions made with a password (PLAN.md step 1.6a). Run by the "Database
-- check" on every pull request against a fresh database built from the migrations. Everything
-- runs in a transaction that is rolled back, so nothing is left behind.
--
-- Each event below has the shape Supabase Auth sends the hook: the session's claims and how it
-- was made (`authentication_method`; the migration lists what each sign-in arrives as).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(31);

-- An event as Supabase Auth builds it, for a session made (or refreshed) with `method`, whose
-- `amr` claim lists `amr` (the ways the session was first made).
create function pg_temp.event(method text, amr jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object(
      'uuid', '6f3b8f4a-0f6c-4a59-9c64-1b0c3a1f2f10',
      'time', '2026-11-09T10:15:00Z',
      'name', 'customize-access-token',
      'ip_address', '203.0.113.7'
    ),
    'user_id', '8ccaa7af-909f-44e7-84cb-67cdccb56be6',
    'claims', jsonb_build_object(
      'iss', 'https://example.supabase.co/auth/v1',
      'sub', '8ccaa7af-909f-44e7-84cb-67cdccb56be6',
      'aud', 'authenticated',
      'exp', 1793000000,
      'iat', 1792996400,
      'email', 'reader@example.com',
      'phone', '',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'user_metadata', '{}'::jsonb,
      'role', 'authenticated',
      'aal', 'aal1',
      'amr', amr,
      'session_id', 'a1b2c3d4-0000-4000-8000-000000000001',
      'is_anonymous', false
    ),
    'authentication_method', method
  );
$$;

create function pg_temp.made_with(method text) returns jsonb
language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('method', method, 'timestamp', 1792996400));
$$;

create function pg_temp.hook(event jsonb) returns jsonb
language sql as $$ select auth_hooks.refuse_password_sessions(event); $$;

-- What happens when `role_name` tries to run the hook: 'ran', or the error's SQLSTATE. The
-- role switch is undone with the attempt. (Supabase Auth's own role can't be taken here: the
-- tests run as `postgres`, which isn't a member of it, here or on Supabase.)
create function pg_temp.sqlstate_as(role_name text) returns text
language plpgsql as $$
begin
  execute format('set local role %I', role_name);
  perform auth_hooks.refuse_password_sessions('{"authentication_method": "otp", "claims": {}}'::jsonb);
  reset role;
  return 'ran';
exception when others then
  return sqlstate;
end;
$$;

-- The function is where Supabase Auth's settings will point.
select has_function(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'],
  'the hook exists as auth_hooks.refuse_password_sessions(jsonb)'
);
select function_returns(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'], 'jsonb',
  'the hook answers with jsonb, as Supabase Auth expects'
);

-- Every way in that isn't a password passes through unchanged.
select is(
  pg_temp.hook(pg_temp.event('otp', pg_temp.made_with('otp'))),
  pg_temp.event('otp', pg_temp.made_with('otp')),
  'an email code passes unchanged (and a new account''s first code, and the test accounts'' one-time tokens, which all arrive as otp)'
);
select is(
  pg_temp.hook(pg_temp.event('oauth', pg_temp.made_with('oauth'))),
  pg_temp.event('oauth', pg_temp.made_with('oauth')),
  'Google (oauth) passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('token_refresh', pg_temp.made_with('otp'))),
  pg_temp.event('token_refresh', pg_temp.made_with('otp')),
  'refreshing a session made with an email code passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('token_refresh', pg_temp.made_with('oauth'))),
  pg_temp.event('token_refresh', pg_temp.made_with('oauth')),
  'refreshing a session made with Google passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('token_refresh', pg_temp.made_with('otp') || pg_temp.made_with('oauth'))),
  pg_temp.event('token_refresh', pg_temp.made_with('otp') || pg_temp.made_with('oauth')),
  'refreshing a session made with a code and then linked to Google passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('email/signup', pg_temp.made_with('email/signup'))),
  pg_temp.event('email/signup', pg_temp.made_with('email/signup')),
  'email/signup (a sign-up confirmed through a link flow) passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('magiclink', pg_temp.made_with('magiclink'))),
  pg_temp.event('magiclink', pg_temp.made_with('magiclink')),
  'magiclink passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('recovery', pg_temp.made_with('recovery'))),
  pg_temp.event('recovery', pg_temp.made_with('recovery')),
  'recovery (a reset code) passes unchanged: it proves the email, not a password'
);
select ok(
  (select bool_and(pg_temp.hook(pg_temp.event(m, pg_temp.made_with(m))) = pg_temp.event(m, pg_temp.made_with(m)))
   from unnest(array[
     'invite', 'email_change', 'anonymous', 'sso/saml', 'web3', 'passkey', 'totp',
     'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code', 'oauth_provider/authorization_code'
   ]) as m),
  'every other way Supabase Auth names passes unchanged (none is on today, but none is a password)'
);
select is(
  pg_temp.hook(pg_temp.event('otp', '["otp"]'::jsonb)),
  pg_temp.event('otp', '["otp"]'::jsonb),
  'an amr claim written as plain strings passes unchanged'
);
select is(
  pg_temp.hook(pg_temp.event('otp', '[]'::jsonb) #- '{claims,amr}'),
  pg_temp.event('otp', '[]'::jsonb) #- '{claims,amr}',
  'a session with no amr claim passes unchanged'
);

-- A password is refused: Supabase Auth reads the error and answers 403 instead of a session.
select is(
  pg_temp.hook(pg_temp.event('password', pg_temp.made_with('password'))) -> 'error' -> 'http_code',
  '403'::jsonb,
  'a password sign-in is refused with 403'
);
select is(
  pg_temp.hook(pg_temp.event('password', pg_temp.made_with('password'))) #>> '{error,message}',
  'Passwords aren''t accepted. Sign in with an email code or with Google.',
  'the refusal says what to do instead'
);
select ok(
  not (pg_temp.hook(pg_temp.event('password', pg_temp.made_with('password'))) ? 'claims'),
  'a refused session carries no claims'
);
select is(
  pg_temp.hook(pg_temp.event('password', '[]'::jsonb)) -> 'error' -> 'http_code',
  '403'::jsonb,
  'a password sign-in is refused even if its amr claim were empty'
);

-- A session first made with a password (say, while the hook was switched off) is refused at
-- its next refresh.
select is(
  pg_temp.hook(pg_temp.event('token_refresh', pg_temp.made_with('password'))) -> 'error' -> 'http_code',
  '403'::jsonb,
  'refreshing a session made with a password is refused'
);
select is(
  pg_temp.hook(pg_temp.event('token_refresh', pg_temp.made_with('otp') || pg_temp.made_with('password'))) -> 'error' -> 'http_code',
  '403'::jsonb,
  'refreshing a session made with a code and a password is refused'
);
select is(
  pg_temp.hook(pg_temp.event('token_refresh', '["password"]'::jsonb)) -> 'error' -> 'http_code',
  '403'::jsonb,
  'refreshing a session whose amr claim names a password as a plain string is refused'
);

-- It can't raise an error, whatever it is given: an error would stop every sign-in.
select lives_ok(
  $$ select pg_temp.hook(x) from (values
       ('{}'::jsonb), ('null'::jsonb), ('[]'::jsonb), ('"password"'::jsonb),
       ('{"claims": "x"}'::jsonb), ('{"claims": {"amr": {"method": "password"}}}'::jsonb),
       ('{"claims": {"amr": [1, null, "x", {"method": null}]}}'::jsonb),
       ('{"authentication_method": 7}'::jsonb), (null::jsonb)
     ) as t(x) $$,
  'any input, however odd, gets an answer and never an error'
);

-- Only Supabase Auth's own role may run it, and use its schema.
select function_privs_are(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'], 'supabase_auth_admin', array['EXECUTE'],
  'Supabase Auth (supabase_auth_admin) may run the hook'
);
select function_privs_are(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'], 'anon', array[]::text[],
  'a visitor (anon) may not run the hook'
);
select function_privs_are(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'], 'authenticated', array[]::text[],
  'a signed-in person (authenticated) may not run the hook'
);
select function_privs_are(
  'auth_hooks', 'refuse_password_sessions', array['jsonb'], 'service_role', array[]::text[],
  'the server key''s role (service_role) may not run the hook'
);
select set_eq(
  $$ select coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC')
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'auth_hooks.refuse_password_sessions(jsonb)'::regprocedure
       and a.privilege_type = 'EXECUTE' $$,
  $$ select p.proowner::regrole::text
     from pg_catalog.pg_proc p
     where p.oid = 'auth_hooks.refuse_password_sessions(jsonb)'::regprocedure
     union select 'supabase_auth_admin' $$,
  'nobody else may run it: only its owner (the migrations) and Supabase Auth'
);
select schema_privs_are(
  'auth_hooks', 'supabase_auth_admin', array['USAGE'],
  'Supabase Auth can reach the hooks'' schema'
);
select schema_privs_are(
  'auth_hooks', 'anon', array[]::text[],
  'a visitor can''t reach the hooks'' schema'
);
select is(pg_temp.sqlstate_as('anon'), '42501', 'a visitor (anon) trying to run it is refused');
select is(
  pg_temp.sqlstate_as('authenticated'), '42501',
  'a signed-in person (authenticated) trying to run it is refused'
);
select is(
  pg_temp.sqlstate_as('service_role'), '42501',
  'the server key''s role (service_role) trying to run it is refused'
);

select * from finish();
rollback;

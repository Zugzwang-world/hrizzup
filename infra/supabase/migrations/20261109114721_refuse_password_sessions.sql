-- Refuse sessions made with a password (PLAN.md step 1.6a; founder's decision, 8 November
-- 2026; blueprint section 9).
--
-- Sign-in is by email code or Google only. Supabase can't switch passwords off while email
-- codes are on, and its password hook is on the Team plan only, so this function is
-- Supabase's Custom Access Token hook: Supabase Auth calls it every time it is about to
-- issue a session (a new sign-in or a refresh), and it refuses the session when it was made
-- with a password. Every other session passes through unchanged.
--
-- What Supabase Auth names each way in, in `authentication_method` (read from Supabase
-- Auth's own source, November 2026; the tests in tests/refuse_password_sessions.test.sql
-- prove each one):
--   password       a password sign-in                                      refused
--   otp            an email code, a new account's first code (sign-up),    passes
--                  and the test accounts' one-time tokens
--   oauth          Google
--   token_refresh  refreshing a session
-- A refresh carries the methods the session was first made with in its `amr` claim, so a
-- session made with a password (say, while this hook was switched off) is refused at its
-- next refresh too.
--
-- Kept tiny on purpose: if it ever errors, every sign-in fails. It reads no table, takes no
-- lock and can't raise an error for any input. Only Supabase Auth's own role
-- (supabase_auth_admin) may run it. It is switched on in Supabase Auth's settings
-- (infra/supabase/auth/settings.json), not here; this migration only creates it.

create schema if not exists auth_hooks;
comment on schema auth_hooks is
  'Functions Supabase Auth calls (auth hooks). Only Supabase Auth''s own role may use them.';
revoke all on schema auth_hooks from public;
grant usage on schema auth_hooks to supabase_auth_admin;

create or replace function auth_hooks.refuse_password_sessions(event jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when event ->> 'authentication_method' = 'password'
      or coalesce(event -> 'claims' -> 'amr', '[]'::jsonb) @> '[{"method": "password"}]'::jsonb
      or coalesce(event -> 'claims' -> 'amr', '[]'::jsonb) @> '["password"]'::jsonb
    then jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Passwords aren''t accepted. Sign in with an email code or with Google.'
      )
    )
    else event
  end;
$$;

comment on function auth_hooks.refuse_password_sessions(jsonb) is
  'Supabase Auth''s Custom Access Token hook: refuses a session made with a password, passes every other one unchanged (PLAN.md step 1.6a).';

-- Postgres lets everyone run a new function unless told otherwise, and a schema can't change
-- that default, so every function in auth_hooks revokes it explicitly, as here.
revoke all on function auth_hooks.refuse_password_sessions(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function auth_hooks.refuse_password_sessions(jsonb) to supabase_auth_admin;

-- API keys for bots (PLAN.md step 3.5a; docs/research/public-api.md, section 2.2; the Product
-- chat's decisions of 10 November 2026). Database changes land first: nothing calls these yet, and
-- the table stays empty until the code that uses it follows.
--
-- What this adds:
--   1. The keys (schema keys): each account's personal API keys, each read-only (`read`) or
--      trading (`trade`), with a name, when it was made and last used, and when it was revoked.
--      A key is stored only as the SHA-256 hash of its text, which the server makes from 32 random
--      bytes and shows once; the database keeps its first characters (`hz_demo_` and four more) so
--      the keys page can tell keys apart. A revoked key is never deleted, only marked revoked, and
--      can never come back.
--   2. Its functions, the only way in, granted to the app's role: keys.create, keys.list and
--      keys.revoke, for the signed-in account and never in a request a key signed (keys are made and
--      revoked only from a signed-in session, so a leaked key can't make another or hide itself);
--      keys.verify, which finds a live key by its hash. At most five live keys an account, and at
--      most ten new ones an hour, revoked ones included.
--   3. Every trade request records the key that placed it: markets.requests and perps.requests
--      gain api_key_id, null for the website and the app. The database stamps it itself, from the
--      transaction's own setting (`hrizzup.api_key`, which the server's database helper sets for a
--      request a key signed), and refuses the request unless that key is live, the account's own,
--      and a trading key. So leaderboards can tell bots from people (decision 16), as Manifold's
--      `isApi` does.
--
-- The keys work on staging only until launch: the server refuses them on production (PLAN.md,
-- "The public API"). The table is the same everywhere, as every migration is.

-- 1. The keys -----------------------------------------------------------------------------------------

create schema keys;
comment on schema keys is
  'Personal API keys for bots, stored only as hashes. Reached only through its functions.';
revoke all on schema keys from public;

create table keys.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  scope text not null,
  secret_hash bytea not null,
  shown text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_scope check (scope in ('read', 'trade')),
  constraint api_keys_name check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 60
    and name !~ '[[:cntrl:]]'
  ),
  constraint api_keys_hash check (pg_catalog.octet_length(secret_hash) = 32),
  constraint api_keys_shown check (shown ~ '^hz_(demo|live)_[A-Za-z0-9]{4}$'),
  constraint api_keys_used_after_made check (last_used_at is null or last_used_at >= created_at),
  constraint api_keys_revoked_after_made check (revoked_at is null or revoked_at >= created_at)
);
comment on table keys.api_keys is
  'Each account''s personal API keys: read-only (read) or trading (trade), stored only as the '
  'SHA-256 hash of the key''s text, shown once when made. Revoked keys stay, marked revoked.';
comment on column keys.api_keys.shown is
  'The key''s first characters (its environment''s prefix and four more), shown on the keys page '
  'so keys can be told apart. Not enough to use it.';
comment on column keys.api_keys.last_used_at is
  'When the key last signed a request, to the minute (keys.verify updates it at most once a minute).';
create unique index api_keys_by_hash on keys.api_keys (secret_hash);
create index api_keys_live_by_user on keys.api_keys (user_id, created_at desc)
  where revoked_at is null;
create index api_keys_by_user on keys.api_keys (user_id, created_at);

-- Only the last use and the revoking ever change, and a revoked key stays revoked.
create function keys.guard_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.name is distinct from old.name
     or new.scope is distinct from old.scope
     or new.secret_hash is distinct from old.secret_hash
     or new.shown is distinct from old.shown
     or new.created_at is distinct from old.created_at then
    raise exception 'A key''s name, scope and secret never change' using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked key stays revoked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger api_keys_guard
  before update on keys.api_keys
  for each row execute function keys.guard_key();

-- 2. Its functions ------------------------------------------------------------------------------------

-- The key that signed this request, if one did: the transaction's own setting, which the server's
-- database helper sets (SET LOCAL) for a request a key signed. Null for the website and the app.
create function keys.acting_key()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('hrizzup.api_key', true), '')::uuid
$$;

-- What the keys page and the API show of a key: never its hash. Times as the agreement writes them.
create function keys.view(k keys.api_keys)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', k.id,
    'name', k.name,
    'scope', k.scope,
    'shown', k.shown,
    'created_at', markets.utc(k.created_at),
    'last_used_at', markets.utc(k.last_used_at),
    'revoked_at', markets.utc(k.revoked_at)
  )
$$;

-- The signed-in account, for keys.create, keys.list and keys.revoke: refused when nobody is signed
-- in, and when a key signed the request.
create function keys.session_account()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  who uuid := auth.uid();
begin
  if who is null then
    raise exception 'Keys are for a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  if keys.acting_key() is not null then
    raise exception 'Keys are made, listed and revoked only when signed in, never with a key'
      using errcode = 'insufficient_privilege';
  end if;
  return who;
end;
$$;

-- A new key for the signed-in account. The server makes the key's text, shows it once and sends
-- only its hash and first characters. Refused (HZK01) when the account already holds five live
-- keys, and (HZK02) when it has made ten in the last hour, revoked ones included, with the seconds
-- until it may make another in the error's detail.
create function keys.create(name text, scope text, secret_hash bytea, shown text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  live integer;
  oldest timestamptz;
  made keys.api_keys;
begin
  if name is null or name <> pg_catalog.btrim(name) or pg_catalog.char_length(name) not between 1 and 60
     or name ~ '[[:cntrl:]]' then
    raise exception 'A key''s name is 1 to 60 characters, with no spaces at either end'
      using errcode = 'invalid_parameter_value';
  end if;
  if scope is null or scope not in ('read', 'trade') then
    raise exception 'A key is read or trade' using errcode = 'invalid_parameter_value';
  end if;
  if secret_hash is null or pg_catalog.octet_length(secret_hash) <> 32 then
    raise exception 'A key is stored as its SHA-256 hash' using errcode = 'invalid_parameter_value';
  end if;
  if shown is null or shown !~ '^hz_(demo|live)_[A-Za-z0-9]{4}$' then
    raise exception 'A key shows its prefix and four more characters'
      using errcode = 'invalid_parameter_value';
  end if;
  -- One account's keys are made one at a time, so the limits can't be raced past.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('keys.create:' || who::text, 0));
  select count(*) into live from keys.api_keys k where k.user_id = who and k.revoked_at is null;
  if live >= 5 then
    raise exception 'An account holds at most five live keys: revoke one first' using errcode = 'HZK01';
  end if;
  select min(k.created_at) into oldest
  from (
    select k.created_at from keys.api_keys k
    where k.user_id = who and k.created_at > pg_catalog.clock_timestamp() - interval '1 hour'
    order by k.created_at desc
    limit 10
  ) k
  having count(*) >= 10;
  if oldest is not null then
    raise exception 'At most ten new keys an hour: try again later' using errcode = 'HZK02',
      detail = greatest(1, ceil(extract(epoch from
        oldest + interval '1 hour' - pg_catalog.clock_timestamp())))::integer::text;
  end if;
  insert into keys.api_keys (user_id, name, scope, secret_hash, shown)
  values (who, name, scope, secret_hash, shown)
  returning * into made;
  return keys.view(made);
end;
$$;

-- The signed-in account's live keys, newest first (five at most).
create function keys.list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
begin
  return coalesce((
    select jsonb_agg(keys.view(k) order by k.created_at desc, k.id desc)
    from keys.api_keys k
    where k.user_id = who and k.revoked_at is null
  ), '[]'::jsonb);
end;
$$;

-- Revokes one of the signed-in account's live keys, at once: no such live key of theirs is
-- no_data_found. Answers the key as it now is, and its hash (hex), so the server can forget the
-- copy it keeps for a minute.
create function keys.revoke(key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  gone keys.api_keys;
begin
  update keys.api_keys k set revoked_at = pg_catalog.clock_timestamp()
  where k.id = key_id and k.user_id = who and k.revoked_at is null
  returning * into gone;
  if gone.id is null then
    raise exception 'No such live key of yours' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('key', keys.view(gone),
                            'secret_hash', pg_catalog.encode(gone.secret_hash, 'hex'));
end;
$$;

-- The live key with this hash: its ID, its account and its scope; null for none (never made, or
-- revoked). Notes when it was last used, at most once a minute. Asked with nobody signed in.
create function keys.verify(secret_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  found keys.api_keys;
begin
  select * into found from keys.api_keys k
  where k.secret_hash = verify.secret_hash and k.revoked_at is null;
  if found.id is null then
    return null;
  end if;
  if found.last_used_at is null or found.last_used_at < pg_catalog.clock_timestamp() - interval '1 minute' then
    update keys.api_keys k set last_used_at = pg_catalog.clock_timestamp()
    where k.id = found.id and k.revoked_at is null;
  end if;
  return jsonb_build_object('id', found.id, 'user_id', found.user_id, 'scope', found.scope);
end;
$$;

-- 3. Every trade request records the key that placed it -----------------------------------------------

alter table markets.requests add column api_key_id uuid;
comment on column markets.requests.api_key_id is
  'The API key that placed the request, or null for the website and the app. Stamped by the '
  'database itself (keys.stamp_request); kept even after the key is revoked or its account is gone.';
alter table perps.requests add column api_key_id uuid;
comment on column perps.requests.api_key_id is
  'The API key that placed the request, or null for the website and the app. Stamped by the '
  'database itself (keys.stamp_request); kept even after the key is revoked or its account is gone.';

-- Stamps each new trade request with the key that signed it, whatever the insert said, and refuses
-- the request unless that key is live, the account's own and a trading key.
create function keys.stamp_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting uuid := keys.acting_key();
begin
  new.api_key_id := acting;
  if acting is null then
    return new;
  end if;
  if not exists (
    select 1
    from keys.api_keys k
    join ledger.accounts a on a.user_id = k.user_id and a.kind = 'person'
    where k.id = acting
      and k.user_id = auth.uid()
      and a.id = new.account_id
      and k.revoked_at is null
      and k.scope = 'trade'
  ) then
    raise exception 'This key can''t trade: it is read-only, revoked or not this account''s'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger requests_stamp_key
  before insert on markets.requests
  for each row execute function keys.stamp_request();
create trigger requests_stamp_key
  before insert on perps.requests
  for each row execute function keys.stamp_request();

-- Who may call what ---------------------------------------------------------------------------------

revoke all on all tables in schema keys from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all functions in schema keys from public, anon, authenticated, service_role;
grant usage on schema keys to hrizzup_app;
grant execute on function keys.create(text, text, bytea, text) to hrizzup_app;
grant execute on function keys.list() to hrizzup_app;
grant execute on function keys.revoke(uuid) to hrizzup_app;
grant execute on function keys.verify(bytea) to hrizzup_app;

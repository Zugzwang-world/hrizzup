-- Tests for migrations/*_social_readers.sql, the reader agent's database (docs/social/r12-design.md, sections 2 and 6.1):
-- who may call, the state a reader with no row reads, the reader's own profile save and what it refuses, the chat's
-- reserve and settle (the neuron books to the exact decimal, with usage, without it, and for the stand-in), the
-- profile at settle (an edit from a moved profile is stale; one not in its stored form leaves the old profile),
-- retries and takeovers, each kind of failure, the reader's cap and the allowance's boundary, a call settled on its
-- own day, privacy between readers, paging, an account deleted, and For You's candidates. Today's allowance row is
-- shared by every reader in the file and the clock can't be moved, so the tests run in groups that each end with the
-- books checked, then the day's rows are reset. Run by the Database check on every pull request against a fresh
-- database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(139);

-- Today's allowance rows are shared by every reader in this file and the clock can't be moved, so a run never straddles the
-- turn of the UTC day: with under 60 seconds left of it, wait past 00:00 UTC.
do $$
declare
  left_seconds numeric := extract(epoch from (date_trunc('day', clock_timestamp() at time zone 'UTC') + interval '1 day') - (clock_timestamp() at time zone 'UTC'));
begin
  if left_seconds < 60 then
    perform pg_sleep(left_seconds + 1);
  end if;
end;
$$;

-- Runs one query as the app's own role, signed in as `account` (null: nobody), with `api_key` as the key that
-- signed the request (null: none), and gives back its one value as text.
create function pg_temp.as_app(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  perform set_config('request.jwt.claims',
    case when account is null then '{"role": "anon"}'
         else json_build_object('sub', account, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(account, ''), true);
  perform set_config('hrizzup.api_key', coalesce(api_key, ''), true);
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return answer;
end;
$$;

-- The SQLSTATE a query as the app's role fails with (the detail after a colon when it has one; the constraint
-- after a space when it names one), or 'ok'.
create function pg_temp.fails(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  detail text;
  cn text;
begin
  perform pg_temp.as_app(account, api_key, query);
  return 'ok';
exception when others then
  get stacked diagnostics detail = pg_exception_detail, cn = constraint_name;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate || coalesce(' ' || nullif(cn, ''), '') || case when sqlstate like 'HZ%' then coalesce(':' || nullif(detail, ''), '') else '' end;
end;
$$;

-- The same, with the detail after a colon whatever the SQLSTATE (for a refusal that says which field it means).
create function pg_temp.fails_detail(account text, api_key text, query text)
returns text
language plpgsql
as $$
declare
  detail text;
begin
  perform pg_temp.as_app(account, api_key, query);
  return 'ok';
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  reset role;
  perform set_config('hrizzup.api_key', '', true);
  return sqlstate || coalesce(':' || nullif(detail, ''), '');
end;
$$;

create function pg_temp.hash(n integer)
returns text
language sql
as $$ select '\x' || lpad(to_hex(n), 64, '0') $$;

create function pg_temp.req(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-' || lpad(n::text, 12, '0') $$;

-- Reader number n's account.
create function pg_temp.acct(n integer)
returns text
language sql
as $$ select '00000000-0000-4000-8000-0000000e0' || lpad(n::text, 3, '0') $$;

-- One call as reader n, as jsonb.
create function pg_temp.j(account text, query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(account, null, query)::jsonb $$;

create function pg_temp.rstate(n integer)
returns jsonb
language sql
as $$ select pg_temp.j(pg_temp.acct(n), 'select social.reader_state()::text') $$;

create function pg_temp.rsave(n integer, rq integer, body text)
returns jsonb
language sql
as $$ select pg_temp.j(pg_temp.acct(n), format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(rq), body)) $$;

create function pg_temp.rbegin(n integer, rq integer, body text)
returns jsonb
language sql
as $$ select pg_temp.j(pg_temp.acct(n), format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(rq), body)) $$;

create function pg_temp.rsettle(n integer, rq integer, body text, answer jsonb)
returns jsonb
language sql
as $$ select pg_temp.j(pg_temp.acct(n), format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(rq), body, answer::text)) $$;

create function pg_temp.rfail(n integer, rq integer, body text, kind text)
returns jsonb
language sql
as $$ select pg_temp.j(pg_temp.acct(n), format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(rq), body, kind)) $$;

-- The SQLSTATE and detail of a settle that is refused; `answer` is SQL text (so a non-object can be tried).
create function pg_temp.settle_fails(n integer, rq integer, body text, answer text)
returns text
language sql
as $$ select pg_temp.fails_detail(pg_temp.acct(n), null, format('select social.reader_chat_settle(%L, %L, %s)::text', pg_temp.req(rq), body, answer)) $$;

-- A provider's answer: tokens null when none are given.
create function pg_temp.ans(pt integer, ct integer, reply text, profile jsonb default null,
                            provider text default 'workers-ai', form text default 'json')
returns jsonb
language sql
as $$ select jsonb_build_object('provider', provider, 'prompt_tokens', pt, 'completion_tokens', ct, 'answer_form', form,
                                'reply', reply, 'profile', profile) $$;

-- A reading profile in its one stored form.
create function pg_temp.prof(more text[], less text[], fmts text[])
returns text
language sql
as $$
  select '# Reading profile'
    || E'\n\n## More of' || coalesce((select string_agg(E'\n- ' || x, '' order by o) from unnest(more) with ordinality t(x, o)), '')
    || E'\n\n## Less of' || coalesce((select string_agg(E'\n- ' || x, '' order by o) from unnest(less) with ordinality t(x, o)), '')
    || E'\n\n## Formats' || coalesce((select string_agg(E'\n- ' || x, '' order by o) from unnest(fmts) with ordinality t(x, o)), '')
$$;

-- A canonical profile whose last item is `len` characters: 2,000 characters in all for 54, 2,001 for 55 (otherwise clean).
create function pg_temp.big(len integer)
returns text
language sql
as $$
  select '# Reading profile' || E'\n\n## More of' || (select string_agg(E'\n- ' || repeat('a', 60), '') from generate_series(1, 20))
    || E'\n\n## Less of' || (select string_agg(E'\n- ' || repeat('b', 60), '') from generate_series(1, 10)) || E'\n- ' || repeat('c', len)
    || E'\n\n## Formats'
$$;

-- N items under one heading.
create function pg_temp.items(n integer, len integer default 5)
returns text
language sql
as $$ select coalesce(string_agg(E'\n- ' || lpad(i::text, len, 'x'), ''), '') from generate_series(1, n) i $$;

-- Today's row of the allowance and a reader's row for today, one column as a number.
create function pg_temp.ai(col text)
returns numeric
language plpgsql
as $$
declare
  v numeric;
begin
  execute format('select %I::numeric from social.ai_days where day = social._reader_today()', col) into v;
  return v;
end;
$$;

create function pg_temp.rd(n integer, col text)
returns numeric
language plpgsql
as $$
declare
  v numeric;
begin
  execute format('select %I::numeric from social.reader_days where user_id = %L and day = social._reader_today()', col, pg_temp.acct(n)) into v;
  return v;
end;
$$;

-- What the neuron books must satisfy at every commit: for each day, neurons_used is the sum of what the readers used that
-- day (settles and kept failures both add to the reader's day), and neurons_reserved is the sum of the open reservations
-- (the requests' pending markers); and no open marker is on a day with no row. The problems found, as text; none is right.
create function pg_temp.books()
returns text[]
language sql
as $$
  select coalesce(array_agg(msg order by msg), '{}'::text[]) from (
    select 'used ' || a.day || ': ' || a.neurons_used || ' against ' || coalesce(sum(d.neurons), 0) as msg
    from social.ai_days a left join social.reader_days d on d.day = a.day
    group by a.day, a.neurons_used
    having a.neurons_used is distinct from coalesce(sum(d.neurons), 0)
    union all
    select 'reserved ' || a.day || ': ' || a.neurons_reserved || ' against ' || coalesce(m.r, 0)
    from social.ai_days a
    left join (select (q.result -> 'pending' ->> 'day')::date as day, sum((q.result -> 'pending' ->> 'reserved')::numeric) as r
               from social.requests q where q.call = 'reader_chat' and q.result ? 'pending' group by 1) m on m.day = a.day
    where a.neurons_reserved is distinct from coalesce(m.r, 0)
    union all
    select 'marker with no day ' || m.day
    from (select distinct (q.result -> 'pending' ->> 'day')::date as day from social.requests q
          where q.call = 'reader_chat' and q.result ? 'pending') m
    where not exists (select 1 from social.ai_days a where a.day = m.day)
  ) x
$$;

-- Starts a fresh day for the next group: the reader agent's requests, days and allowance rows go, and the settings it
-- reads return to their defaults.
create function pg_temp.reset_day()
returns void
language plpgsql
as $$
begin
  delete from social.requests where call = 'reader_chat';
  delete from social.reader_days;
  delete from social.ai_days;
  update social.settings
  set reader_ai_provider = 'workers-ai', reader_ai_model = '@cf/meta/llama-3.2-3b-instruct',
      reader_ai_in_neurons_per_m = 4625, reader_ai_out_neurons_per_m = 30475,
      reader_ai_daily_neurons = 9000, reader_daily_messages = 20;
end;
$$;

-- What the tests keep to compare with later.
create temporary table memo_ (k text primary key, v jsonb) on commit drop;

-- People ----------------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.acct(n)::uuid, 'reader' || n || '@social-readers.test', now() from generate_series(1, 31) n;

-- 1. The columns and the helpers ----------------------------------------------------------------------------------------------

select has_column('social', 'ai_days', 'exhausted_at', 'ai_days has the new column');
select col_is_null('social', 'ai_days', 'exhausted_at', 'which is nullable: no row has to say anything');

select is(
  array[trim_scale(social._reader_most((select s from social.settings s)))::text, markets.utc(social._reader_day_end('2026-11-19')),
        social._reader_holds(pg_temp.prof('{AI}', '{}', '{}'))::text, social._reader_holds(pg_temp.prof('{}', '{}', '{}'))::text,
        social._reader_holds(null)::text],
  array['18.3925', '2026-11-20T00:00:00Z', 'true', 'false', 'false'],
  'one full reservation is 18.3925 at the default rates; a day ends at 00:00 UTC; a profile holds something only with an item'
);

-- _reader_profile_ok: the four parts. Accepts the examples' profile, the empty one, a 60-character item and 20 items;
-- refuses a 61-character item, 21 items, a missing heading, a final new line and a tab (and more).
select is(
  array[
    social._reader_profile_ok(E'# Reading profile\n\n## More of\n- AI\n- the Philippines\n\n## Less of\n- crypto\n\n## Formats\n- timelines\n- memes'),
    social._reader_profile_ok(pg_temp.prof('{}', '{}', '{}')),
    social._reader_profile_ok(pg_temp.prof(array[repeat('a', 60)], '{}', '{}')),
    social._reader_profile_ok(E'# Reading profile\n\n## More of' || pg_temp.items(20) || E'\n\n## Less of' || pg_temp.items(20) || E'\n\n## Formats' || pg_temp.items(20, 2)),
    social._reader_profile_ok(pg_temp.prof(array['भारत', 'Pilipinas ngayon'], '{}', '{}')),
    social._reader_profile_ok(pg_temp.prof(array[repeat('a', 61)], '{}', '{}')),
    social._reader_profile_ok(E'# Reading profile\n\n## More of' || pg_temp.items(21, 2) || E'\n\n## Less of\n\n## Formats'),
    social._reader_profile_ok(E'# Reading profile\n\n## More of\n\n## Less of\n\n## Formats' || pg_temp.items(21, 2)),
    social._reader_profile_ok(E'# Reading profile\n\n## More of\n- AI\n\n## Formats\n- memes'),
    social._reader_profile_ok(E'# Reading profile\n\n## Less of\n\n## More of\n\n## Formats'),
    social._reader_profile_ok(pg_temp.prof('{AI}', '{}', '{}') || E'\n'),
    social._reader_profile_ok(pg_temp.prof(array[E'A\tI'], '{}', '{}')),
    social._reader_profile_ok(pg_temp.prof(array['AI '], '{}', '{}')),
    social._reader_profile_ok(E'# Reading profile\n\n## More of\n-  AI\n\n## Less of\n\n## Formats'),
    social._reader_profile_ok(E'# Reading profile\n\n## More of\n- AI\n\n- ML\n\n## Less of\n\n## Formats'),
    social._reader_profile_ok(E'# Reading profile\n\n\n## More of\n\n## Less of\n\n## Formats'),
    social._reader_profile_ok(''),
    social._reader_profile_ok(null),
    social._reader_profile_ok(pg_temp.prof(array['a' || chr(8203) || 'b'], '{}', '{}')),
    social._reader_profile_ok(pg_temp.prof(array['a' || chr(8238) || 'b'], '{}', '{}')),
    social._reader_profile_ok(pg_temp.prof(array['a' || chr(57344) || 'b'], '{}', '{}'))
  ],
  array[true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  'a reading profile is in its stored form: accepted are the example, the empty profile, a 60-character item, 20 items a heading and other scripts; refused are 61 characters, 21 items, a missing or misplaced heading, a final new line, a tab, spaces at an end, a blank line inside a list, an empty text, nothing, and an item the agreement''s one_line refuses (a zero-width, a direction and a private-use character)'
);
select is(
  array[
    social._reader_profile_ok('# Reading profile' || E'\n\n## More of' || (select string_agg(E'\n- ' || repeat('a', 60), '') from generate_series(1, 20))
      || E'\n\n## Less of' || (select string_agg(E'\n- ' || repeat('b', 60), '') from generate_series(1, 10)) || E'\n- ' || repeat('c', 54) || E'\n\n## Formats'),
    social._reader_profile_ok('# Reading profile' || E'\n\n## More of' || (select string_agg(E'\n- ' || repeat('a', 60), '') from generate_series(1, 20))
      || E'\n\n## Less of' || (select string_agg(E'\n- ' || repeat('b', 60), '') from generate_series(1, 10)) || E'\n- ' || repeat('c', 55) || E'\n\n## Formats')
  ],
  array[true, false],
  'the whole profile is at most 2,000 characters: 2,000 is accepted, 2,001 is not'
);

-- _uuid7_after: version 7, the variant, and later than prev, even when prev is in the current millisecond or an hour ahead.
select is(
  (with prevs as (
     select social._uuid7_floor(clock_timestamp() + interval '1 hour') as prev
   ), made as (
     select prev, social._uuid7_after(prev) as m from prevs, generate_series(1, 20)
   )
   select array[count(*)::text, count(*) filter (where m > prev)::text, count(*) filter (where uuid_extract_version(m) = 7)::text,
                count(*) filter (where (get_byte(uuid_send(m), 8) & 192) = 128)::text,
                count(*) filter (where (('x' || lpad(substr(replace(m::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint)
                                    = (('x' || lpad(substr(replace(prev::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint) + 1)::text]
   from made),
  array['20', '20', '20', '20', '20'],
  '_uuid7_after a time an hour ahead: every ID is later, a version 7 with the variant, in the very next millisecond'
);
select is(
  (with p as (
     select encode(overlay(uuid_send('ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid)
                  placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 'hex')::uuid as prev
   ), t as (
     select prev, social._uuid7_after(prev) as m from p, generate_series(1, 200)
   )
   select array[count(*) filter (where m > prev)::text, count(*) filter (where uuid_extract_version(m) = 7)::text,
                count(*) filter (where (get_byte(uuid_send(m), 8) & 192) = 128)::text,
                (social._uuid7_after(null) is not null)::text]
   from t),
  array['200', '200', '200', 'true'],
  '_uuid7_after a prev with the biggest random part in the current millisecond: later than it every time, a version 7 with the variant; no prev gives an ID'
);

-- 2. Who may call ---------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.fails(null, null, 'select social.reader_state()::text'),
    pg_temp.fails(null, null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(1), pg_temp.prof('{}', '{}', '{}'))),
    pg_temp.fails(null, null, 'select social.reader_chat(null, 10)::text'),
    pg_temp.fails(null, null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), 'Hello')),
    pg_temp.fails(null, null, format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(1), 'Hello', '{}')),
    pg_temp.fails(null, null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Hello', 'kept'))
  ],
  array_fill('42501'::text, array[6]),
  'each of the six reader calls is refused (42501) with nobody signed in'
);
select is(
  array[
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), 'select social.reader_state()::text'),
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(1), pg_temp.prof('{}', '{}', '{}'))),
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), 'select social.reader_chat(null, 10)::text'),
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), 'Hello')),
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(1), 'Hello', '{}')),
    pg_temp.fails(pg_temp.acct(1), pg_temp.req(77), format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Hello', 'kept'))
  ],
  array_fill('42501'::text, array[6]),
  'and with an acting key, even of a signed-in account: readers are never served through a key'
);
select ok(
  pg_temp.j(null, 'select social.foryou_candidates()::text') ? 'stories',
  'For You''s candidates answer with nobody signed in (nothing personal in them)'
);

-- 3. State, with no row ---------------------------------------------------------------------------------------------------------

select is(
  pg_temp.rstate(1),
  jsonb_build_object(
    'profile', '', 'profile_number', 0, 'holds_something', false, 'profile_changed_at', null,
    'usage', jsonb_build_object('day', social._reader_today(), 'messages_today', 0, 'daily_messages', 20, 'messages_left_today', 20,
                                'paused_until', null, 'resets_at', markets.utc(social._reader_day_end(social._reader_today()))),
    'allowance', jsonb_build_object('neurons_used', '0', 'neurons_reserved', '0', 'daily_neurons', '9000', 'calls', 0)),
  'a signed-in reader with no row reads the defaults: no profile, 20 messages left, the day''s full allowance, not paused'
);
select is(
  (select (select count(*) from social.readers) + (select count(*) from social.reader_days) + (select count(*) from social.ai_days)
          + (select count(*) from social.requests where call like 'reader%')),
  0::bigint,
  'and reading made no row: not a reader, not a day, not a request'
);

-- 4. The reader's own save -------------------------------------------------------------------------------------------------------

select is(
  (select jsonb_build_object('profile', st -> 'profile', 'number', st -> 'profile_number', 'holds', st -> 'holds_something',
                             'changed', st ->> 'profile_changed_at' is not null)
   from (select pg_temp.rsave(1, 1, pg_temp.prof('{AI, the Philippines}', '{crypto}', '{timelines, memes}')) st) q),
  jsonb_build_object('profile', pg_temp.prof('{AI, the Philippines}', '{crypto}', '{timelines, memes}'), 'number', 1, 'holds', true, 'changed', true),
  'a profile in its stored form is saved: number 1, it holds something, and says when it changed'
);
select is(
  (select array[v.number::text, v.author, (v.body = pg_temp.prof('{AI, the Philippines}', '{crypto}', '{timelines, memes}'))::text] from social.reader_profile_versions v where v.user_id = pg_temp.acct(1)::uuid),
  array['1', 'reader', 'true'],
  'and its version 1 is kept, author reader'
);
select pg_temp.rsave(1, 2, pg_temp.prof('{AI, the Philippines}', '{crypto}', '{timelines, memes}'));
select pg_temp.rsave(1, 1, pg_temp.prof('{AI, the Philippines}', '{crypto}', '{timelines, memes}'));
select is(
  (select array[(select count(*) from social.reader_profile_versions v where v.user_id = pg_temp.acct(1)::uuid)::text,
                (select r.profile_number::text from social.readers r where r.user_id = pg_temp.acct(1)::uuid)]),
  array['1', '1'],
  'the same body again (a new request, and a replay of the first) writes no new version'
);
select is(
  pg_temp.fails(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(1), pg_temp.prof('{other}', '{}', '{}'))),
  'HZS27',
  'a request ID used with another body is refused (HZS27)'
);
select is(
  (select array[st ->> 'holds_something', st ->> 'profile_number'] from (select pg_temp.rsave(1, 3, pg_temp.prof('{}', '{}', '{}')) st) q),
  array['false', '2'],
  'the empty profile saves too, as version 2, and holds nothing'
);
select is(
  (select array[v.number::text, v.author] from social.reader_profile_versions v where v.user_id = pg_temp.acct(1)::uuid and v.number = 2),
  array['2', 'reader'],
  'its version 2 is kept, author reader'
);
select is(
  array[
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(10), E'# Reading profile\n\n## More of\n- AI\n\n## Formats\n- memes')),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(11), E'# Reading profile\n\n## Less of\n\n## More of\n\n## Formats')),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(12), pg_temp.prof(array[repeat('a', 61)], '{}', '{}'))),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(13), E'# Reading profile\n\n## More of' || pg_temp.items(21, 2) || E'\n\n## Less of\n\n## Formats')),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(14), pg_temp.big(55))),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(15), pg_temp.prof('{AI}', '{}', '{}') || E'\n')),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(16), pg_temp.prof(array[E'A\tI'], '{}', '{}'))),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(20), pg_temp.prof(array['a' || chr(8238) || 'b'], '{}', '{}'))),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(17), '')),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', pg_temp.req(18), null::text)),
    pg_temp.fails_detail(pg_temp.acct(1), null, format('select social.reader_save_profile(%L, %L)::text', null::text, pg_temp.prof('{}', '{}', '{}')))
  ],
  array['22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023:profile', '22023'],
  'a profile that isn''t in its stored form is refused (22023, detail profile, never the table''s check): a missing heading, headings out of order, 61 characters, 21 items, a clean 2,001 characters, a final new line, a tab, a direction character, an empty text, nothing; so is no request ID'
);
select is(
  (select array[r.profile_number::text, (select count(*) from social.reader_profile_versions v where v.user_id = r.user_id)::text]
   from social.readers r where r.user_id = pg_temp.acct(1)::uuid),
  array['2', '2'],
  'and a refused save writes nothing'
);
select is(
  (select array[st ->> 'profile_number', (char_length(st ->> 'profile'))::text] from (select pg_temp.rsave(1, 19, pg_temp.big(54)) st) q),
  array['3', '2000'],
  'a clean 2,000-character profile saves'
);

-- 5. The reserve, and a settle with usage ---------------------------------------------------------------------------------------

select pg_temp.reset_day();
select is(
  array[
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), null::text)),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), '')),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), repeat('a', 2001))),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), ' leading space')),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), E'trailing new line\n')),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), E'a\tb')),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), 'a' || chr(8203) || 'b')),
    pg_temp.fails_detail(pg_temp.acct(27), null, format('select social.reader_chat_begin(%L, %L)::text', null::text, 'Hello'))
  ],
  array['22023:body', '22023:body', '22023:body', '22023:body', '22023:body', '22023:body', '22023:body', '22023'],
  'a message that isn''t 1 to 2,000 characters of plain text (nothing, nothing at all, too long, a space or a new line at an end, a tab, a hidden character) is refused (22023, detail body); so is no request ID'
);
select is(
  (select array[(select count(*)::text from social.readers where user_id = pg_temp.acct(27)::uuid), (select count(*)::text from social.requests where actor = pg_temp.acct(27)::uuid),
                (select count(*)::text from social.ai_days), (select count(*)::text from social.reader_days)]),
  array['0', '0', '0', '0'],
  'and a refused message wrote nothing: no reader row, no request, no allowance, no day'
);
select is(
  (select array[b ->> 'state', b #>> '{call,reserved}', b -> 'ai' ->> 'provider', b -> 'ai' ->> 'model', b -> 'ai' ->> 'max_input_tokens',
                b -> 'ai' ->> 'max_output_tokens', b -> 'profile' ->> 'body', b -> 'profile' ->> 'number', b ->> 'history']
   from (select pg_temp.rbegin(2, 1, 'More cricket, no crypto') b) q),
  array['reserved', '18.3925', 'workers-ai', '@cf/meta/llama-3.2-3b-instruct', '2000', '300', '', '0', '[]'],
  'a message reserves: its answer holds the reservation, the model and its limits, the reader''s profile (none yet) and an empty history'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text, refused::text] from social.ai_days where day = social._reader_today()),
  array['18.3925', '0', '1', '0'],
  'the reservation is exactly 18.3925 of today''s allowance, with one call'
);
select is(
  (select array[messages::text, trim_scale(neurons)::text] from social.reader_days where user_id = pg_temp.acct(2)::uuid and day = social._reader_today()),
  array['1', '0'],
  'and the reader''s message slot is taken'
);
insert into memo_ select 'marker2', result -> 'pending' from social.requests where actor = pg_temp.acct(2)::uuid and request_id = pg_temp.req(1)::uuid;
select is(
  (select array[(v ->> 'day' = social._reader_today()::text)::text, v ->> 'reserved', v ->> 'in', v ->> 'out',
                (uuid_extract_version((v ->> 'message_id')::uuid))::text,
                ((v ->> 'lease_until')::timestamptz > clock_timestamp() and (v ->> 'lease_until')::timestamptz <= clock_timestamp() + interval '61 seconds')::text,
                ((v ->> 'started_at')::timestamptz <= clock_timestamp())::text]
   from memo_ where k = 'marker2'),
  array['true', '18.3925', '4625', '30475', '7', 'true', 'true'],
  'the request''s own row holds the reservation: its day, 18.3925, the rates, the message''s ID and a 60-second lease'
);
select is(
  (select array[s #>> '{usage,messages_today}', s #>> '{usage,messages_left_today}', s #>> '{allowance,neurons_reserved}', s #>> '{allowance,neurons_used}',
                s #>> '{allowance,calls}', s #>> '{allowance,daily_neurons}', (s #>> '{usage,paused_until}' is null)::text]
   from (select pg_temp.rstate(2) s) q),
  array['1', '19', '18.3925', '0', '1', '9000', 'true'],
  'and the reader''s page shows it: 19 messages left, 18.3925 reserved, not paused'
);

select is(
  (select array[st ->> 'state', st #>> '{answer,reply,neurons}', st #>> '{answer,message,body}', st #>> '{answer,reply,author}',
                st #>> '{answer,profile_changed}', st #>> '{answer,profile_number}', st #>> '{answer,holds_something}',
                st #>> '{answer,allowance,neurons_used}', st #>> '{answer,allowance,neurons_reserved}', st #>> '{answer,message,neurons}']
   from (select pg_temp.rsettle(2, 1, 'More cricket, no crypto',
           pg_temp.ans(600, 85, 'Done: more cricket and no crypto.',
                       jsonb_build_object('base_number', 0, 'body', pg_temp.prof('{cricket}', '{crypto}', '{}')))) st) q),
  array['done', '5.365375', 'More cricket, no crypto', 'agent', 'true', '1', 'true', '5.365375', '0', null],
  'settling 600 and 85 tokens uses exactly 5.365375 neurons, and answers both messages and the new profile'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text] from social.ai_days where day = social._reader_today()),
  array['0', '5.365375', '1'],
  'the allowance moved the reservation out and the 5.365375 in; its calls stay one'
);
select is(
  (select array[messages::text, trim_scale(neurons)::text] from social.reader_days where user_id = pg_temp.acct(2)::uuid and day = social._reader_today()),
  array['1', '5.365375'],
  'the reader''s day holds the same neurons; their slot stays taken'
);
select is(
  (select array[(select (r.id > m.id)::text from social.reader_messages r, social.reader_messages m
                 where r.user_id = pg_temp.acct(2)::uuid and r.author = 'agent' and m.user_id = pg_temp.acct(2)::uuid and m.author = 'reader'),
                (select (markets.utc(m.created_at) = (select v ->> 'started_at' from memo_ where k = 'marker2'))::text
                 from social.reader_messages m where m.user_id = pg_temp.acct(2)::uuid and m.author = 'reader'),
                (select trim_scale(r.neurons)::text from social.reader_messages r where r.user_id = pg_temp.acct(2)::uuid and r.author = 'agent'),
                (select count(*)::text from social.reader_messages m where m.user_id = pg_temp.acct(2)::uuid)]),
  array['true', 'true', '5.365375', '2'],
  'the reply sorts after the message, the message is dated from the reservation''s start, the reply carries its neurons'
);
select is(
  (select array[v.number::text, v.author, (v.body = pg_temp.prof('{cricket}', '{crypto}', '{}'))::text, r.holds_something::text, r.profile_number::text]
   from social.reader_profile_versions v join social.readers r on r.user_id = v.user_id where v.user_id = pg_temp.acct(2)::uuid),
  array['1', 'agent', 'true', 'true', '1'],
  'the profile edit is a version, author agent, number 1, and holds something'
);
select is(
  (select array[(result ? 'message_id')::text, (result ? 'pending')::text, (result::text like '%cricket%' or result::text like '%Done%')::text, result -> 'facts' ->> 'neurons',
                (result -> 'facts')::text]
   from social.requests where actor = pg_temp.acct(2)::uuid and request_id = pg_temp.req(1)::uuid),
  array['true', 'false', 'false', '5.365375',
        '{"neurons": "5.365375", "reserved": "18.3925", "provider": "workers-ai", "answer_form": "json", "prompt_tokens": 600, "completion_tokens": 85}'::jsonb::text],
  'what is remembered holds only IDs and facts, never the reader''s words'
);

-- Retries after a finished send: the same two messages, no new call
select is(
  (select array[b ->> 'state', (b #>> '{answer,message,id}' = (select r.id::text from social.reader_messages r where r.user_id = pg_temp.acct(2)::uuid and r.author = 'reader'))::text,
                (b #>> '{answer,reply,id}' = (select r.id::text from social.reader_messages r where r.user_id = pg_temp.acct(2)::uuid and r.author = 'agent'))::text]
   from (select pg_temp.rbegin(2, 1, 'More cricket, no crypto') b) q),
  array['done', 'true', 'true'],
  'a retry after the send finished answers the same two messages'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text] from social.ai_days where day = social._reader_today()),
  array['0', '5.365375', '1'],
  'and the books are unchanged: no second call'
);
select is(
  array[
    pg_temp.fails(pg_temp.acct(2), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), 'Another message')),
    pg_temp.rsettle(2, 1, 'More cricket, no crypto', pg_temp.ans(1, 1, 'Late')) ->> 'state',
    pg_temp.rfail(2, 1, 'More cricket, no crypto', 'kept') ->> 'state'
  ],
  array['HZS27', 'done', 'done'],
  'another body under the same request ID is refused (HZS27); settling or failing a finished send answers it, changing nothing'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text] from social.ai_days where day = social._reader_today()),
  array['0', '5.365375'],
  'and the books are still the same'
);

-- A change of rates during a call: settle uses the marker's own
select pg_temp.rbegin(5, 1, 'Hello');
update social.settings set reader_ai_in_neurons_per_m = 5000, reader_ai_out_neurons_per_m = 40000;
select is(
  pg_temp.rsettle(5, 1, 'Hello', pg_temp.ans(600, 85, 'Hi')) #>> '{answer,reply,neurons}',
  '5.365375',
  'settling uses the rates the call was reserved at, not the settings of that moment'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after these sends: used is what readers used, reserved is the open markers''');

-- 6. Without usage, and the stand-in ------------------------------------------------------------------------------------------

select pg_temp.reset_day();
select pg_temp.rbegin(6, 1, 'Hello');
select is(
  (select array[st ->> 'state', st #>> '{answer,reply,neurons}'] from (select pg_temp.rsettle(6, 1, 'Hello', pg_temp.ans(null, null, 'Hi', null, 'workers-ai', null)) st) q),
  array['done', '18.3925'],
  'settling without token counts keeps the whole reservation as used (no usage is not zero usage)'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(6)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['0', '18.3925', '18.3925'],
  'so the day used 18.3925 and the reader''s day too'
);
select is(
  (select (result -> 'facts')::text from social.requests where actor = pg_temp.acct(6)::uuid and request_id = pg_temp.req(1)::uuid),
  '{"neurons": "18.3925", "reserved": "18.3925", "provider": "workers-ai", "answer_form": null, "prompt_tokens": null, "completion_tokens": null}'::jsonb::text,
  'the facts say there was no usage (null, not 0)'
);
select pg_temp.rbegin(7, 1, 'Hello');
select is(
  (select array[st ->> 'state', st #>> '{answer,reply,neurons}'] from (select pg_temp.rsettle(7, 1, 'Hello', pg_temp.ans(0, 0, '(Stand-in) Nothing to change', null, 'stub', null)) st) q),
  array['done', '0'],
  'the stand-in''s explicit zeros use no neurons'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text] from social.ai_days where day = social._reader_today()),
  array['0', '18.3925'],
  'and its reservation goes back to nothing: the day''s used count is only reader 6''s'
);

-- A settle's answer is checked: every wrong shape is 22023 (detail answer), never a cast error, and writes nothing
select pg_temp.rbegin(8, 1, 'Hello');
select is(
  array[
    pg_temp.settle_fails(8, 1, 'Hello', 'null'),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'[]'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'"x"'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"prompt_tokens": 1, "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "Bad Provider", "prompt_tokens": 1, "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "prompt_tokens": 1, "completion_tokens": null, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "prompt_tokens": -1, "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "prompt_tokens": 1000001, "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "prompt_tokens": 1.5, "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "prompt_tokens": "600", "completion_tokens": 1, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "stub", "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "stub", "prompt_tokens": 1, "completion_tokens": 0, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "answer_form": "xml", "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "answer_form": 5, "reply": "Hi"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": ""}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": 5}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$jsonb_build_object('provider', 'workers-ai', 'reply', repeat('a', 2001))$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": " leading space"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "a\tb"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": "x"}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": {"base_number": -1, "body": "x"}}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": {"base_number": "a", "body": "x"}}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": {"base_number": 1.5, "body": "x"}}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": {"base_number": 0}}'::jsonb$a$),
    pg_temp.settle_fails(8, 1, 'Hello', $a$'{"provider": "workers-ai", "reply": "Hi", "profile": {"base_number": 0, "body": 5}}'::jsonb$a$)
  ],
  array_fill('22023:answer'::text, array[26]),
  'an answer that isn''t in the form settle takes is refused (22023, detail answer), whatever is wrong with it'
);
select is(
  (select array[(select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today()),
                (select (result ? 'pending')::text from social.requests where actor = pg_temp.acct(8)::uuid and request_id = pg_temp.req(1)::uuid),
                (select count(*)::text from social.reader_messages where user_id = pg_temp.acct(8)::uuid)]),
  array['18.3925', 'true', '0'],
  'and a refused answer wrote nothing: the reservation is open, no message is made'
);
select is(
  (select array[st ->> 'state', st #>> '{answer,reply,neurons}'] from (select pg_temp.rsettle(8, 1, 'Hello',
     pg_temp.ans(600, 85, 'Hi') || '{"a_new_fact": [1, 2], "provider_note": "ignored"}'::jsonb) st) q),
  array['done', '5.365375'],
  'a key settle doesn''t know is ignored, so a new fact needs no migration'
);
select is(
  (select (result -> 'facts')::text from social.requests where actor = pg_temp.acct(8)::uuid and request_id = pg_temp.req(1)::uuid),
  '{"neurons": "5.365375", "reserved": "18.3925", "provider": "workers-ai", "answer_form": "json", "prompt_tokens": 600, "completion_tokens": 85}'::jsonb::text,
  'and isn''t stored'
);

-- 7. The profile at settle -------------------------------------------------------------------------------------------------------

-- A profile moved since the model saw it: stale, and nothing is written
select pg_temp.rsave(9, 1, pg_temp.prof('{AI}', '{}', '{}'));
select pg_temp.rbegin(9, 2, 'Hello');
insert into memo_ select 'before9', jsonb_build_object('reserved', (select neurons_reserved from social.ai_days where day = social._reader_today()),
                                                        'used', (select neurons_used from social.ai_days where day = social._reader_today()),
                                                        'days', (select neurons from social.reader_days where user_id = pg_temp.acct(9)::uuid));
select is(
  pg_temp.rsettle(9, 2, 'Hello', pg_temp.ans(600, 85, 'Hi', jsonb_build_object('base_number', 0, 'body', pg_temp.prof('{AI, cricket}', '{}', '{}')))),
  jsonb_build_object('state', 'stale', 'profile', jsonb_build_object('body', pg_temp.prof('{AI}', '{}', '{}'), 'number', 1)),
  'an edit made from an older profile number is stale: the answer is the current profile and its number'
);
select is(
  (select array[(select count(*)::text from social.reader_messages where user_id = pg_temp.acct(9)::uuid),
                (select (result ? 'pending')::text from social.requests where actor = pg_temp.acct(9)::uuid and request_id = pg_temp.req(2)::uuid),
                (select r.profile_number::text from social.readers r where r.user_id = pg_temp.acct(9)::uuid),
                (select count(*)::text from social.reader_profile_versions where user_id = pg_temp.acct(9)::uuid),
                (jsonb_build_object('reserved', (select neurons_reserved from social.ai_days where day = social._reader_today()),
                                    'used', (select neurons_used from social.ai_days where day = social._reader_today()),
                                    'days', (select neurons from social.reader_days where user_id = pg_temp.acct(9)::uuid))
                 = (select v from memo_ where k = 'before9'))::text]),
  array['0', 'true', '1', '1', 'true'],
  'a stale settle writes nothing: no message, the marker stays, the profile and the allowance are unchanged'
);
select is(
  (select array[st ->> 'state', st #>> '{answer,profile_changed}', st #>> '{answer,profile_number}', (st #>> '{answer,profile}' = pg_temp.prof('{AI, cricket}', '{}', '{}'))::text,
                st #>> '{answer,profile_refused}']
   from (select pg_temp.rsettle(9, 2, 'Hello', pg_temp.ans(600, 85, 'Hi', jsonb_build_object('base_number', 1, 'body', pg_temp.prof('{AI, cricket}', '{}', '{}')))) st) q),
  array['done', 'true', '2', 'true', 'false'],
  'settled again from the current number, it is done: the profile moves to number 2, and was not refused'
);
select is(
  (select array[v.number::text, v.author] from social.reader_profile_versions v where v.user_id = pg_temp.acct(9)::uuid order by v.number desc limit 1),
  array['2', 'agent'],
  'and its version 2 is by the agent'
);

-- The profile's "holds something" is recomputed at settle; an equal profile changes nothing
select pg_temp.rsave(10, 1, pg_temp.prof('{AI}', '{}', '{}'));
select pg_temp.rbegin(10, 2, 'Remove AI');
select is(
  (select array[st #>> '{answer,profile_changed}', st #>> '{answer,holds_something}', st #>> '{answer,profile_number}']
   from (select pg_temp.rsettle(10, 2, 'Remove AI', pg_temp.ans(10, 10, 'Removed.', jsonb_build_object('base_number', 1, 'body', pg_temp.prof('{}', '{}', '{}')))) st) q),
  array['true', 'false', '2'],
  'an edit that empties the profile is a version too, and the profile then holds nothing'
);
select pg_temp.rsave(12, 1, pg_temp.prof('{AI}', '{}', '{}'));
select pg_temp.rbegin(12, 2, 'No change please');
select is(
  (select array[st #>> '{answer,profile_changed}', st #>> '{answer,profile_number}',
                (select count(*)::text from social.reader_profile_versions where user_id = pg_temp.acct(12)::uuid)]
   from (select pg_temp.rsettle(12, 2, 'No change please', pg_temp.ans(10, 10, 'Nothing to change.', jsonb_build_object('base_number', 1, 'body', pg_temp.prof('{AI}', '{}', '{}')))) st) q),
  array['false', '1', '1'],
  'a profile equal to the stored one is no change: no version, the number stays'
);

-- A profile that isn't in its stored form never raises: the old profile stays, the reply is saved, the books settle
select pg_temp.rbegin(11, 1, 'Hello');
select is(
  (select array[st ->> 'state', st #>> '{answer,profile_changed}', st #>> '{answer,profile_number}', st #>> '{answer,reply,neurons}', st #>> '{answer,reply,body}',
                st #>> '{answer,profile_refused}']
   from (select pg_temp.rsettle(11, 1, 'Hello', pg_temp.ans(600, 85, 'I tried.', jsonb_build_object('base_number', 0, 'body', 'More of: cricket'))) st) q),
  array['done', 'false', '0', '5.365375', 'I tried.', 'true'],
  'a profile edit that isn''t in its stored form leaves the old profile, saves the reply, settles the neurons and says the profile was refused'
);
select is(
  (select array[b ->> 'state', b #>> '{answer,profile_refused}', b #>> '{answer,profile_changed}'] from (select pg_temp.rbegin(11, 1, 'Hello') b) q),
  array['done', 'true', 'false'],
  'and a replay of that send says it too'
);
select is(
  (select array[r.profile, r.profile_number::text, (select count(*)::text from social.reader_profile_versions where user_id = r.user_id),
                (q.result -> 'facts' ->> 'profile_refused'), (q.result -> 'facts' ? 'profile_refused')::text,
                (select (q2.result -> 'facts' ? 'profile_refused')::text from social.requests q2 where q2.actor = pg_temp.acct(10)::uuid and q2.request_id = pg_temp.req(2)::uuid),
                (select trim_scale(neurons)::text from social.reader_days where user_id = r.user_id)]
   from social.readers r join social.requests q on q.actor = r.user_id and q.request_id = pg_temp.req(1)::uuid where r.user_id = pg_temp.acct(11)::uuid),
  array['', '0', '0', 'true', 'true', 'false', '5.365375'],
  'the old profile and its number stay, no version is made, and profile_refused is among the remembered facts (only then)'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the profile cases');

-- 8. Retries in flight, and a takeover after a crash: never a free retry ----------------------------------------------------------------

select pg_temp.reset_day();
select pg_temp.rbegin(13, 1, 'Hello');
select is(
  (select array[b ->> 'state', ((b ->> 'retry_after_seconds')::integer between 1 and 60)::text]
   from (select pg_temp.rbegin(13, 1, 'Hello') b) q),
  array['in_progress', 'true'],
  'a second try while the first is inside its lease is in progress, with the seconds to wait'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, calls::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(13)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['18.3925', '1', '1'],
  'and it reserved nothing more: one reservation, one call, one slot'
);
insert into memo_ select 'marker13', result -> 'pending' from social.requests where actor = pg_temp.acct(13)::uuid and request_id = pg_temp.req(1)::uuid;
update social.requests set result = jsonb_set(result, '{pending,lease_until}', '"2026-11-19T00:00:00Z"')
where actor = pg_temp.acct(13)::uuid and request_id = pg_temp.req(1)::uuid;
-- The settings move before the takeover, the rates too: the abandoned try is charged at its marker's R (18.3925), and the new
-- reservation is made at today's rates (2,000 x 5,000 + 300 x 40,000, times 0.000001, is 22).
update social.settings set reader_ai_model = '@cf/meta/another-model', reader_ai_in_neurons_per_m = 5000, reader_ai_out_neurons_per_m = 40000;
select pg_temp.rsave(13, 2, pg_temp.prof('{AI}', '{}', '{}'));
select is(
  (select array[b ->> 'state', b #>> '{call,reserved}', b #>> '{ai,model}', b #>> '{ai,provider}', (b #>> '{profile,body}' = pg_temp.prof('{AI}', '{}', '{}'))::text,
                b #>> '{profile,number}', b ->> 'history', (b #>> '{call,lease_until}' > markets.utc(clock_timestamp()))::text]
   from (select pg_temp.rbegin(13, 1, 'Hello') b) q),
  array['reserved', '22', '@cf/meta/another-model', 'workers-ai', 'true', '1', '[]', 'true'],
  'after the lease a retry is a new request: it reserves at today''s rates (22, not the marker''s 18.3925), with a new lease, the model and the profile read fresh'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(13)::uuid),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(13)::uuid),
                (select (v ->> 'message_id') <> (select m.v ->> 'message_id' from memo_ m where m.k = 'marker13') from (select result -> 'pending' v from social.requests
                  where actor = pg_temp.acct(13)::uuid and request_id = pg_temp.req(1)::uuid) x)::text,
                (select v ->> 'reserved' from (select result -> 'pending' v from social.requests where actor = pg_temp.acct(13)::uuid and request_id = pg_temp.req(1)::uuid) x)]
   from social.ai_days where day = social._reader_today()),
  array['22', '18.3925', '2', '2', '18.3925', 'true', '22'],
  'the abandoned try is charged as a kept failure (18.3925 from reserved into used, and into the reader''s day), its slot stays taken, and the retry makes a new reservation (22), a new slot (2 messages), a new call and a new message ID'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the takeover: used is the readers'' sum, reserved is the open marker');
select is(
  (select array[st ->> 'state', st #>> '{answer,reply,neurons}'] from (select pg_temp.rsettle(13, 1, 'Hello', pg_temp.ans(600, 85, 'Hi')) st) q),
  array['done', '6.4'],
  'the new call settles at its own marker''s rates: 600 x 5,000 + 85 x 40,000, times 0.000001, is 6.4'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text] from social.ai_days where day = social._reader_today()),
  array['0', '24.7925', '2'],
  'the day used the abandoned try''s 18.3925 and the answered call''s 6.4'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the new call settles');

-- A takeover when the reader is at their cap: refused, and the abandoned try is still charged
select pg_temp.reset_day();
update social.settings set reader_daily_messages = 1;
select pg_temp.rbegin(29, 1, 'Hello');
update social.requests set result = jsonb_set(result, '{pending,lease_until}', '"2026-11-19T00:00:00Z"')
where actor = pg_temp.acct(29)::uuid and request_id = pg_temp.req(1)::uuid;
select is(
  (select array[b ->> 'state', b ->> 'reason', b #>> '{view,usage,messages_left_today}'] from (select pg_temp.rbegin(29, 1, 'Hello') b) q),
  array['refused', 'daily_cap', '0'],
  'a retry after the lease, when the reader is at their cap, is refused as the cap: a takeover is never a free retry'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text, refused::text,
                (select messages::text from social.reader_days where user_id = pg_temp.acct(29)::uuid),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(29)::uuid),
                (select count(*)::text from social.requests where actor = pg_temp.acct(29)::uuid and request_id = pg_temp.req(1)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['0', '18.3925', '1', '0', '1', '18.3925', '0'],
  'the abandoned try is charged (18.3925 used, its slot stays taken), no new reservation is made (still one call), the cap''s refusal counts nothing, and the marker is gone'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the takeover at the cap');

-- A takeover when the allowance is spent: refused as such, counted, and the abandoned try is still charged
select pg_temp.reset_day();
select pg_temp.rbegin(30, 1, 'Hello');
update social.requests set result = jsonb_set(result, '{pending,lease_until}', '"2026-11-19T00:00:00Z"')
where actor = pg_temp.acct(30)::uuid and request_id = pg_temp.req(1)::uuid;
update social.settings set reader_ai_daily_neurons = 20;
select is(
  (select array[b ->> 'state', b ->> 'reason', ((b ->> 'retry_after_seconds')::integer between 1 and 86400)::text,
                (b ->> 'paused_until' = markets.utc(social._reader_day_end(social._reader_today())))::text]
   from (select pg_temp.rbegin(30, 1, 'Hello') b) q),
  array['refused', 'allowance_used', 'true', 'true'],
  'a retry after the lease, when the allowance is spent, is refused as the allowance used'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, calls::text, refused::text,
                (select messages::text from social.reader_days where user_id = pg_temp.acct(30)::uuid),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(30)::uuid),
                (select count(*)::text from social.requests where actor = pg_temp.acct(30)::uuid and request_id = pg_temp.req(1)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['0', '18.3925', '1', '1', '1', '18.3925', '0'],
  'the abandoned try is charged, the refusal is counted once, no new reservation is made (still one call) and the marker is gone'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the takeover with the allowance spent');

-- A takeover of a marker dated yesterday: yesterday is charged, today is reserved
select pg_temp.reset_day();
select pg_temp.rbegin(31, 1, 'Hello');
insert into social.ai_days (day, neurons_reserved, calls) values (social._reader_today() - 1, 18.3925, 1);
update social.ai_days set neurons_reserved = 0, calls = 0 where day = social._reader_today();
insert into social.reader_days (user_id, day, messages) values (pg_temp.acct(31)::uuid, social._reader_today() - 1, 1);
update social.reader_days set messages = 0 where day = social._reader_today();
update social.requests set result = jsonb_set(jsonb_set(result, '{pending,day}', to_jsonb((social._reader_today() - 1)::text)), '{pending,lease_until}', '"2026-11-19T00:00:00Z"')
where actor = pg_temp.acct(31)::uuid and request_id = pg_temp.req(1)::uuid;
select is(pg_temp.books(), '{}'::text[], 'a call made yesterday, past its lease: the books balance on both days');
select is(
  (select array[b ->> 'state', b #>> '{call,reserved}', (b #>> '{call,day}' = social._reader_today()::text)::text]
   from (select pg_temp.rbegin(31, 1, 'Hello') b) q),
  array['reserved', '18.3925', 'true'],
  'the retry reserves anew, on today''s date'
);
select is(
  (select array[(select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today() - 1), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today() - 1),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(31)::uuid and day = social._reader_today() - 1),
                (select messages::text from social.reader_days where user_id = pg_temp.acct(31)::uuid and day = social._reader_today() - 1),
                (select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today()), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today()),
                (select calls::text from social.ai_days where day = social._reader_today()),
                (select messages::text from social.reader_days where user_id = pg_temp.acct(31)::uuid and day = social._reader_today()),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(31)::uuid and day = social._reader_today())]),
  array['0', '18.3925', '18.3925', '1', '18.3925', '0', '1', '1', '0'],
  'yesterday is charged (18.3925 into used and the reader''s day there, its slot taken); today holds the new reservation, call and slot'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance on both days after the takeover across the turn of the day');

-- 9. Each kind of failure ---------------------------------------------------------------------------------------------------------

select pg_temp.reset_day();
select pg_temp.rbegin(14, 1, 'Hello');
select is(
  array[
    pg_temp.fails_detail(pg_temp.acct(14), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Hello', 'bogus')),
    pg_temp.fails_detail(pg_temp.acct(14), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Hello', null::text)),
    pg_temp.fails(pg_temp.acct(14), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Another body', 'kept')),
    pg_temp.fails(pg_temp.acct(14), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(2), 'Hello', 'kept')),
    pg_temp.fails(pg_temp.acct(14), null, format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(2), 'Hello', '{}'))
  ],
  array['22023:kind', '22023:kind', 'HZS27', 'P0002', 'P0002'],
  'a failure''s kind is released, exhausted or kept (22023, detail kind); another body is HZS27; nothing reserved under an ID is P0002, for a fail and for a settle'
);
select is(
  pg_temp.rfail(14, 1, 'Hello', 'released') #>> '{view,usage,messages_left_today}',
  '20',
  'released: the reader''s message slot is given back'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, calls::text, (select count(*)::text from social.requests where actor = pg_temp.acct(14)::uuid and request_id = pg_temp.req(1)::uuid),
                (select messages::text from social.reader_days where user_id = pg_temp.acct(14)::uuid), (exhausted_at is null)::text]
   from social.ai_days where day = social._reader_today()),
  array['0', '1', '0', '0', 'true'],
  'and the reservation comes back, the marker is gone (the request ID is free) and the day is not marked'
);
select is(pg_temp.rbegin(14, 1, 'Hello') ->> 'state', 'reserved', 'the same request ID tries again, and reserves');
select is(
  (select array[trim_scale(neurons_reserved)::text, calls::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(14)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['18.3925', '2', '1'],
  'with a new reservation: one more call, and the slot taken again'
);
select is(
  pg_temp.rfail(14, 1, 'Hello', 'kept') ->> 'state',
  'failed',
  'kept: it may have run'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(14)::uuid),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(14)::uuid),
                (select count(*)::text from social.requests where actor = pg_temp.acct(14)::uuid and request_id = pg_temp.req(1)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['0', '18.3925', '1', '18.3925', '0'],
  'the reservation counts as used (18.3925), the reader''s slot stays taken, and the marker is gone'
);
select pg_temp.rbegin(15, 1, 'Hello');
select is(
  (select array[st ->> 'state', st ->> 'kind', st #>> '{view,usage,messages_today}', (st #>> '{view,usage,paused_until}' is not null)::text,
                (abs((st ->> 'retry_after_seconds')::integer - ceil(extract(epoch from social._reader_day_end(social._reader_today()) - clock_timestamp()))) <= 2)::text]
   from (select pg_temp.rfail(15, 1, 'Hello', 'exhausted') st) q),
  array['failed', 'exhausted', '0', 'true', 'true'],
  'exhausted: the reservation and the slot come back, the reader''s page says chat is paused, and the answer says the seconds to 00:00 UTC on the database''s clock'
);
select is(
  (select array[trim_scale(neurons_reserved)::text, trim_scale(neurons_used)::text, (exhausted_at is not null)::text, refused::text]
   from social.ai_days where day = social._reader_today()),
  array['0', '18.3925', 'true', '0'],
  'today is marked exhausted; nothing else moved'
);
select is(
  (select array[b ->> 'state', b ->> 'reason', ((b ->> 'retry_after_seconds')::integer between 1 and 86400)::text,
                (b ->> 'paused_until' = markets.utc(social._reader_day_end(social._reader_today())))::text,
                (b #>> '{view,usage,paused_until}' = b ->> 'paused_until')::text]
   from (select pg_temp.rbegin(16, 1, 'Hello') b) q),
  array['refused', 'allowance_used', 'true', 'true', 'true'],
  'after that every begin is refused as the allowance used (no raise), until 00:00 UTC, and the page and the refusal say the same'
);
select is(
  (select array[refused::text, trim_scale(neurons_reserved)::text, calls::text, (select count(*)::text from social.reader_days where user_id = pg_temp.acct(16)::uuid),
                (select count(*)::text from social.requests where actor = pg_temp.acct(16)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['1', '0', '3', '0', '0'],
  'the refusal is counted (it committed) and reserved nothing: no slot, no marker'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the failures');

-- 10. The reader's cap, and the slot a failure keeps or gives back ---------------------------------------------------------------------

select pg_temp.reset_day();
update social.settings set reader_daily_messages = 2;
select pg_temp.rbegin(17, 1, 'One');
select pg_temp.rfail(17, 1, 'One', 'kept');
select pg_temp.rbegin(17, 2, 'Two');
select pg_temp.rfail(17, 2, 'Two', 'kept');
select is(
  (select array[b ->> 'state', b ->> 'reason', ((b ->> 'retry_after_seconds')::integer between 1 and 86400)::text,
                (b ->> 'resets_at' = markets.utc(social._reader_day_end(social._reader_today())))::text, b #>> '{view,usage,messages_left_today}']
   from (select pg_temp.rbegin(17, 3, 'Three') b) q),
  array['refused', 'daily_cap', 'true', 'true', '0'],
  'with a cap of 2, two messages that both failed "kept" still count: the third is refused as the reader''s cap'
);
select is(
  (select array[calls::text, refused::text, trim_scale(neurons_used)::text, trim_scale(neurons_reserved)::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(17)::uuid),
                (select count(*)::text from social.requests where actor = pg_temp.acct(17)::uuid and request_id = pg_temp.req(3)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['2', '0', '36.785', '0', '2', '0'],
  'the cap''s refusal writes nothing and counts no allowance refusal; what the two kept calls used is 36.785 (2 x 18.3925), the most one reader can use'
);
select pg_temp.rbegin(18, 1, 'One');
select pg_temp.rbegin(18, 2, 'Two');
select is(
  pg_temp.rbegin(18, 3, 'Three') ->> 'reason',
  'daily_cap',
  'two reserved messages (none settled yet) fill a cap of 2: the third is refused at once, counted when reserved'
);
select pg_temp.rfail(18, 2, 'Two', 'released');
select is(
  pg_temp.rbegin(18, 3, 'Three') ->> 'state',
  'reserved',
  'a released call gives its slot back: the third message then fits'
);
update social.settings set reader_daily_messages = 0;
select is(
  (select array[b ->> 'state', b ->> 'reason', b #>> '{view,usage,messages_left_today}'] from (select pg_temp.rbegin(19, 1, 'Hello') b) q),
  array['refused', 'daily_cap', '0'],
  'with a cap of 0 every send is refused as the reader''s cap, and reading still works'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the cap cases');

-- 11. The allowance, to the last decimal ------------------------------------------------------------------------------------------------------

select pg_temp.reset_day();
update social.settings set reader_ai_daily_neurons = 42.150375;
select is(pg_temp.rbegin(20, 1, 'One') ->> 'state', 'reserved', 'with 42.150375 for the day, the first reservation (18.3925) fits');
select is(pg_temp.rbegin(20, 2, 'Two') ->> 'state', 'reserved', 'and the second (0 + 18.3925 + 18.3925 = 36.785 fits)');
select is(
  (select array[(s #>> '{usage,paused_until}' is not null)::text] from (select pg_temp.rstate(20) s) q),
  array['true'],
  'the reader''s page already says paused: one more full reservation (55.1775) wouldn''t fit'
);
select is(
  (select array[b ->> 'state', b ->> 'reason', ((b ->> 'retry_after_seconds')::integer between 1 and 86400)::text,
                (b ->> 'paused_until' = markets.utc(social._reader_day_end(social._reader_today())))::text,
                (b #>> '{view,usage,paused_until}' = b ->> 'paused_until')::text]
   from (select pg_temp.rbegin(20, 3, 'Three') b) q),
  array['refused', 'allowance_used', 'true', 'true', 'true'],
  'the third is refused as the allowance used, with the seconds to 00:00 UTC, and the page agrees with it'
);
select is(
  (select array[refused::text, trim_scale(neurons_reserved)::text, calls::text, (select messages::text from social.reader_days where user_id = pg_temp.acct(20)::uuid)]
   from social.ai_days where day = social._reader_today()),
  array['1', '36.785', '2', '2'],
  'the refusal is counted once and reserved nothing (the third message took no slot)'
);
select pg_temp.rsettle(20, 1, 'One', pg_temp.ans(600, 85, 'Hi'));
select is(
  (select array[trim_scale(neurons_used)::text, trim_scale(neurons_reserved)::text] from social.ai_days where day = social._reader_today()),
  array['5.365375', '18.3925'],
  'after the first settles at 5.365375, 5.365375 is used and 18.3925 is still reserved'
);
select is(
  pg_temp.rbegin(20, 4, 'Four') ->> 'state',
  'reserved',
  'a new begin fits exactly at the boundary: 5.365375 + 18.3925 + 18.3925 = 42.150375 is equal, not over'
);
select is(
  (select array[b ->> 'state', b ->> 'reason'] from (select pg_temp.rbegin(20, 5, 'Five') b) q),
  array['refused', 'allowance_used'],
  'and the next is over it, and refused'
);
select is(
  (select array[refused::text, trim_scale(neurons_used)::text, trim_scale(neurons_reserved)::text, calls::text] from social.ai_days where day = social._reader_today()),
  array['2', '5.365375', '36.785', '3'],
  'the allowance counts two refusals, and the books are used 5.365375, reserved 36.785, three calls'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance after the allowance cases');

-- An admin lowers the daily neurons below what is used: paused at once, and a day with no row is judged the same way
update social.settings set reader_ai_daily_neurons = 1;
select is(
  (select (s #>> '{usage,paused_until}' is not null)::text from (select pg_temp.rstate(20) s) q),
  'true',
  'lowering the daily neurons below today''s use pauses chat at once'
);
select pg_temp.reset_day();
update social.settings set reader_ai_daily_neurons = 18;
select is(
  array[(select (s #>> '{usage,paused_until}' is not null)::text from (select pg_temp.rstate(20) s) q),
        pg_temp.rbegin(20, 6, 'Hello') ->> 'reason'],
  array['true', 'allowance_used'],
  'a day with no row, and a daily limit under one reservation (18 is under 18.3925), is paused: the page and begin agree'
);
select pg_temp.reset_day();
select is(
  (select (s #>> '{usage,paused_until}' is null)::text from (select pg_temp.rstate(20) s) q),
  'true',
  'at the default daily neurons a day with no row is not paused'
);

-- 12. A call settles on its own day ---------------------------------------------------------------------------------------------------------

select pg_temp.reset_day();
select pg_temp.rbegin(21, 1, 'Hello');
select pg_temp.rbegin(22, 1, 'Hello');
select pg_temp.rbegin(28, 1, 'Hello');
-- Make the three calls yesterday's: their reservations, slots and markers are moved to yesterday (as calls begun just before 00:00 UTC would be)
insert into social.ai_days (day, neurons_reserved, calls) values (social._reader_today() - 1, 55.1775, 3);
update social.ai_days set neurons_reserved = 0, calls = 0 where day = social._reader_today();
insert into social.reader_days (user_id, day, messages)
values (pg_temp.acct(21)::uuid, social._reader_today() - 1, 1), (pg_temp.acct(22)::uuid, social._reader_today() - 1, 1), (pg_temp.acct(28)::uuid, social._reader_today() - 1, 1);
update social.reader_days set messages = 0 where day = social._reader_today();
update social.requests set result = jsonb_set(result, '{pending,day}', to_jsonb((social._reader_today() - 1)::text)) where call = 'reader_chat';
select is(pg_temp.books(), '{}'::text[], 'three calls made yesterday: the books balance on both days');
select is(
  pg_temp.rsettle(21, 1, 'Hello', pg_temp.ans(600, 85, 'Hi')) ->> 'state',
  'done',
  'a call reserved yesterday settles today'
);
select is(
  (select array[(select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today() - 1), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today() - 1),
                (select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today()), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today()),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(21)::uuid and day = social._reader_today() - 1),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(21)::uuid and day = social._reader_today())]),
  array['36.785', '5.365375', '0', '0', '5.365375', '0'],
  'on yesterday''s rows only: yesterday''s reservation moved to used, today''s allowance and the reader''s day today untouched'
);
select is(
  pg_temp.rfail(22, 1, 'Hello', 'exhausted') ->> 'state',
  'failed',
  'a call reserved yesterday and failed as exhausted'
);
select is(
  (select array[(select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today() - 1), (select (exhausted_at is not null)::text from social.ai_days where day = social._reader_today() - 1),
                (select (exhausted_at is null)::text from social.ai_days where day = social._reader_today()),
                (select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today()),
                (select messages::text from social.reader_days where user_id = pg_temp.acct(22)::uuid and day = social._reader_today() - 1)]),
  array['18.3925', 'true', 'true', '0', '0'],
  'releases yesterday''s reservation and slot and marks yesterday, the call''s own day, as exhausted; the fresh day is not paused'
);
select is(
  (select (s #>> '{usage,paused_until}' is null)::text from (select pg_temp.rstate(22) s) q),
  'true',
  'and the reader''s page, which reads today, is not paused'
);
select is(
  pg_temp.rfail(28, 1, 'Hello', 'kept') ->> 'state',
  'failed',
  'a call reserved yesterday and failed as kept'
);
select is(
  (select array[(select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today() - 1), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today() - 1),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(28)::uuid and day = social._reader_today() - 1),
                (select messages::text from social.reader_days where user_id = pg_temp.acct(28)::uuid and day = social._reader_today() - 1),
                (select trim_scale(neurons_reserved)::text from social.ai_days where day = social._reader_today()), (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today()),
                (select trim_scale(neurons)::text from social.reader_days where user_id = pg_temp.acct(28)::uuid and day = social._reader_today()),
                (select count(*)::text from social.reader_days where day = social._reader_today() and neurons <> 0)]),
  array['0', '23.757875', '18.3925', '1', '0', '0', '0', '0'],
  'kept: yesterday''s reservation counts as used on yesterday''s allowance and the reader''s day there (the slot stays taken); today''s rows hold no neurons'
);
select is(pg_temp.books(), '{}'::text[], 'the books balance on both days after settling and failing across the turn of the day');

-- 13. Privacy between readers ---------------------------------------------------------------------------------------------------------------

select pg_temp.reset_day();
select pg_temp.rsave(23, 9, pg_temp.prof('{Alice''s secret topic}', '{}', '{}'));
select pg_temp.rbegin(23, 1, 'Alice''s private message');
select pg_temp.rsettle(23, 1, 'Alice''s private message', pg_temp.ans(600, 85, 'Alice''s private reply'));
-- Alice has a second message in flight (reserved, not yet settled)
select pg_temp.rbegin(23, 2, 'Alice''s second message');
insert into memo_ select 'alice', jsonb_build_object('reserved', (select neurons_reserved from social.ai_days where day = social._reader_today()),
                                                     'used', (select neurons_used from social.ai_days where day = social._reader_today()),
                                                     'calls', (select calls from social.ai_days where day = social._reader_today()),
                                                     'marker', (select result from social.requests where actor = pg_temp.acct(23)::uuid and request_id = pg_temp.req(2)::uuid));
select is(
  (select array[pg_temp.j(pg_temp.acct(24), 'select social.reader_chat(null, 100)::text') ->> 'messages',
                pg_temp.rstate(24) ->> 'profile', pg_temp.rstate(24) ->> 'holds_something']),
  array['[]', '', 'false'],
  'another reader''s chat and profile hold none of Alice''s: no function answers another reader''s rows'
);
select is(
  array[
    pg_temp.fails(pg_temp.acct(24), null, format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(1), 'Alice''s private message', pg_temp.ans(1, 1, 'x'))),
    pg_temp.fails(pg_temp.acct(24), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(1), 'Alice''s private message', 'kept')),
    pg_temp.fails(pg_temp.acct(24), null, format('select social.reader_chat_settle(%L, %L, %L::jsonb)::text', pg_temp.req(2), 'Alice''s second message', pg_temp.ans(1, 1, 'x'))),
    pg_temp.fails(pg_temp.acct(24), null, format('select social.reader_chat_fail(%L, %L, %L)::text', pg_temp.req(2), 'Alice''s second message', 'released'))
  ],
  array_fill('P0002'::text, array[4]),
  'settling or failing with Alice''s request IDs, the finished one and the one in flight, is P0002 for the other reader'
);
select is(
  jsonb_build_object('reserved', (select neurons_reserved from social.ai_days where day = social._reader_today()),
                     'used', (select neurons_used from social.ai_days where day = social._reader_today()),
                     'calls', (select calls from social.ai_days where day = social._reader_today()),
                     'marker', (select result from social.requests where actor = pg_temp.acct(23)::uuid and request_id = pg_temp.req(2)::uuid)),
  (select v from memo_ where k = 'alice'),
  'and it changed nothing of hers: her open reservation and the allowance are as they were'
);
select is(
  (select array[b ->> 'state', b ->> 'history', b #>> '{profile,body}']
   from (select pg_temp.rbegin(24, 1, 'Alice''s private message') b) q),
  array['reserved', '[]', ''],
  'another reader beginning with Alice''s request ID and body gets their own new reservation, and no history, no profile and no answer of hers'
);
select pg_temp.rsettle(24, 1, 'Alice''s private message', pg_temp.ans(600, 85, 'Bob''s reply'));
update social.requests
set result = jsonb_set(result, '{message_id}', to_jsonb((select m.id::text from social.reader_messages m where m.user_id = pg_temp.acct(23)::uuid and m.author = 'reader')))
where actor = pg_temp.acct(24)::uuid and request_id = pg_temp.req(1)::uuid;
select is(
  pg_temp.fails(pg_temp.acct(24), null, format('select social.reader_chat_begin(%L, %L)::text', pg_temp.req(1), 'Alice''s private message')),
  'P0002',
  'a stored result that pointed at Alice''s message is never answered to anyone else: the messages are read by the reader''s own ID'
);
-- A reader's history holds only their own last 10 messages, oldest first
insert into social.readers (user_id) values (pg_temp.acct(3)::uuid);
insert into social.reader_messages (id, user_id, author, body)
select format('019a6c00-0001-7000-8000-%s', lpad(i::text, 12, '0'))::uuid, pg_temp.acct(3)::uuid, case when i % 2 = 1 then 'reader' else 'agent' end, 'm' || i
from generate_series(1, 12) i;
insert into memo_ select 'begin3', pg_temp.rbegin(3, 1, 'Hello');
select is(
  (select array_agg(h ->> 'body' order by n) from memo_, jsonb_array_elements(v -> 'history') with ordinality t(h, n) where k = 'begin3'),
  array['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'],
  'the history is the reader''s last 10 messages, oldest first, and only their own'
);
select is(
  (select jsonb_agg(h -> 'author' order by n)::text from memo_, jsonb_array_elements(v -> 'history') with ordinality t(h, n) where k = 'begin3'),
  '["reader", "agent", "reader", "agent", "reader", "agent", "reader", "agent", "reader", "agent"]',
  'each with its author'
);

-- 14. Paging ---------------------------------------------------------------------------------------------------------------------------------

insert into social.readers (user_id) values (pg_temp.acct(25)::uuid);
insert into social.reader_messages (id, user_id, author, body)
select format('019a6c01-0000-7000-8000-%s', lpad(i::text, 12, '0'))::uuid, pg_temp.acct(25)::uuid, case when i % 2 = 1 then 'reader' else 'agent' end, 'Message ' || i
from generate_series(1, 105) i;
create function pg_temp.chat_pages(n integer, size integer)
returns text[]
language plpgsql
as $$
declare
  found_ids text[] := '{}';
  answer jsonb;
  after text := null;
  rounds integer := 0;
begin
  loop
    answer := pg_temp.j(pg_temp.acct(n), format('select social.reader_chat(%L, %s)::text', after, size));
    found_ids := found_ids || array(select m ->> 'id' from jsonb_array_elements(answer -> 'messages') m);
    after := answer ->> 'next';
    exit when after is null;
    rounds := rounds + 1;
    exit when rounds > 200;
  end loop;
  return found_ids;
end;
$$;
select is(
  pg_temp.chat_pages(25, 10),
  (select array_agg(m.id::text order by m.id desc) from social.reader_messages m where m.user_id = pg_temp.acct(25)::uuid),
  'paging 10 at a time, following next, shows every message once, newest first'
);
select is(
  (select array[jsonb_array_length(a -> 'messages')::text, (a ->> 'next' = (a -> 'messages' -> 9 ->> 'id'))::text]
   from (select pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, 10)::text') a) q),
  array['10', 'true'],
  'a page''s next is the last message''s ID'
);
select is(
  (select array[jsonb_array_length(pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, 0)::text') -> 'messages')::text,
                jsonb_array_length(pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, -5)::text') -> 'messages')::text,
                jsonb_array_length(pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, 1000)::text') -> 'messages')::text,
                jsonb_array_length(pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, null)::text') -> 'messages')::text,
                (pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, 105)::text') ->> 'next' is not null)::text,
                (pg_temp.j(pg_temp.acct(1), 'select social.reader_chat(null, 5)::text') -> 'messages')::text]),
  array['1', '1', '100', '20', 'true', '[]'],
  'the page size is kept to 1 to 100 (null gives 20); a reader with no messages gets an empty list'
);
select is(
  (select pg_temp.j(pg_temp.acct(25), 'select social.reader_chat(null, 1)::text') -> 'messages' -> 0),
  (select jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'neurons', null, 'created_at', markets.utc(m.created_at))
   from social.reader_messages m where m.user_id = pg_temp.acct(25)::uuid order by m.id desc limit 1),
  'a message is {id, author, body, neurons, created_at}'
);

select is(pg_temp.books(), '{}'::text[], 'the books balance after the privacy and paging groups');

-- 15. For You's candidates ----------------------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-readers.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
-- An agent that is registered and claimed by a new account; its first key's ID.
create function pg_temp.agent(n integer, handle text)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-readers.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, pg_temp.hash(n)));
  registered := pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)))::jsonb;
  perform pg_temp.as_app(account, null, format(
    'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  return registered -> 'key' ->> 'id';
end;
$$;
select pg_temp.agent(1, 'ada_bot');

create function pg_temp.sid(n integer)
returns text
language sql
as $$ select format('019a6c00-0000-7000-8000-%s', lpad((100000 + n)::text, 12, '0')) $$;

-- Saves a story and lists it (or not).
create function pg_temp.save_story(n integer, listed boolean default true)
returns void
language plpgsql
as $$
begin
  perform intake.save_story(jsonb_build_object('format', 'story/1', 'id', pg_temp.sid(n), 'title', 'Story number ' || n,
    'summary', 'What is happening in story ' || n || '.', 'locations', '["india"]'::jsonb, 'categories', '["ai"]'::jsonb,
    'state', 'live', 'created_at', '2026-11-17T08:00:00Z', 'updated_at', '2026-11-17T08:00:00Z'));
  perform social._list_story(pg_temp.sid(n)::uuid, listed, 'console', null);
end;
$$;
-- 301 listed live stories, one unlisted and one withdrawn.
select pg_temp.save_story(n) from generate_series(1, 301) n;
select pg_temp.save_story(302, false);
select pg_temp.save_story(303);
select intake.save_story(jsonb_build_object('format', 'story/1', 'id', pg_temp.sid(303), 'title', 'Story number 303', 'summary', 'Withdrawn.',
  'locations', '["india"]'::jsonb, 'categories', '["ai"]'::jsonb, 'state', 'withdrawn', 'withdrawn_reason', 'It was not true',
  'created_at', '2026-11-17T08:00:00Z', 'updated_at', '2026-11-17T09:00:00Z'));
select social._refresh_story(pg_temp.sid(303)::uuid);
-- Ranks with many ties, and the two stories that must stay out placed first.
update social.stories set top_rank = case story_id::text when pg_temp.sid(302) then 1000 when pg_temp.sid(303) then 999
                                          else (right(story_id::text, 6)::integer % 40) end;
-- Formats on one story's desk: a timeline twice, a meme, a post with none, and a removed explainer.
insert into social.posts (id, story_id, agent_id, kind, body, format, removed_at) values
  ('01a1a0e7-0000-7000-8000-0000000007a1', pg_temp.sid(5)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'A timeline', 'timeline', null),
  ('01a1a0e7-0000-7000-8000-0000000007a2', pg_temp.sid(5)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'Another timeline', 'timeline', null),
  ('01a1a0e7-0000-7000-8000-0000000007a3', pg_temp.sid(5)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'A meme', 'meme', null),
  ('01a1a0e7-0000-7000-8000-0000000007a4', pg_temp.sid(5)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'No format', null, null),
  ('01a1a0e7-0000-7000-8000-0000000007a5', pg_temp.sid(5)::uuid, (select id from social.agents where handle = 'ada_bot'), 'text', 'Removed', 'explainer', clock_timestamp());
create temporary table cands_ on commit drop as select pg_temp.j(null, 'select social.foryou_candidates()::text') as c;

select is(
  (select array[jsonb_array_length(c -> 'stories')::text, (select count(*)::text from jsonb_array_elements(c -> 'stories') e
                                                               where e ->> 'id' in (pg_temp.sid(302), pg_temp.sid(303)))] from cands_),
  array['300', '0'],
  'the candidates are at most 300 stories, and never an unlisted or a withdrawn one (even with the highest rank)'
);
select is(
  (select array_agg(e ->> 'id' order by n) from cands_, jsonb_array_elements(c -> 'stories') with ordinality t(e, n)),
  (select array_agg(story_id::text order by top_rank desc, story_id desc) from (
     select story_id, top_rank from social.stories where listed and state = 'live' order by top_rank desc, story_id desc limit 300) x),
  'in the board''s order: rank highest first, then story ID highest first'
);
select is(
  (select array_agg(e ->> 'top_rank' order by n) from cands_, jsonb_array_elements(c -> 'stories') with ordinality t(e, n) where n <= 5),
  array['39', '39', '39', '39', '39'],
  'each story carries its rank as text'
);
select is(
  (select jsonb_agg(e - 'top_rank' - 'formats' order by n) from cands_, jsonb_array_elements(c -> 'stories') with ordinality t(e, n) where n <= 100),
  social.board('top', null, null, null, 100) -> 'stories',
  'each story''s tile is the board''s own, picture included: the first 100 equal the board''s first 100'
);
select is(
  (select array[(select e -> 'formats' from cands_, jsonb_array_elements(c -> 'stories') e where e ->> 'id' = pg_temp.sid(5))::text,
                (select e -> 'formats' from cands_, jsonb_array_elements(c -> 'stories') e where e ->> 'id' = pg_temp.sid(6))::text]),
  array['["meme", "timeline"]', '[]'],
  'a story''s formats are its desk''s distinct formats (a removed post''s left out, a post with no format adds none); no posts is an empty list'
);
select is(
  (select array[c ->> 'half_life_hours', c ->> 'match_hours', c ->> 'format_hours', jsonb_array_length(c -> 'formats')::text,
                (c -> 'formats' -> 0)::text, (c -> 'formats' -> 7)::text, (c ->> 'as_of' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$')::text]
   from cands_),
  array['12', '24', '6', '8', '{"code": "breakdown", "name": "Breakdown"}', '{"code": "source-check", "name": "Source check"}', 'true'],
  'with the settings For You ranks by as text, and the formats in their order'
);
select is(
  pg_temp.j(pg_temp.acct(1), 'select social.foryou_candidates()::text') - 'as_of',
  (select c - 'as_of' from cands_),
  'a signed-in reader with a saved profile gets the same candidates as nobody does: nothing in the answer depends on who asks'
);

-- 16. The books at the end, and an account deleted --------------------------------------------------------------------------------------------------------

select is(pg_temp.books(), '{}'::text[], 'the books balance at the end of the file');

select pg_temp.reset_day();
select pg_temp.rsave(26, 9, pg_temp.prof('{AI}', '{}', '{}'));
select pg_temp.rbegin(26, 1, 'Hello');
select pg_temp.rsettle(26, 1, 'Hello', pg_temp.ans(600, 85, 'Hi', jsonb_build_object('base_number', 1, 'body', pg_temp.prof('{AI, cricket}', '{}', '{}'))));
select is(
  (select array[(select count(*) from social.readers where user_id = pg_temp.acct(26)::uuid)::text, (select count(*) from social.reader_profile_versions where user_id = pg_temp.acct(26)::uuid)::text,
                (select count(*) from social.reader_messages where user_id = pg_temp.acct(26)::uuid)::text, (select count(*) from social.reader_days where user_id = pg_temp.acct(26)::uuid)::text,
                (select count(*) from social.ai_days)::text]),
  array['1', '2', '2', '1', '1'],
  'a reader with a profile, two versions, two messages and a day''s use'
);
delete from auth.users where id = pg_temp.acct(26)::uuid;
select is(
  (select array[(select count(*) from social.readers where user_id = pg_temp.acct(26)::uuid)::text, (select count(*) from social.reader_profile_versions where user_id = pg_temp.acct(26)::uuid)::text,
                (select count(*) from social.reader_messages where user_id = pg_temp.acct(26)::uuid)::text, (select count(*) from social.reader_days where user_id = pg_temp.acct(26)::uuid)::text,
                (select count(*) from social.ai_days)::text,
                (select trim_scale(neurons_used)::text from social.ai_days where day = social._reader_today())]),
  array['0', '0', '0', '0', '1', '5.365375'],
  'deleting the account takes the reader''s profile, versions, messages and days with it; the allowance''s day stays, with what was used'
);

select * from finish();
rollback;

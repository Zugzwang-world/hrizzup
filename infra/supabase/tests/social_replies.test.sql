-- Tests for migrations/*_social_replies.sql, replies, upvotes, the inbox and the preview (docs/social/r7-design.md,
-- sections 2 and 6): the two writers (a reply and an upvote: their retries, callers, targets, merges, depth, the
-- hourly limit and fields), a thread read one level at a time and a batch of previews, the inbox and the check-in's
-- copy of it, the post preview (it writes nothing and refuses exactly what posting refuses), the recount's counts and
-- Top over rows these functions wrote, and the brief's open questions. Run by the Database check on every pull
-- request against a fresh database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(97);

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

-- The same as `fails`, with the message after ' | ' (for two calls that must refuse in the same words: the detail
-- stays only for a refusal of ours, as in `fails`, since Postgres's own details hold the failing row).
create function pg_temp.fails_message(account text, api_key text, query text)
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
  return sqlstate || coalesce(' ' || nullif(cn, ''), '') || case when sqlstate like 'HZ%' then coalesce(':' || nullif(detail, ''), '') else '' end
         || ' | ' || sqlerrm;
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

-- An agent that is registered (and claimed unless `claim` is false) by a new account; its first key's ID.
create function pg_temp.agent(n integer, handle text, house boolean default false, claim boolean default true)
returns text
language plpgsql
as $$
declare
  account text := '00000000-0000-4000-8000-00000000c' || lpad(n::text, 3, '0');
  email text := handle || '@social-replies.test';
  registered jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values (account::uuid, email, now());
  perform pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', null, format(
    'select social.admin_create_invite(%L, %L, null, %L, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(n * 10 + 1), email, house, pg_temp.hash(n)));
  registered := pg_temp.as_app(null, null, format(
    'select social.register_agent(%L::bytea, %L, %L, %L, null, null, null, %L::bytea, %L, %L::bytea)::text',
    pg_temp.hash(n), pg_temp.req(n * 10 + 2), handle, 'Agent ' || handle, pg_temp.hash(1000 + n),
    'hz_demo_K' || lpad(n::text, 3, '0'), pg_temp.hash(2000 + n)))::jsonb;
  if claim then
    perform pg_temp.as_app(account, null, format(
      'select social.claim_agent(%L, %L::bytea, %L)::text', pg_temp.req(n * 10 + 3), pg_temp.hash(2000 + n), 'Owner of ' || handle));
  end if;
  return registered -> 'key' ->> 'id';
end;
$$;

-- Request numbers for the calls a test doesn't retry.
create temporary sequence rq_seq start 7000;
create function pg_temp.rq()
returns integer
language sql
as $$ select nextval('rq_seq')::integer $$;

-- The labels of what the tests made: each answer, and the ID that matters in it (a post's or a reply's).
create temporary table ids_ (lbl text primary key, id text, answer jsonb) on commit drop;
create temporary table keys_ (who text primary key, key text) on commit drop;

create function pg_temp.key(w text)
returns text
language sql
as $$ select k.key from keys_ k where k.who = w $$;

create function pg_temp.idof(l text)
returns text
language sql
as $$ select i.id from ids_ i where i.lbl = l $$;

create function pg_temp.idsof(variadic lbls text[])
returns text[]
language sql
as $$ select coalesce(array_agg(pg_temp.idof(t.l) order by t.n), '{}') from unnest(lbls) with ordinality t(l, n) $$;

-- The IDs in a list of cards, in order.
create function pg_temp.ids(items jsonb)
returns text[]
language sql
as $$ select coalesce(array_agg(t.e ->> 'id' order by t.n), '{}') from jsonb_array_elements(items) with ordinality t(e, n) $$;

create function pg_temp.agent_id(handle text)
returns text
language sql
as $$ select a.id::text from social.agents a where a.handle = agent_id.handle $$;

-- A call as `who` (null: no key), answered as jsonb.
create function pg_temp.q(who text, query text)
returns jsonb
language sql
as $$ select pg_temp.as_app(null, pg_temp.key(who), query)::jsonb $$;

-- A post's text, by `who` on a story; the ID is kept under `lbl`. A little time passes first, so an ID made
-- later is always the larger (inside one millisecond the order of version-7 IDs is random).
create function pg_temp.post(lbl text, who text, story text, body text, sources text default 'null')
returns text
language plpgsql
as $$
declare
  answer jsonb;
begin
  perform pg_sleep(0.002);
  answer := pg_temp.q(who, format('select social.create_post(%L, %L, ''text'', %L, %s, null, null, null)::text',
    pg_temp.req(pg_temp.rq()), story, body, sources));
  insert into ids_ values (lbl, answer ->> 'id', answer);
  return answer ->> 'id';
end;
$$;

create function pg_temp.reply_sql(request integer, post text, parent text, intent text, body text, sources text default 'null')
returns text
language sql
as $$
  select format('select social.reply(%L, %L, %L, %L, %L, %s)::text', pg_temp.req(request), post, parent, intent, body, sources)
$$;

-- A reply by `who` to a labelled post, under a labelled reply or the post itself (null); kept under `lbl`.
create function pg_temp.reply(lbl text, who text, post_lbl text, parent_lbl text, intent text, body text,
                              sources text default 'null', request integer default null)
returns text
language plpgsql
as $$
declare
  answer jsonb;
begin
  perform pg_sleep(0.002);
  answer := pg_temp.q(who, pg_temp.reply_sql(coalesce(request, pg_temp.rq()), pg_temp.idof(post_lbl), pg_temp.idof(parent_lbl),
                                             intent, body, sources));
  insert into ids_ values (lbl, answer -> 'reply' ->> 'id', answer);
  return answer -> 'reply' ->> 'id';
end;
$$;

-- What a reply fails with: for IDs given as text.
create function pg_temp.reply_fails(who text, post text, parent text, intent text, body text, sources text default 'null')
returns text
language sql
as $$ select pg_temp.fails(null, pg_temp.key(who), pg_temp.reply_sql(pg_temp.rq(), post, parent, intent, body, sources)) $$;

-- A chain of `n` replies, each under the one before, the first under the post (or under `parent_lbl`); the labels
-- are the prefix and the number from 0. Ben and Ada take turns. The last label.
create function pg_temp.chain(prefix text, post_lbl text, n integer, parent_lbl text default null)
returns text
language plpgsql
as $$
declare
  last text := parent_lbl;
begin
  for i in 0 .. n - 1 loop
    perform pg_temp.reply(prefix || i, case when i % 2 = 0 then 'ben' else 'ada' end, post_lbl, last, 'add', 'Level ' || i);
    last := prefix || i;
  end loop;
  return last;
end;
$$;

create function pg_temp.up_sql(request integer, post text)
returns text
language sql
as $$ select format('select social.upvote(%L, %L)::text', pg_temp.req(request), post) $$;

create function pg_temp.up(who text, post_lbl text, request integer default null)
returns jsonb
language sql
as $$ select pg_temp.q(who, pg_temp.up_sql(coalesce(request, pg_temp.rq()), pg_temp.idof(post_lbl))) $$;

create function pg_temp.thread(post_lbl text, parent_lbl text default null, cursor_lbl text default null,
                               size integer default 20, nested integer default 0)
returns jsonb
language sql
as $$
  select pg_temp.q(null, format('select social.thread(%L, %L, %L, %L, %L)::text',
    pg_temp.idof(post_lbl), pg_temp.idof(parent_lbl), pg_temp.idof(cursor_lbl), size, nested))
$$;

-- Every top-level reply of a post, page by page with `size`, following each answer's `next`: the IDs in order,
-- and each page's `next` ('-' for none).
create function pg_temp.thread_walk(post_lbl text, size integer)
returns jsonb
language plpgsql
as $$
declare
  seen text[] := '{}';
  nexts text[] := '{}';
  cur text := null;
  answer jsonb;
  rounds integer := 0;
begin
  loop
    answer := pg_temp.q(null, format('select social.thread(%L, null, %L, %L, 0)::text', pg_temp.idof(post_lbl), cur, size));
    seen := seen || pg_temp.ids(answer -> 'replies');
    nexts := nexts || coalesce(answer ->> 'next', '-');
    cur := answer ->> 'next';
    exit when cur is null;
    rounds := rounds + 1;
    exit when rounds > 20;
  end loop;
  return jsonb_build_object('ids', to_jsonb(seen), 'nexts', to_jsonb(nexts));
end;
$$;

create function pg_temp.inbox(who text, cursor_lbl text default null, size integer default 20)
returns jsonb
language sql
as $$ select pg_temp.q(who, format('select social.inbox(%L, %L)::text', pg_temp.idof(cursor_lbl), size)) $$;

create function pg_temp.checkin_inbox(who text, size integer default 20)
returns jsonb
language sql
as $$ select pg_temp.q(who, format('select social.checkin_inbox(%L)::text', size)) $$;

create function pg_temp.preview_sql(story text, kind text, body text, sources text default 'null', fmt text default null,
                                    after_update text default null, media text default null)
returns text
language sql
as $$ select format('select social.preview_post(%L, %L, %L, %s, %L, %L, %L)::text', story, kind, body, sources, fmt, after_update, media) $$;

create function pg_temp.post_sql(story text, kind text, body text, sources text default 'null', fmt text default null,
                                 after_update text default null, media text default null)
returns text
language sql
as $$ select format('select social.create_post(%L, %L, %L, %L, %s, %L, %L, %L)::text', pg_temp.req(pg_temp.rq()), story, kind, body, sources, fmt, after_update, media) $$;

-- What previewing a post and posting it each fail with (or 'ok'), message included, as the same agent: [preview, post].
create function pg_temp.parity(who text, story text, kind text, body text, sources text, fmt text, after_update text, media text)
returns text[]
language sql
as $$
  select array[
    pg_temp.fails_message(null, pg_temp.key(who), pg_temp.preview_sql(story, kind, body, sources, fmt, after_update, media)),
    pg_temp.fails_message(null, pg_temp.key(who), pg_temp.post_sql(story, kind, body, sources, fmt, after_update, media))]
$$;

-- A version-7 ID made at `t` (the time in its first 48 bits, the rest fixed).
create function pg_temp.uuid7_at(t timestamptz)
returns uuid
language sql
as $$
  select (substr(h.hex, 1, 8) || '-' || substr(h.hex, 9, 4) || '-7000-8000-00000000000a')::uuid
  from (select lpad(to_hex(floor(extract(epoch from t) * 1000)::bigint), 12, '0') as hex) h
$$;

create function pg_temp.sid(n integer)
returns text
language sql
as $$ select '019a6c00-0000-7000-8000-0000000006' || lpad(n::text, 2, '0') $$;

create function pg_temp.save_story(n integer, state text default 'live', merged_into text default null, updated text default '2026-11-17T10:00:00Z')
returns void
language sql
as $$
  select intake.save_story(jsonb_strip_nulls(jsonb_build_object('format', 'story/1', 'id', pg_temp.sid(n), 'title', 'Story number ' || n,
    'summary', 'What is happening.', 'locations', '["global"]'::jsonb, 'categories', '["general"]'::jsonb, 'state', state,
    'merged_into', merged_into, 'withdrawn_reason', case when state = 'withdrawn' then 'It was not true' end,
    'created_at', '2026-11-17T10:00:00Z', 'updated_at', updated)))
$$;

create function pg_temp.save_update(id text, story_n integer, at text)
returns void
language sql
as $$
  select intake.save_update(jsonb_build_object('format', 'update/1', 'id', id, 'story_id', pg_temp.sid(story_n),
    'headline', 'A development in story ' || story_n, 'reported_at', at,
    'sources', jsonb_build_array('https://example.com/a'), 'state', 'live', 'created_at', at, 'updated_at', at))
$$;

-- People, stories and what the later tests need ------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-replies.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');
insert into keys_
select 'ada', pg_temp.agent(1, 'ada_bot')
union all select 'ben', pg_temp.agent(2, 'ben_bot')
union all select 'cyd', pg_temp.agent(3, 'cyd_bot')
union all select 'hub', pg_temp.agent(4, 'hub_bot', true)
union all select 'wait', pg_temp.agent(5, 'wait_bot', false, false)
union all select 'ret', pg_temp.agent(6, 'ret_bot')
union all select 'lim', pg_temp.agent(7, 'lim_bot')
union all select 'iva', pg_temp.agent(8, 'iva_bot')
union all select 'ivb', pg_temp.agent(9, 'ivb_bot')
union all select 'ivc', pg_temp.agent(10, 'ivc_bot')
union all select 'cta', pg_temp.agent(11, 'cta_bot')
union all select 'ctb', pg_temp.agent(12, 'ctb_bot')
union all select 'ctc', pg_temp.agent(13, 'ctc_bot');
-- Ada's own trading key (a posting key is the only one that may act as an agent).
select ledger.open_account('00000000-0000-4000-8000-00000000c001', 1000);
select pg_temp.as_app('00000000-0000-4000-8000-00000000c001', null, format(
  'select keys.create(%L, %L, %L::bytea, %L)::text', 'Trading bot', 'trade', pg_temp.hash(5001), 'hz_demo_T001'));
insert into keys_ values ('trade', pg_temp.as_app(null, null, format('select keys.find(%L::bytea)::text', pg_temp.hash(5001)))::jsonb ->> 'id');

-- Stories: 1 (two updates), 2 (another, to merge into), 3 (merged into 2 once its post is made), 4 (withdrawn once its
-- posts are made), 5 (live, unlisted, for the done-test's sequence), 6 (never listed by social, two updates), 7 and 8
-- (for the counts, the brief and Top).
select pg_temp.save_story(n) from generate_series(1, 8) n;
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a1', 1, '2026-11-17T10:05:00Z');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a2', 1, '2026-11-17T10:30:00Z');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a3', 2, '2026-11-17T10:10:00Z');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a5', 5, '2026-11-17T10:05:00Z');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a6', 6, '2026-11-17T10:05:00Z');
select pg_temp.save_update('019a6c00-0000-7000-8000-0000000007a7', 6, '2026-11-17T10:20:00Z');
select social._list_story(pg_temp.sid(5)::uuid, false, 'console', null);

-- The done-test's sequence: an unlisted live story, default settings ---------------------------------------------------------------------

select pg_temp.post('a_post', 'ada', pg_temp.sid(5), 'A first take.', 'array[''https://example.com/a'']');
select pg_temp.post('b_post', 'ben', pg_temp.sid(5), 'A later take.');
select pg_temp.reply('b_ask', 'ben', 'a_post', null, 'ask', 'What is the source?');
select pg_temp.reply('a_ans', 'ada', 'a_post', 'b_ask', 'answer', 'It is linked above.', 'array[''https://example.com/a'']');
select pg_temp.up('ben', 'a_post');
create temporary table done_recount on commit drop as
select pg_temp.as_app(null, null, format('select social.job_recount(%L, null)::text', now() - interval '1 hour'))::jsonb as answer;
select is(
  (select array[p.replies, p.upvotes] from social.posts p where p.id = pg_temp.idof('a_post')::uuid),
  array[2, 1],
  'the done-test: after the recount, the first post has 2 replies (the ask and its answer) and 1 upvote'
);
select is(
  (select array[p.replies, p.upvotes] from social.posts p where p.id = pg_temp.idof('b_post')::uuid),
  array[0, 0],
  'and the later post 0 and 0'
);
select is(
  array[(select (answer -> 'posts') @> to_jsonb(array[pg_temp.idof('a_post'), pg_temp.idof('b_post')]) from done_recount),
        (select (answer -> 'stories') @> to_jsonb(array[pg_temp.sid(5)]) from done_recount)],
  array[true, true],
  'the recount answers the posts and the story it counted, for the purge'
);
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.desk(%L, ''top'', null, 10)::text', pg_temp.sid(5))) -> 'posts'),
  pg_temp.idsof('a_post', 'b_post'),
  'Top lists the post with replies first, though it is the older'
);
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.desk(%L, ''latest'', null, 10)::text', pg_temp.sid(5))) -> 'posts'),
  pg_temp.idsof('b_post', 'a_post'),
  'and Latest lists the newer first'
);
select is(
  array[pg_temp.ids(pg_temp.inbox('ada') -> 'replies')::text, pg_temp.ids(pg_temp.inbox('ben') -> 'replies')::text],
  array[pg_temp.idsof('b_ask')::text, pg_temp.idsof('a_ans')::text],
  'the inbox of the first agent lists the second''s ask, and the second''s lists the first''s answer'
);
select is(
  array[pg_temp.ids(pg_temp.checkin_inbox('ada') -> 'replies')::text, pg_temp.checkin_inbox('ada') ->> 'more'],
  array[pg_temp.idsof('b_ask')::text, 'false'],
  'and the check-in''s inbox of the first agent holds the second''s reply, with nothing more'
);
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.brief_data(%L)::text', pg_temp.sid(5))) -> 'open_questions'),
  '{}'::text[],
  'the brief''s open questions don''t hold the ask: its answer is under it'
);
select is(
  (select array[pg_temp.q('ada', pg_temp.preview_sql(pg_temp.sid(5), 'text', 'A take with no sources.')) -> 'card' -> 'sources',
                pg_temp.q('ada', pg_temp.preview_sql(pg_temp.sid(5), 'text', 'A take with no sources.')) -> 'card' -> 'id']),
  array['[]'::jsonb, 'null'::jsonb],
  'a preview with no sources answers a card with an empty list of sources and no ID (the warning itself is the website''s)'
);

-- Who may call what, and the lock ---------------------------------------------------------------------------------------------------

select is_empty(
  $$select f.sig || ' can''t be run by the app''s role'
    from (values ('social.reply(uuid,uuid,uuid,text,text,text[])'), ('social.upvote(uuid,uuid)'),
                 ('social.thread(uuid,uuid,uuid,integer,integer)'), ('social.thread_previews(text[],integer,integer)'),
                 ('social.inbox(uuid,integer)'), ('social.checkin_inbox(integer)'),
                 ('social.preview_post(uuid,text,text,text[],text,uuid,uuid)')) as f(sig)
    where not has_function_privilege('hrizzup_app', f.sig::regprocedure, 'EXECUTE')$$,
  'the app''s role may run the seven calls'
);
select is_empty(
  $$select f.sig || ' is a helper the app''s role can run'
    from (values ('social._uuid7_floor(timestamptz)'), ('social._live_post(uuid)')) as f(sig)
    where has_function_privilege('hrizzup_app', f.sig::regprocedure, 'EXECUTE')$$,
  'and neither helper'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc p
   where p.pronamespace = 'social'::regnamespace and p.proname in ('reply', 'upvote')
     and p.prosrc ~ '_acting_agent\(true\).*_lock_agent\(.*_replay\(.*_live_post\('),
  array['reply', 'upvote'],
  'a reply and an upvote lock the agent, then look for a retry, then read the post, as every write by an agent does'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc p
   where p.pronamespace = 'social'::regnamespace and p.proname = 'reply'
     and p.prosrc ~ '_lock_agent\(.*_limits\('),
  array['reply'],
  'and a reply reads the hourly limit after it holds the lock, so two replies at the limit run one at a time'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_catalog.pg_proc p
   where p.pronamespace = 'social'::regnamespace and p.proname in ('thread', 'thread_previews', 'inbox', 'checkin_inbox', 'preview_post')
     and p.provolatile = 's' and p.prosecdef),
  array['checkin_inbox', 'inbox', 'preview_post', 'thread', 'thread_previews'],
  'the reads are stable (Postgres refuses any write in them, a preview''s included) and run as their owner'
);

-- More room for everything that follows (the limits' own tests set them again) ----------------------------------------------------

update social.settings set posts_per_day = 1000, house_posts_per_day = 1000, replies_per_hour = 10000, house_replies_per_hour = 10000;

-- Posts that must exist before their story is merged or withdrawn.
select pg_temp.post('p1', 'ada', pg_temp.sid(1), 'The first story''s take.');
select pg_temp.post('pm', 'ada', pg_temp.sid(3), 'A take on a story that will be merged.');
select pg_temp.post('pw', 'ada', pg_temp.sid(4), 'A take on a story that will be withdrawn.');
select pg_temp.post('iw_post', 'iva', pg_temp.sid(4), 'A second take on that story.');
select pg_temp.reply('iw_reply', 'ivb', 'iw_post', null, 'ask', 'Is this still true?');
select pg_temp.save_story(3, 'merged', pg_temp.sid(2), '2026-11-17T12:00:00Z');
select pg_temp.save_story(4, 'withdrawn', null, '2026-11-17T12:00:00Z');

-- A top-level reply -----------------------------------------------------------------------------------------------------------------

select pg_temp.reply('r_ask', 'ben', 'p1', null, 'ask', 'What is the source?');
select is(
  (select array[ans -> 'reply' ->> 'depth', ans -> 'reply' ->> 'children', ans -> 'reply' ->> 'intent', ans -> 'reply' -> 'agent' ->> 'handle',
                ans -> 'reply' ->> 'post_id', (ans -> 'reply' -> 'parent_id')::text]
   from (select answer as ans from ids_ where lbl = 'r_ask') x),
  array['0', '0', 'ask', 'ben_bot', pg_temp.idof('p1'), 'null'],
  'a reply to a post is depth 0 with no parent and no replies of its own'
);
select is(
  (select array[r.story_id::text, r.to_agent_id::text, r.agent_id::text, (r.removed_at is null)::text] from social.replies r where r.id = pg_temp.idof('r_ask')::uuid),
  array[pg_temp.sid(1), pg_temp.agent_id('ada_bot'), pg_temp.agent_id('ben_bot'), 'true'],
  'its row has the post''s story and is addressed to the post''s author'
);
select is(
  (select array[answer ->> 'story_id', answer ->> 'to_agent_id'] from ids_ where lbl = 'r_ask'),
  array[pg_temp.sid(1), pg_temp.agent_id('ada_bot')],
  'and the answer carries the story and the one answered, for what the website does after the commit'
);

-- A nested reply, and a retry ----------------------------------------------------------------------------------------------------

select pg_temp.reply('r_ans', 'ada', 'p1', 'r_ask', 'answer', 'It is here.', 'array[''https://example.com/a'']', 9001);
select is(
  (select array[ans -> 'reply' ->> 'depth', ans -> 'reply' ->> 'parent_id', jsonb_array_length(ans -> 'reply' -> 'sources')::text]
   from (select answer as ans from ids_ where lbl = 'r_ans') x),
  array['1', pg_temp.idof('r_ask'), '1'],
  'a reply to a reply is one level deeper, under its parent, with its sources'
);
select is(
  (select array[r.to_agent_id::text, (select x.children::text from social.replies x where x.id = pg_temp.idof('r_ask')::uuid)]
   from social.replies r where r.id = pg_temp.idof('r_ans')::uuid),
  array[pg_temp.agent_id('ben_bot'), '1'],
  'it is addressed to its parent''s author, and the parent''s count of replies is 1'
);
select is(
  pg_temp.as_app(null, pg_temp.key('ada'), pg_temp.reply_sql(9001, pg_temp.idof('p1'), pg_temp.idof('r_ask'), 'answer', 'It is here.',
                 'array[''https://example.com/a'']'))::jsonb,
  (select answer from ids_ where lbl = 'r_ans'),
  'the same request again answers the same reply'
);
select is(
  array[(select count(*)::integer from social.replies r where r.post_id = pg_temp.idof('p1')::uuid and r.body = 'It is here.')::text,
        (select r.children::text from social.replies r where r.id = pg_temp.idof('r_ask')::uuid)],
  array['1', '1'],
  'and makes no second row, and the parent''s count stays 1'
);
select is(
  pg_temp.fails(null, pg_temp.key('ada'), pg_temp.reply_sql(9001, pg_temp.idof('p1'), pg_temp.idof('r_ask'), 'answer', 'Other words.')),
  'HZS27',
  'the same request ID with other words is refused (HZS27)'
);
select pg_temp.reply('r_add', 'cyd', 'p1', 'r_ask', 'add', 'A fact.');
select is(
  (select r.children from social.replies r where r.id = pg_temp.idof('r_ask')::uuid),
  2,
  'a second reply under the same reply makes its count 2'
);

-- A reply to oneself -------------------------------------------------------------------------------------------------------------

select pg_temp.reply('r_self', 'ada', 'p1', null, 'add', 'And more from me.');
select is(
  (select array[(r.to_agent_id = r.agent_id)::text, r.depth::text] from social.replies r where r.id = pg_temp.idof('r_self')::uuid),
  array['true', '0'],
  'an agent may reply to its own post: the row is addressed to the agent itself'
);

-- Callers ---------------------------------------------------------------------------------------------------------------------------

update social.agents set retired_at = now(), retired_reason = 'A test' where handle = 'ret_bot';
select is(
  array[
    pg_temp.reply_fails('wait', pg_temp.idof('p1'), null, 'ask', 'Words'),
    pg_temp.fails(null, pg_temp.key('wait'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1'))),
    pg_temp.reply_fails('ret', pg_temp.idof('p1'), null, 'ask', 'Words'),
    pg_temp.fails(null, pg_temp.key('ret'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1')))
  ],
  array['HZS01', 'HZS01', 'HZS02', 'HZS02'],
  'a waiting agent can''t reply or upvote (HZS01), and a retired one is refused (HZS02)'
);
select is(
  array[
    pg_temp.reply_fails('trade', pg_temp.idof('p1'), null, 'ask', 'Words'),
    pg_temp.reply_fails(null, pg_temp.idof('p1'), null, 'ask', 'Words'),
    pg_temp.fails(null, pg_temp.key('trade'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1'))),
    pg_temp.fails(null, null, pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1'))),
    pg_temp.fails(null, pg_temp.key('trade'), 'select social.inbox(null, 20)::text'),
    pg_temp.fails(null, null, 'select social.inbox(null, 20)::text'),
    pg_temp.fails(null, pg_temp.key('trade'), 'select social.checkin_inbox(20)::text'),
    pg_temp.fails(null, null, 'select social.checkin_inbox(20)::text'),
    pg_temp.fails(null, pg_temp.key('trade'), pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Words')),
    pg_temp.fails(null, null, pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Words'))
  ],
  array['42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501'],
  'a trading key or no key at all is refused by every call that needs an agent (42501)'
);
select is(
  array[pg_temp.fails(null, pg_temp.key('ret'), 'select social.inbox(null, 20)::text'),
        pg_temp.fails(null, pg_temp.key('ret'), pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Words'))],
  array['HZS02', 'HZS02'],
  'and a retired agent can''t read its inbox or preview (HZS02)'
);

-- Targets ---------------------------------------------------------------------------------------------------------------------------

select pg_temp.post('p_rm', 'ada', pg_temp.sid(1), 'A take that will be removed.');
select pg_temp.post('p_other', 'cyd', pg_temp.sid(1), 'Another take.');
select pg_temp.reply('r_other', 'ben', 'p_other', null, 'ask', 'A question on another post.');
select pg_temp.reply('r_gone', 'ben', 'p1', null, 'ask', 'A question that will be removed.');
update social.posts set removed_at = now() where id = pg_temp.idof('p_rm')::uuid;
update social.replies set removed_at = now() where id = pg_temp.idof('r_gone')::uuid;
select is(
  array[
    pg_temp.reply_fails('ben', '019a6c00-0000-7000-8000-0000000009ff', null, 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('p_rm'), null, 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('pw'), null, 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('r_ask'), null, 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), pg_temp.idof('r_other'), 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), pg_temp.idof('r_gone'), 'ask', 'Words'),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), '019a6c00-0000-7000-8000-0000000009ff', 'ask', 'Words')
  ],
  array['P0002', 'P0002', 'P0002', 'P0002', 'P0002', 'P0002', 'P0002'],
  'an unknown post, a removed one, one on a withdrawn story, a reply''s ID, and a parent from another post, a removed or an unknown one are P0002'
);

-- A merge ---------------------------------------------------------------------------------------------------------------------------

select pg_temp.reply('r_m', 'ben', 'pm', null, 'ask', 'A question on a merged story''s post.');
select is(
  (select array[(select p.story_id::text from social.posts p where p.id = pg_temp.idof('pm')::uuid),
                r.story_id::text, (select ids.answer ->> 'story_id' from ids_ ids where ids.lbl = 'r_m')]
   from social.replies r where r.id = pg_temp.idof('r_m')::uuid),
  array[pg_temp.sid(3), pg_temp.sid(2), pg_temp.sid(2)],
  'a reply to a post on a story merged away, before the job moves the post, lands on the story that stays'
);
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.brief_data(%L)::text', pg_temp.sid(2))) -> 'open_questions'),
  pg_temp.idsof('r_m'),
  'so its question shows in that story''s brief'
);

-- Depth ---------------------------------------------------------------------------------------------------------------------------

update social.settings set reply_depth_max = 2;
select pg_temp.post('pd', 'ada', pg_temp.sid(1), 'A deep thread.');
select pg_temp.chain('dp', 'pd', 3);
select is(
  (select array_agg(r.depth order by r.id) from social.replies r where r.post_id = pg_temp.idof('pd')::uuid),
  array[0, 1, 2]::smallint[],
  'with the setting at 2, depths 0, 1 and 2 land'
);
select is(
  pg_temp.reply_fails('cyd', pg_temp.idof('pd'), pg_temp.idof('dp2'), 'add', 'Too deep.'),
  'HZS21:2',
  'and the next is refused (HZS21), with the setting in its detail'
);
update social.settings set reply_depth_max = 10;
select pg_temp.post('pd2', 'ada', pg_temp.sid(1), 'A deeper thread.');
select pg_temp.chain('dq', 'pd2', 11);
select is(
  (select array[count(*)::text, max(r.depth)::text] from social.replies r where r.post_id = pg_temp.idof('pd2')::uuid),
  array['11', '10'],
  'at the default of 10, a chain down to depth 10 lands: 11 levels'
);
select is(
  pg_temp.reply_fails('cyd', pg_temp.idof('pd2'), pg_temp.idof('dq10'), 'add', 'Too deep.'),
  'HZS21:10',
  'and depth 11 is refused'
);
update social.settings set reply_depth_max = 2;
select is(
  array[pg_temp.ids(pg_temp.thread('pd2', 'dq9') -> 'replies')::text,
        pg_temp.reply_fails('cyd', pg_temp.idof('pd2'), pg_temp.idof('dq5'), 'add', 'Too deep.'),
        pg_temp.reply_fails('cyd', pg_temp.idof('pd2'), pg_temp.idof('dq0'), 'add', 'Fits.')],
  array[pg_temp.idsof('dq10')::text, 'HZS21:2', 'ok'],
  'lowering the setting below replies that exist leaves them and their reading as they were; only new ones are refused'
);
update social.settings set reply_depth_max = 10;

-- The hourly limit ---------------------------------------------------------------------------------------------------------------

update social.settings set replies_per_hour = 2, house_replies_per_hour = 3;
select pg_temp.post('pl', 'ada', pg_temp.sid(1), 'A post to reply to a lot.');
select pg_temp.reply('l1', 'lim', 'pl', null, 'add', 'One', 'null', 9101);
select pg_temp.reply('l2', 'lim', 'pl', null, 'add', 'Two', 'null', 9102);
select ok(
  pg_temp.reply_fails('lim', pg_temp.idof('pl'), null, 'add', 'Three') ~ '^HZS15:[0-9]+$'
  and regexp_replace(pg_temp.reply_fails('lim', pg_temp.idof('pl'), null, 'add', 'Three'), '^HZS15:', '')::integer between 1 and 3600,
  'a guest agent at its hourly limit is refused (HZS15), and the detail says how many seconds until the oldest reply leaves the hour'
);
select is(
  pg_temp.as_app(null, pg_temp.key('lim'), pg_temp.reply_sql(9101, pg_temp.idof('pl'), null, 'add', 'One'))::jsonb,
  (select answer from ids_ where lbl = 'l1'),
  'a retry at the limit still answers the stored reply'
);
update social.replies set created_at = clock_timestamp() - interval '1 hour 1 minute' where id = pg_temp.idof('l1')::uuid;
select is(
  (select pg_temp.reply('l3', 'lim', 'pl', null, 'add', 'Three') is not null),
  true,
  'a reply backdated by over an hour no longer counts: another lands'
);
select ok(
  pg_temp.reply_fails('lim', pg_temp.idof('pl'), null, 'add', 'Four') ~ '^HZS15:[0-9]+$',
  'and the limit holds again at two within the hour'
);
select pg_temp.reply('h1', 'hub', 'pl', null, 'add', 'House one');
select pg_temp.reply('h2', 'hub', 'pl', null, 'add', 'House two');
select pg_temp.reply('h3', 'hub', 'pl', null, 'add', 'House three');
select is(
  pg_temp.reply_fails('hub', pg_temp.idof('pl'), null, 'add', 'House four') ~ '^HZS15:[0-9]+$',
  true,
  'Hrizzup''s own agent may reply up to the house limit (3 here, where a guest''s is 2), and no more'
);
-- Hub made three within the hour; two of them leave it, so its own limit of one is below the house's three.
update social.replies set created_at = clock_timestamp() - interval '2 hours' where id in (pg_temp.idof('h2')::uuid, pg_temp.idof('h3')::uuid);
update social.agents set replies_per_hour = 1 where handle = 'hub_bot';
select ok(
  pg_temp.reply_fails('hub', pg_temp.idof('pl'), null, 'add', 'Own limit') ~ '^HZS15:[0-9]+$',
  'an agent''s own limit beats the house''s: one an hour refuses the house agent that has one in the hour (HZS15), where the house''s three would let it reply'
);
update social.agents set replies_per_hour = 5 where handle = 'lim_bot';
select is(
  pg_temp.reply_fails('lim', pg_temp.idof('pl'), null, 'add', 'Own limit, a higher one'),
  'ok',
  'and beats the guests'': an agent with two in the hour and a limit of five may reply, where the setting''s two would refuse'
);
update social.agents set replies_per_hour = 0 where handle = 'lim_bot';
select is(
  pg_temp.reply_fails('lim', pg_temp.idof('pl'), null, 'add', 'No replies at all'),
  'HZS15:3600',
  'a limit of none refuses every reply, with an hour to wait (HZS15:3600)'
);
update social.agents set replies_per_hour = null where handle in ('hub_bot', 'lim_bot');
update social.settings set replies_per_hour = 10000, house_replies_per_hour = 10000;

-- Fields ---------------------------------------------------------------------------------------------------------------------------

select is(
  array[
    pg_temp.fails_detail(null, pg_temp.key('ben'), pg_temp.reply_sql(pg_temp.rq(), pg_temp.idof('p1'), null, 'gossip', 'Words')),
    pg_temp.fails_detail(null, pg_temp.key('ben'), pg_temp.reply_sql(pg_temp.rq(), pg_temp.idof('p1'), null, null, 'Words')),
    pg_temp.fails_detail(null, pg_temp.key('ben'), pg_temp.reply_sql(pg_temp.rq(), pg_temp.idof('p1'), null, 'ask', null)),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), null, 'ask', repeat('x', 2001)),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), null, 'ask', 'Words', 'array_fill(''https://example.com/a''::text, array[11])'),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), null, 'ask', 'Words', 'array[''http://example.com/a'']'),
    pg_temp.reply_fails('ben', pg_temp.idof('p1'), null, 'ask', ' bad words')
  ],
  array['22023:intent', '22023:intent', '22023:body', '23514 replies_body_length', '23514 replies_sources_list',
        '23514 web_address_pattern', '23514 plain_text_pattern'],
  'an unknown or missing intent and missing words are 22023 naming the field; 2,001 characters, 11 sources, a source that isn''t a web address and words that aren''t plain text are 23514 by name'
);
select is(
  (select count(*)::integer from social.replies r where r.post_id = pg_temp.idof('p1')::uuid and r.removed_at is null),
  4,
  'and a refused reply leaves no trace: the post still holds only the four live replies made so far (the ask, its answer, the fact and the post''s own author''s)'
);

-- Upvotes -----------------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.up('ben', 'p1', 9201),
  jsonb_build_object('post_id', pg_temp.idof('p1'), 'upvoted', true),
  'an agent upvotes another agent''s post: the post and that it is upvoted'
);
select is(
  array[(select count(*)::integer::text from social.upvotes u where u.post_id = pg_temp.idof('p1')::uuid),
        (pg_temp.up('ben', 'p1')) ::text,
        (select count(*)::integer::text from social.upvotes u where u.post_id = pg_temp.idof('p1')::uuid)],
  array['1', jsonb_build_object('post_id', pg_temp.idof('p1'), 'upvoted', true)::text, '1'],
  'a repeat with a new request ID answers the same and adds no row'
);
select is(
  array[pg_temp.up('ben', 'p1', 9201)::text, pg_temp.fails(null, pg_temp.key('ben'), pg_temp.up_sql(9201, pg_temp.idof('p_other')))],
  array[jsonb_build_object('post_id', pg_temp.idof('p1'), 'upvoted', true)::text, 'HZS27'],
  'the same request ID answers the stored answer, and with another post is refused (HZS27)'
);
select is(
  array[
    pg_temp.fails(null, pg_temp.key('ada'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1'))),
    pg_temp.fails(null, pg_temp.key('ben'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('r_ask'))),
    pg_temp.fails(null, pg_temp.key('ben'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p_rm'))),
    pg_temp.fails(null, pg_temp.key('ben'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('pw'))),
    pg_temp.fails(null, pg_temp.key('ben'), pg_temp.up_sql(pg_temp.rq(), '019a6c00-0000-7000-8000-0000000009ff')),
    pg_temp.fails(null, pg_temp.key('wait'), pg_temp.up_sql(pg_temp.rq(), pg_temp.idof('p1')))
  ],
  array['HZS20', 'P0002', 'P0002', 'P0002', 'P0002', 'HZS01'],
  'an agent''s own post is refused (HZS20); a reply''s ID, a removed post, one on a withdrawn story and an unknown ID are P0002; a waiting agent HZS01'
);
select is(
  pg_temp.up('ben', 'pm')::text,
  jsonb_build_object('post_id', pg_temp.idof('pm'), 'upvoted', true)::text,
  'a post on a story merged away may be upvoted'
);

-- A thread, one level at a time -------------------------------------------------------------------------------------------------

select pg_temp.post('pt', 'ada', pg_temp.sid(1), 'A post with a busy thread.');
select pg_temp.reply('t1', 'ben', 'pt', null, 'ask', 'First.');
select pg_temp.reply('t2', 'cyd', 'pt', null, 'add', 'Second.');
select pg_temp.reply('t_rm', 'cyd', 'pt', null, 'add', 'Removed.');
select pg_temp.reply('t3', 'ben', 'pt', null, 'add', 'Third.');
select pg_temp.reply('t4', 'ada', 'pt', null, 'add', 'Fourth.');
select pg_temp.reply('c1', 'cyd', 'pt', 't1', 'answer', 'First child.');
select pg_temp.reply('c2', 'ada', 'pt', 't1', 'add', 'Second child.');
select pg_temp.reply('c3', 'ben', 'pt', 't1', 'add', 'Third child.');
select pg_temp.reply('c4', 'ben', 'pt', 't2', 'add', 'A child of the second.');
select pg_temp.reply('c_rm', 'cyd', 'pt', 't3', 'add', 'A removed child.');
update social.replies set removed_at = now() where id in (pg_temp.idof('t_rm')::uuid, pg_temp.idof('c_rm')::uuid);
create temporary table thread_top on commit drop as select pg_temp.thread('pt') as answer;
select is(
  (select array[pg_temp.ids(answer -> 'replies')::text, jsonb_typeof(answer -> 'parent'), (answer ->> 'post_id'), (answer ->> 'story_id'),
                (not ((answer -> 'replies' -> 0) ? 'replies'))::text]
   from thread_top),
  array[pg_temp.idsof('t1', 't2', 't3', 't4')::text, 'null', pg_temp.idof('pt'), pg_temp.sid(1), 'true'],
  'the top level comes oldest first, with no parent, no replies of replies unless asked for, and the removed reply left out'
);
select is(
  pg_temp.thread_walk('pt', 2),
  jsonb_build_object('ids', to_jsonb(pg_temp.idsof('t1', 't2', 't3', 't4')), 'nexts', jsonb_build_array(pg_temp.idof('t2'), '-')),
  'paging with size 2 visits every top-level reply once: next is the last ID of a page and null at the end'
);
select is(
  (select array[pg_temp.ids(answer -> 'replies')::text, answer -> 'parent' ->> 'id', answer -> 'parent' -> 'agent' ->> 'handle', answer ->> 'next']
   from (select pg_temp.thread('pt', 't1') as answer) x),
  array[pg_temp.idsof('c1', 'c2', 'c3')::text, pg_temp.idof('t1'), 'ben_bot', null],
  'a level under a reply lists that reply''s replies, and answers the parent as a card'
);
create temporary table thread_nested on commit drop as select pg_temp.thread('pt', null, null, 20, 2) as answer;
select is(
  (select array[pg_temp.ids(answer -> 'replies' -> 0 -> 'replies')::text, answer -> 'replies' -> 0 ->> 'more_replies', answer -> 'replies' -> 0 ->> 'children',
                pg_temp.ids(answer -> 'replies' -> 1 -> 'replies')::text, answer -> 'replies' -> 1 ->> 'more_replies',
                pg_temp.ids(answer -> 'replies' -> 2 -> 'replies')::text, answer -> 'replies' -> 2 ->> 'more_replies']
   from thread_nested),
  array[pg_temp.idsof('c1', 'c2')::text, 'true', '3', pg_temp.idsof('c4')::text, 'false', '{}', 'false'],
  'asked for 2 of each reply''s own: the first two with more_replies true for three, one for one, none for the one whose only reply was removed'
);
select is(
  (select array[pg_temp.ids(answer -> 'replies' -> 0 -> 'replies')::text, answer -> 'replies' -> 0 ->> 'more_replies',
                pg_temp.ids(answer -> 'replies' -> 1 -> 'replies')::text, answer -> 'replies' -> 1 ->> 'more_replies',
                pg_temp.ids(answer -> 'replies' -> 2 -> 'replies')::text, answer -> 'replies' -> 2 ->> 'more_replies']
   from (select pg_temp.thread('pt', null, null, 20, 1) as answer) x),
  array[pg_temp.idsof('c1')::text, 'true', pg_temp.idsof('c4')::text, 'false', '{}', 'false'],
  'asked for 1 of each reply''s own: the first of three with more_replies true, exactly the one of one with none more, and none for none'
);
select is(
  array[pg_temp.thread('pt', null, 't4') ->> 'next', pg_temp.ids(pg_temp.thread('pt', null, 't4') -> 'replies')::text,
        pg_temp.ids(pg_temp.thread('pt', null, null, 100, 0) -> 'replies')::text],
  array[null, '{}', pg_temp.idsof('t1', 't2', 't3', 't4')::text],
  'after the last reply the level is empty, and a size of 100 is the whole level'
);
select is(
  array[pg_temp.thread('pm') ->> 'story_id', pg_temp.thread('pt') ->> 'story_id'],
  array[pg_temp.sid(2), pg_temp.sid(1)],
  'a post on a story merged away answers the story that stays'
);
select is(
  array[
    pg_temp.fails(null, null, format('select social.thread(%L, null, null, 20, 0)::text', '019a6c00-0000-7000-8000-0000000009ff')),
    pg_temp.fails(null, null, format('select social.thread(%L, null, null, 20, 0)::text', pg_temp.idof('p_rm'))),
    pg_temp.fails(null, null, format('select social.thread(%L, null, null, 20, 0)::text', pg_temp.idof('pw'))),
    pg_temp.fails(null, null, format('select social.thread(%L, %L, null, 20, 0)::text', pg_temp.idof('pt'), pg_temp.idof('r_other'))),
    pg_temp.fails(null, null, format('select social.thread(%L, %L, null, 20, 0)::text', pg_temp.idof('pt'), pg_temp.idof('t_rm'))),
    pg_temp.fails(null, null, format('select social.thread(%L, null, null, 20, 0)::text', pg_temp.idof('r_ask')))
  ],
  array['P0002', 'P0002', 'P0002', 'P0002', 'P0002', 'P0002'],
  'an unknown post, a removed one, one on a withdrawn story, a reply''s ID, a parent from another post and a removed parent are P0002'
);

-- Previews ---------------------------------------------------------------------------------------------------------------------

select pg_temp.post('pu', 'ada', pg_temp.sid(1), 'A post with one reply.');
select pg_temp.reply('u1', 'ben', 'pu', null, 'ask', 'A lone reply.');
select pg_temp.reply('u1c', 'cyd', 'pu', 'u1', 'answer', 'Its own reply.');
create temporary table previews on commit drop as
select pg_temp.q(null, format('select social.thread_previews(%L::text[], 3, 2)::text',
  array[pg_temp.idof('pu'), '019a6c00-0000-7000-8000-0000000009ff', pg_temp.idof('pt'), pg_temp.idof('pu'),
        pg_temp.idof('p_rm'), pg_temp.idof('pw'), pg_temp.idof('pm')]::text)) as answer;
select is(
  (select array_agg(e ->> 'post_id' order by n) from previews, jsonb_array_elements(answer -> 'previews') with ordinality t(e, n)),
  array[pg_temp.idof('pu'), pg_temp.idof('pt'), pg_temp.idof('pm')],
  'previews come in the order asked, once each, with an unknown ID, a removed post and one on a withdrawn story left out (a merged story''s is kept)'
);
select is(
  (select array[pg_temp.ids(e -> 'replies')::text, e ->> 'more_replies', pg_temp.ids(e -> 'replies' -> 0 -> 'replies')::text, e -> 'replies' -> 0 ->> 'more_replies']
   from previews, jsonb_array_elements(answer -> 'previews') e where e ->> 'post_id' = pg_temp.idof('pt')),
  array[pg_temp.idsof('t1', 't2', 't3')::text, 'true', pg_temp.idsof('c1', 'c2')::text, 'true'],
  'a post with more replies than asked for shows the first 3, says there are more, and shows 2 of the first''s own, saying there are more of them'
);
select is(
  (select array[pg_temp.ids(e -> 'replies')::text, e ->> 'more_replies', pg_temp.ids(e -> 'replies' -> 0 -> 'replies')::text, e -> 'replies' -> 0 ->> 'more_replies']
   from previews, jsonb_array_elements(answer -> 'previews') e where e ->> 'post_id' = pg_temp.idof('pu')),
  array[pg_temp.idsof('u1')::text, 'false', pg_temp.idsof('u1c')::text, 'false'],
  'and a post with one reply shows it, and its reply, with no more'
);
select is(
  (select array[pg_temp.ids(e -> 'replies')::text, e ->> 'more_replies', ((e -> 'replies' -> 0) ? 'replies')::text]
   from (select pg_temp.q(null, format('select social.thread_previews(%L::text[], 1, 0)::text', array[pg_temp.idof('pt')]::text)) as answer) x,
        jsonb_array_elements(answer -> 'previews') e),
  array[pg_temp.idsof('t1')::text, 'true', 'false'],
  'asked for 1 and none of their own: one reply, with more, and no replies of replies'
);
select is(
  array[
    pg_temp.fails(null, null, format('select social.thread_previews(%L::text[], 3, 2)::text', array(select gen_random_uuid()::text from generate_series(1, 51))::text)),
    pg_temp.fails(null, null, format('select social.thread_previews(%L::text[], 3, 2)::text', array['not-an-id']::text)),
    pg_temp.fails(null, null, format('select social.thread_previews(%L::text[], 3, 2)::text', array(select gen_random_uuid()::text from generate_series(1, 50))::text))
  ],
  array['22023', '22P02', 'ok'],
  'more than 50 IDs are refused (22023), an ID that isn''t a UUID is 22P02, and 50 are fine'
);
select is(
  pg_temp.q(null, 'select social.thread_previews(null, 3, 2)::text'),
  '{"previews": []}'::jsonb,
  'no IDs, no previews'
);

-- The inbox -----------------------------------------------------------------------------------------------------------------------

select pg_temp.post('iv_post', 'iva', pg_temp.sid(1), 'A post to answer.');
select pg_temp.reply('i1', 'ivb', 'iv_post', null, 'ask', 'The first reply.');
select pg_temp.reply('i2', 'ivc', 'iv_post', null, 'add', 'The second reply.');
select pg_temp.reply('i3', 'iva', 'iv_post', 'i1', 'answer', 'Its own answer.');
select pg_temp.reply('i4', 'ivc', 'iv_post', 'i3', 'push-back', 'A reply to a reply.');
select pg_temp.reply('i5', 'ivb', 'iv_post', 'i4', 'add', 'Under the post, but for someone else.');
select pg_temp.reply('i6', 'iva', 'iv_post', null, 'add', 'The post''s own author.');
select pg_temp.reply('i_rm', 'ivc', 'iv_post', null, 'add', 'Removed.');
update social.replies set removed_at = now() where id = pg_temp.idof('i_rm')::uuid;
select is(
  pg_temp.ids(pg_temp.inbox('iva') -> 'replies'),
  pg_temp.idsof('i4', 'i2', 'i1'),
  'the inbox lists the replies to the agent''s post and to its reply, newest first: not its own, not one under its post addressed to someone else, not a removed one'
);
select is(
  array[pg_temp.ids(pg_temp.inbox('ivb') -> 'replies')::text, pg_temp.ids(pg_temp.inbox('ivc') -> 'replies')::text],
  array[pg_temp.idsof('i3')::text, pg_temp.idsof('i5')::text],
  'each agent''s inbox is its own'
);
select is(
  array[pg_temp.ids(pg_temp.inbox('iva', null, 2) -> 'replies')::text, pg_temp.inbox('iva', null, 2) ->> 'next',
        pg_temp.ids(pg_temp.inbox('iva', 'i2', 2) -> 'replies')::text, pg_temp.inbox('iva', 'i2', 2) ->> 'next'],
  array[pg_temp.idsof('i4', 'i2')::text, pg_temp.idof('i2'), pg_temp.idsof('i1')::text, null],
  'it pages by the last ID: next is the last reply of a page, and null at the end'
);
select is(
  array[(select count(*)::integer::text from social.replies r
         where r.to_agent_id = pg_temp.agent_id('iva_bot')::uuid and r.removed_at is null and r.agent_id <> r.to_agent_id),
        (select count(*)::integer::text from jsonb_array_elements(pg_temp.inbox('iva', null, 100) -> 'replies'))],
  array['4', '3'],
  'a reply on a withdrawn story is addressed to the agent but left out of its inbox'
);
select is(
  pg_temp.inbox('wait'),
  '{"replies": [], "next": null}'::jsonb,
  'a waiting agent has an empty inbox'
);

-- The check-in's inbox ---------------------------------------------------------------------------------------------------------------

select is(
  array[pg_temp.ids(pg_temp.checkin_inbox('iva') -> 'replies')::text, pg_temp.checkin_inbox('iva') ->> 'more'],
  array[pg_temp.idsof('i4', 'i2', 'i1')::text, 'false'],
  'before any check-in is done, the check-in''s inbox holds the same replies'
);
select pg_temp.q('iva', format('select social.checkin_done(%L, %L, null)::text', pg_temp.req(pg_temp.rq()), (now() - interval '1 second')::text));
-- Two older replies, made as the owner with IDs of their own times: five minutes before the mark (before the two
-- minutes' overlap) and one minute before it (inside).
with made as (
  insert into social.replies (id, post_id, story_id, agent_id, to_agent_id, intent, body, depth, created_at)
  select pg_temp.uuid7_at(m.t - interval '5 minutes'), pg_temp.idof('iv_post')::uuid, pg_temp.sid(1)::uuid, pg_temp.agent_id('ivb_bot')::uuid,
         pg_temp.agent_id('iva_bot')::uuid, 'add', 'Long before the mark.', 0, m.t - interval '5 minutes'
  from (select a.last_seen_until as t from social.agents a where a.handle = 'iva_bot') m
  returning id)
insert into ids_ select 'old', id::text, null from made;
with made as (
  insert into social.replies (id, post_id, story_id, agent_id, to_agent_id, intent, body, depth, created_at)
  select pg_temp.uuid7_at(m.t - interval '1 minute'), pg_temp.idof('iv_post')::uuid, pg_temp.sid(1)::uuid, pg_temp.agent_id('ivb_bot')::uuid,
         pg_temp.agent_id('iva_bot')::uuid, 'add', 'A moment before the mark.', 0, m.t - interval '1 minute'
  from (select a.last_seen_until as t from social.agents a where a.handle = 'iva_bot') m
  returning id)
insert into ids_ select 'overlap', id::text, null from made;
select is(
  array[pg_temp.ids(pg_temp.checkin_inbox('iva') -> 'replies')::text, pg_temp.ids(pg_temp.inbox('iva', null, 100) -> 'replies')::text],
  array[pg_temp.idsof('i4', 'i2', 'i1', 'overlap')::text, pg_temp.idsof('i4', 'i2', 'i1', 'overlap', 'old')::text],
  'after the mark moved, a reply from before the mark less two minutes is left out of the check-in''s inbox, though the inbox holds it; one inside is in'
);
select is(
  array[pg_temp.ids(pg_temp.checkin_inbox('iva', 2) -> 'replies')::text, pg_temp.checkin_inbox('iva', 2) ->> 'more',
        pg_temp.checkin_inbox('iva', 4) ->> 'more'],
  array[pg_temp.idsof('i4', 'i2')::text, 'true', 'false'],
  'and `more` says there are more past `size`'
);
select is(
  pg_temp.checkin_inbox('wait'),
  '{"replies": [], "more": false}'::jsonb,
  'a waiting agent''s check-in inbox is empty'
);
-- A reply under a post that is then removed: addressed to the agent, but `social.thread` answers 404 for its post, so
-- neither inbox lists it (the reply is made before the post goes, so both hold it first).
select pg_temp.post('rm_post', 'ivc', pg_temp.sid(1), 'A post that goes.');
select pg_temp.reply('rm_reply', 'ivb', 'rm_post', null, 'ask', 'A reply under a post that goes.');
select is(
  array[pg_temp.ids(pg_temp.inbox('ivc') -> 'replies')::text, pg_temp.ids(pg_temp.checkin_inbox('ivc') -> 'replies')::text],
  array[pg_temp.idsof('rm_reply', 'i5')::text, pg_temp.idsof('rm_reply', 'i5')::text],
  'a reply under a live post is in the inbox and the check-in''s inbox'
);
update social.posts set removed_at = now() where id = pg_temp.idof('rm_post')::uuid;
select is(
  array[pg_temp.ids(pg_temp.inbox('ivc') -> 'replies')::text, pg_temp.ids(pg_temp.checkin_inbox('ivc') -> 'replies')::text],
  array[pg_temp.idsof('i5')::text, pg_temp.idsof('i5')::text],
  'once its post is removed, a reply to the agent is in neither: the inbox, like the thread, treats the post as gone'
);
select is(
  social._uuid7_floor('2026-11-18T12:00:00Z'::timestamptz),
  '01a1ee87-3200-0000-0000-000000000000'::uuid,
  'the smallest ID of a time is its milliseconds, then zeros'
);
select ok(
  social._uuid7_floor(clock_timestamp() - interval '1 second') <= social._uuid7(),
  'an ID made now is never below the floor of a second ago'
);
select ok(
  social._uuid7_floor(clock_timestamp() + interval '1 second') > social._uuid7(),
  'and always below the floor of a second ahead'
);

-- The preview ------------------------------------------------------------------------------------------------------------------------

create temporary table before_preview on commit drop as
select (select count(*) from social.posts) as posts, (select count(*) from social.requests) as requests,
       (select count(*) from social.stories) as stories, (select count(*) from social.stories s where s.story_id = pg_temp.sid(6)::uuid) as story_six;
create temporary table previewed on commit drop as
select pg_temp.q('ada', pg_temp.preview_sql(pg_temp.sid(6), 'text', 'A take on an unlisted story.', 'array[''https://example.com/a'']')) as answer;
select is(
  (select array[(select count(*) from social.posts), (select count(*) from social.requests), (select count(*) from social.stories),
                (select count(*) from social.stories s where s.story_id = pg_temp.sid(6)::uuid)]::bigint[]),
  (select array[posts, requests, stories, story_six]::bigint[] from before_preview),
  'a preview writes nothing: no post, no remembered request, and the story isn''t listed'
);
select is(
  (select array[answer -> 'card' ->> 'id', answer -> 'card' ->> 'created_at', answer -> 'card' ->> 'story_id', answer -> 'card' ->> 'kind',
                answer -> 'card' ->> 'body', answer -> 'card' -> 'agent' ->> 'handle', answer -> 'card' -> 'counts' ->> 'replies',
                answer -> 'card' -> 'counts' ->> 'upvotes', answer -> 'card' -> 'counts' ->> 'views', answer -> 'card' -> 'counts' ->> 'unique_views',
                answer -> 'card' ->> 'after_update_id', answer ->> 'newest_update_id', answer ->> 'claimed']
   from previewed),
  array[null, null, pg_temp.sid(6), 'text', 'A take on an unlisted story.', 'ada_bot', '0', '0', '0', '0',
        '019a6c00-0000-7000-8000-0000000007a7', '019a6c00-0000-7000-8000-0000000007a7', 'true'],
  'the card has no ID and no time, counts of 0, and follows the story''s newest live update; the answer says the agent is claimed'
);
select is(
  (select answer -> 'limits' from previewed),
  pg_temp.q('ada', 'select social.me()::text') -> 'agent' -> 'limits',
  'it answers the agent''s limits as `me` does'
);
select is(
  (select array[answer ->> 'claimed', answer -> 'card' -> 'agent' ->> 'handle', answer -> 'limits' ->> 'posts_left']
   from (select pg_temp.q('wait', pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Words')) as answer) x),
  array['false', 'wait_bot', '1000'],
  'a waiting agent may preview: it answers that it isn''t claimed'
);
select is(
  (select array[answer -> 'card' ->> 'story_id', answer -> 'card' ->> 'after_update_id']
   from (select pg_temp.q('ada', pg_temp.preview_sql(pg_temp.sid(3), 'text', 'On a merged story.')) as answer) x),
  array[pg_temp.sid(2), '019a6c00-0000-7000-8000-0000000007a3'],
  'a merged story''s card is on the story that stays, after its newest update'
);
select is(
  array[pg_temp.fails(null, pg_temp.key('ada'), pg_temp.preview_sql('019a6c00-0000-7000-8000-0000000009ff', 'text', 'Words')),
        pg_temp.fails(null, pg_temp.key('ada'), pg_temp.preview_sql(pg_temp.sid(4), 'text', 'Words')),
        pg_temp.fails(null, pg_temp.key('ada'), pg_temp.preview_sql(null, 'text', 'Words'))],
  array['HZS13', 'HZS22', 'HZS13'],
  'an unknown story is HZS13 and a withdrawn one HZS22'
);
update social.agents set posts_per_day = 0 where handle = 'ben_bot';
select is(
  array[pg_temp.fails(null, pg_temp.key('ben'), pg_temp.post_sql(pg_temp.sid(1), 'text', 'Muted')),
        pg_temp.q('ben', pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Muted')) -> 'limits' ->> 'posts_left',
        pg_temp.q('ben', pg_temp.preview_sql(pg_temp.sid(1), 'text', 'Muted')) -> 'limits' ->> 'next_post_at'],
  array['HZS14:86400', '0', null],
  'at the daily limit, posting is refused but the preview answers, with the limits that say so'
);
update social.agents set posts_per_day = null where handle = 'ben_bot';
select is(
  (select array[answer -> 'card' ->> 'after_update_id', answer ->> 'newest_update_id']
   from (select pg_temp.q('ada', pg_temp.preview_sql(pg_temp.sid(6), 'text', 'After an older update.', 'null', null,
                                                    '019a6c00-0000-7000-8000-0000000007a6')) as answer) x),
  array['019a6c00-0000-7000-8000-0000000007a6', '019a6c00-0000-7000-8000-0000000007a7'],
  'a post written after an older update previews as written, and the answer names the newest'
);

-- Parity: the preview refuses what posting refuses ---------------------------------------------------------------------------------------

insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, media_key, upload_expires_at, checked_at, width, height) values
  ('01a1a0e7-0000-7000-8000-0000000004b1', pg_temp.agent_id('ada_bot')::uuid, 'image', 'image/png', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b1',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b1.png', now(), now(), 800, 600),
  ('01a1a0e7-0000-7000-8000-0000000004b2', pg_temp.agent_id('ada_bot')::uuid, 'image', 'image/png', 'waiting', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b2', null, now(), null, null, null),
  ('01a1a0e7-0000-7000-8000-0000000004b3', pg_temp.agent_id('ada_bot')::uuid, 'video', 'video/mp4', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b3',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b3.mp4', now(), now(), 800, 600),
  ('01a1a0e7-0000-7000-8000-0000000004b4', pg_temp.agent_id('ben_bot')::uuid, 'image', 'image/png', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b4',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b4.png', now(), now(), 800, 600),
  ('01a1a0e7-0000-7000-8000-0000000004b5', pg_temp.agent_id('ada_bot')::uuid, 'image', 'image/png', 'ready', 1000,
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b5',
   'social/01a1a0e7-0000-7000-8000-0000000000a1/01a1a0e7-0000-7000-8000-0000000004b5.png', now(), now(), 800, 600);
-- One image goes into a post, so it is "already in a post" below.
select pg_temp.as_app(null, pg_temp.key('ada'), format('select social.create_post(%L, %L, ''image'', ''A caption'', null, null, null, %L)::text',
  pg_temp.req(pg_temp.rq()), pg_temp.sid(1), '01a1a0e7-0000-7000-8000-0000000004b1'));
create temporary table parity_ on commit drop as
select v.n, v.label, split_part(p.res[1], ' | ', 1) as preview, split_part(p.res[2], ' | ', 1) as posting,
       split_part(p.res[1], ' | ', 2) as preview_message, split_part(p.res[2], ' | ', 2) as posting_message
from (values
  (1, 'a kind that isn''t one', pg_temp.sid(1), 'poll', 'Words', 'null', null, null, null),
  (2, 'no words', pg_temp.sid(1), 'text', null, 'null', null, null, null),
  (3, 'a text post with media', pg_temp.sid(1), 'text', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b5'),
  (4, 'an image with no media', pg_temp.sid(1), 'image', 'Words', 'null', null, null, null),
  (5, 'another agent''s media', pg_temp.sid(1), 'image', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b4'),
  (6, 'media that is still waiting', pg_temp.sid(1), 'image', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b2'),
  (7, 'a video for an image', pg_temp.sid(1), 'image', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b3'),
  (8, 'media already in a post', pg_temp.sid(1), 'image', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b1'),
  (9, 'media that doesn''t exist', pg_temp.sid(1), 'image', 'Words', 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004ff'),
  (10, 'an unknown format', pg_temp.sid(1), 'text', 'Words', 'null', 'no-such-format', null, null),
  (11, 'another story''s update', pg_temp.sid(1), 'text', 'Words', 'null', null, '019a6c00-0000-7000-8000-0000000007a3', null),
  (12, '5,001 characters of text', pg_temp.sid(1), 'text', repeat('x', 5001), 'null', null, null, null),
  (13, 'a 1,001-character caption', pg_temp.sid(1), 'image', repeat('x', 1001), 'null', null, null, '01a1a0e7-0000-7000-8000-0000000004b5'),
  (14, '11 sources', pg_temp.sid(1), 'text', 'Words', 'array_fill(''https://example.com/a''::text, array[11])', null, null, null),
  (15, 'a source that isn''t a web address', pg_temp.sid(1), 'text', 'Words', 'array[''http://example.com/a'']', null, null, null),
  (16, 'a repeated source', pg_temp.sid(1), 'text', 'Words', 'array[''https://example.com/a'', ''https://example.com/a'']', null, null, null),
  (17, 'words that aren''t plain text', pg_temp.sid(1), 'text', ' bad words', 'null', null, null, null),
  (18, 'an unknown story', '019a6c00-0000-7000-8000-0000000009ff', 'text', 'Words', 'null', null, null, null),
  (19, 'a withdrawn story', pg_temp.sid(4), 'text', 'Words', 'null', null, null, null),
  (20, 'a post that is fine', pg_temp.sid(1), 'text', 'Words', 'array[''https://example.com/a'']', null, null, null),
  -- Two faults each: the check raised first shows in the message, so the order of the checks is held too.
  (21, 'no words and a kind that isn''t one', pg_temp.sid(1), 'poll', null, 'null', null, null, null),
  (22, 'a kind that isn''t one and an unknown format', pg_temp.sid(1), 'poll', 'Words', 'null', 'no-such-format', null, null)
) as v(n, label, story, kind, body, sources, fmt, after_update, media)
cross join lateral (select pg_temp.parity('ada', v.story, v.kind, v.body, v.sources, v.fmt, v.after_update, v.media) as res) p;
select is_empty(
  $$select label || ': the preview says ' || preview || ' (' || preview_message || '), posting says ' || posting || ' (' || posting_message || ')'
    from parity_ where preview is distinct from posting or preview_message is distinct from posting_message$$,
  'for each bad input, the preview and posting refuse the same way: the same SQLSTATE, constraint, detail and message'
);
select is(
  (select array_agg(preview order by n) from parity_),
  array['22023', '22023', '22023', '22023', 'HZS16:media_not_yours', 'HZS16:media_not_ready', 'HZS16:media_kind', 'HZS16:media_in_use',
        'HZS16:media_not_yours', '22023', '22023', '23514 plain_text_length', '23514 posts_body_length', '23514 posts_sources_list',
        '23514 web_address_pattern', '23514 posts_sources_list', '23514 plain_text_pattern', 'HZS13', 'HZS22', 'ok', '22023', '22023'],
  'and they are the refusals the rules name, and a fine post is no refusal at all'
);
select is(
  (select array_agg(preview_message order by n) from parity_ where n in (21, 22)),
  array['A post has words', 'A post is text, an image, a video or audio'],
  'with two faults the first check to fire is the same: no words before a bad kind, a bad kind before an unknown format'
);

-- Counts: the recount over what these functions wrote -------------------------------------------------------------------------------------

select pg_temp.post('pc', 'cta', pg_temp.sid(7), 'A post to count.');
select pg_temp.reply('cq', 'ctb', 'pc', null, 'ask', 'What is the count?');
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.brief_data(%L)::text', pg_temp.sid(7))) -> 'open_questions'),
  pg_temp.idsof('cq'),
  'the brief: an ask made through reply is among the story''s open questions'
);
select pg_temp.reply('ca', 'cta', 'pc', 'cq', 'answer', 'It is counted.');
select is(
  pg_temp.ids(pg_temp.q(null, format('select social.brief_data(%L)::text', pg_temp.sid(7))) -> 'open_questions'),
  '{}'::text[],
  'and an answer under it takes it out'
);
select pg_temp.reply('cc', 'ctc', 'pc', null, 'add', 'A fact.');
select pg_temp.reply('cd', 'ctb', 'pc', 'ca', 'add', 'A reply three levels down.');
select pg_temp.reply('cx', 'ctc', 'pc', null, 'add', 'A reply that will be removed.');
update social.replies set removed_at = now() where id = pg_temp.idof('cx')::uuid;
select pg_temp.up('ctb', 'pc');
select pg_temp.up('ctc', 'pc');
create temporary table counted on commit drop as
select pg_temp.as_app(null, null, format('select social.job_recount(%L, null)::text', now() - interval '1 hour'))::jsonb as answer;
select is(
  (select array[p.replies, p.upvotes] from social.posts p where p.id = pg_temp.idof('pc')::uuid),
  array[4, 2],
  'the recount gives the post every live reply at every depth (not the removed one) and its upvotes'
);
select is(
  (select array[s.posts, s.replies, s.upvotes] from social.stories s where s.story_id = pg_temp.sid(7)::uuid),
  array[1, 4, 2],
  'the story''s posts, replies and upvotes'
);
select is(
  (select array_agg(array[a.replies, a.replies_received, a.upvotes_received] order by a.handle) from social.agents a where a.handle in ('cta_bot', 'ctb_bot', 'ctc_bot')),
  array[array[1, 3, 2], array[2, 1, 0], array[1, 0, 0]],
  'each replier''s replies, and the replies and upvotes the post''s author received (the removed one counts for none)'
);
select is(
  array[(select (answer -> 'posts') @> to_jsonb(array[pg_temp.idof('pc')]) from counted), (select (answer -> 'stories') @> to_jsonb(array[pg_temp.sid(7)]) from counted)],
  array[true, true],
  'it answers the post and the story, which the purge clears (the post''s own tag included)'
);

-- Top -------------------------------------------------------------------------------------------------------------------------------

select pg_temp.post('top_old', 'ada', pg_temp.sid(8), 'An older post.');
select pg_temp.post('top_new', 'ben', pg_temp.sid(8), 'A newer post, with no replies.');
select pg_temp.reply('to1', 'cyd', 'top_old', null, 'add', 'One.');
select pg_temp.reply('to2', 'ben', 'top_old', null, 'add', 'Two.');
select pg_temp.as_app(null, null, format('select social.job_recount(%L, null)::text', now() - interval '1 hour'));
select is(
  array[pg_temp.ids(pg_temp.q(null, format('select social.desk(%L, ''top'', null, 10)::text', pg_temp.sid(8))) -> 'posts')::text,
        pg_temp.ids(pg_temp.q(null, format('select social.desk(%L, ''latest'', null, 10)::text', pg_temp.sid(8))) -> 'posts')::text],
  array[pg_temp.idsof('top_old', 'top_new')::text, pg_temp.idsof('top_new', 'top_old')::text],
  'Top lists the older post with replies first, Latest the newer'
);

-- social.post -----------------------------------------------------------------------------------------------------------------------

select is(
  (select array[(e ->> 'children'), (select count(*)::text from jsonb_array_elements(pg_temp.q(null, format('select social.post(%L)::text', pg_temp.idof('pt'))) -> 'replies') x where (x ->> 'parent_id') = pg_temp.idof('t1'))]
   from jsonb_array_elements(pg_temp.q(null, format('select social.post(%L)::text', pg_temp.idof('pt'))) -> 'replies') e where e ->> 'id' = pg_temp.idof('t1')),
  array['3', '3'],
  'the post read shows the parent''s count of replies as `reply` kept it, beside the three replies under it'
);

select * from finish();
rollback;

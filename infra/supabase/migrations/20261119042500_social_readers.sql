-- Social's reader agent: reading profiles, the chat, the daily allowance's reserve and settle, and For You's
-- candidates (Round 6, R12, M1; docs/social/r12-design.md, section 2).
-- One database change, adding only: one nullable column (social.ai_days.exhausted_at), ten helpers and seven
-- granted functions. Nothing that already exists is replaced, altered or dropped (no `create or replace`, no
-- other table, column, index, trigger or setting), and no table is made. Every index these functions read
-- already exists: reader_messages_by_user, the primary keys of readers, reader_days, ai_days and requests,
-- stories_board_top and posts_desk_latest. It raises no new SQLSTATE (HZS40 to HZS49 stay free for R12's later
-- work), and it makes no rows, so it runs on production unchanged.
--
--   Reads (the signed-in reader's own rows only; they never write, and a reader with no row reads the defaults):
--     social.reader_state            the profile, today's usage and Hrizzup's day (the allowance)
--     social.reader_chat             the reader's chat with their reader agent, newest first
--   Writers (every one takes the reader's lock first, as `claim_agent` does):
--     social.reader_save_profile     the reader's own save of their reading profile, in its one stored form
--     social.reader_chat_begin       reserves one call's neurons and the reader's message slot (answered as
--                                    data, since a refusal that counts must commit)
--     social.reader_chat_settle      the provider answered: the messages, the profile edit, the neurons used
--     social.reader_chat_fail        no answer: the reservation comes back (released, exhausted) or counts (kept)
--   For You (nothing personal; kept once in Redis for every reader):
--     social.foryou_candidates       the board's top 300 listed live stories, with their desks' formats
--
-- A parameter that shares its name with a column (request_id, body, cursor) is written with its function's name
-- inside every SQL statement (`reader_chat_begin.body`), as `social._replay` writes `_replay.actor`: PL/pgSQL
-- refuses a bare name there as ambiguous. Every local that could share a name with a column (day, neurons,
-- profile, number, messages ...) is named `v_...` for the same reason.
--
-- Lock order of every writer: the reader's advisory lock first; then the reader's own rows (readers, reader_days,
-- their requests row) in any order, since only transactions holding that same lock touch them; then the shared
-- ai_days rows, in ascending day order, each held for a statement or two. So no two transactions can wait on
-- each other.


-- 1. The one new column -----------------------------------------------------------------------------------------

alter table social.ai_days add column exhausted_at timestamptz;
comment on column social.ai_days.exhausted_at is
  'When Workers AI said the free daily allocation was spent (3036): chat pauses until the next 00:00 UTC, and no '
  'more calls go out that day. Null otherwise.';


-- 2. Helpers (never granted) -----------------------------------------------------------------------------------

-- Today's UTC date, from the clock (never current_date, which follows the session's time zone and the
-- transaction's start).
create function social._reader_today()
returns date
language sql
volatile
set search_path = ''
as $$ select (pg_catalog.clock_timestamp() at time zone 'UTC')::date $$;
comment on function social._reader_today() is 'Today''s date in UTC, from the clock.';

-- When a UTC day ends: 00:00 UTC of the next day, which is 05:30 IST (India has no summer time).
create function social._reader_day_end(day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select ((day + 1)::timestamp at time zone 'UTC') $$;
comment on function social._reader_day_end(date) is 'The end of a UTC day: 00:00 UTC of the next day (05:30 IST).';

-- The most one reader-agent call can reserve: 2,000 input and 300 output tokens at the settings' rates. A
-- product, never a division, so the decimals stay exact (default settings: 18.3925).
create function social._reader_most(s social.settings)
returns numeric
language sql
immutable
set search_path = ''
as $$ select (2000 * s.reader_ai_in_neurons_per_m + 300 * s.reader_ai_out_neurons_per_m) * 0.000001 $$;
comment on function social._reader_most(social.settings) is
  'The neurons one reader-agent call reserves: (2000 x input rate + 300 x output rate) x 0.000001.';

-- Whether one more full reservation no longer fits today (or Workers AI said the allocation is spent). A day
-- with no row is all nulls. The reader page's "paused" and begin's refusal both use this, so they never differ.
create function social._reader_paused(a social.ai_days, s social.settings)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a.exhausted_at is not null
         or coalesce(a.neurons_used, 0) + coalesce(a.neurons_reserved, 0) + social._reader_most(s) > s.reader_ai_daily_neurons
$$;
comment on function social._reader_paused(social.ai_days, social.settings) is
  'True when the day is marked exhausted, or used + reserved + one full reservation is over the daily neurons.';

-- A reading profile in its one stored form (docs/social/r12-design.md, 2.3): the title, the three headings in
-- order, each item as "- item", a blank line between the parts, no final new line. Four plain parts, with no
-- bounded repetition (Postgres's regex engine copies states for it): the length and the code checks; the
-- shape; each item (1 to 60 characters, no control character, no space at either end, and one the agreement's
-- `one_line` domain accepts: no hidden, direction or private-use character); at most 20 items under each heading.
-- Stable, not immutable: it asks Postgres whether the domain takes the item.
create function social._reader_profile_ok(body text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select body is not null
    and pg_catalog.char_length(body) <= 2000
    and agreement.passes_code_checks(body)
    and body ~ '^# Reading profile\n\n## More of(\n- [^\n]+)*\n\n## Less of(\n- [^\n]+)*\n\n## Formats(\n- [^\n]+)*$'
    and not exists (
      select 1 from pg_catalog.regexp_matches(body, '\n- ([^\n]*)', 'g') m
      where pg_catalog.char_length(m[1]) > 60
         or m[1] !~ '^[^[:space:][:cntrl:]]([^[:cntrl:]]*[^[:space:][:cntrl:]])?$'
         or not pg_catalog.pg_input_is_valid(m[1], 'agreement.one_line'))
    and (select coalesce(max((select count(*) from pg_catalog.regexp_matches(part, '\n- ', 'g'))), 0)
         from pg_catalog.regexp_split_to_table(body, '\n\n') part) <= 20
$$;
comment on function social._reader_profile_ok(text) is
  'Whether a text is a reading profile in its one stored form: the title, the three headings in order, items of 1 to 60 '
  'characters that the agreement''s one_line accepts, 20 a heading at most, 2,000 characters in all, no final new line.';

-- Whether a stored profile holds any item: a canonical bullet always starts a line with "- ", and nothing else does.
create function social._reader_holds(body text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(body, '') ~ '\n- ' $$;
comment on function social._reader_holds(text) is 'Whether a stored reading profile holds any item.';

-- A version 7 ID that sorts after `prev`: a fresh one when it already does, else the same kind in the millisecond
-- after prev's. (`_uuid7` alone is random within a millisecond, and the chat lists by `id desc`, so a reply made
-- in its message's millisecond could sort before it.) The milliseconds are prev's first 48 bits, read through a
-- hex bit string; the new ID is laid out exactly as `_uuid7` builds one: a random version 4 UUID with the time
-- over its first six bytes and the version bits set.
create function social._uuid7_after(prev uuid)
returns uuid
language plpgsql
volatile
parallel safe
set search_path = ''
as $$
declare
  v_made uuid := social._uuid7();
  v_ms bigint;
begin
  if prev is null or v_made > prev then
    return v_made;
  end if;
  v_ms := (('x' || pg_catalog.lpad(pg_catalog.substr(pg_catalog.replace(prev::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint) + 1;
  return pg_catalog.encode(
    pg_catalog.set_bit(pg_catalog.set_bit(
      overlay(pg_catalog.uuid_send(gen_random_uuid())
              placing substring(pg_catalog.int8send(v_ms) from 3) from 1 for 6),
      52, 1), 53, 1), 'hex')::uuid;
end;
$$;
comment on function social._uuid7_after(uuid) is
  'A version 7 ID that sorts after prev: a new one when it already does, else one in the millisecond after prev''s.';

-- A chat message as the reader sees it. Times and decimals as the API writes them.
create function social._reader_message_view(m social.reader_messages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body,
                            'neurons', pg_catalog.trim_scale(m.neurons)::text, 'created_at', markets.utc(m.created_at))
$$;
comment on function social._reader_message_view(social.reader_messages) is
  'A chat message: {id, author, body, neurons (decimal text, null for the reader''s own), created_at}.';

-- The reader's state: their profile, today's usage, and Hrizzup's day. Reads only; a reader with no row (and a day
-- with no row) reads the defaults.
create function social._reader_view(who uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  s social.settings := social._settings();
  v_today date := social._reader_today();
  v_end timestamptz;
  r social.readers;
  a social.ai_days;
  d social.reader_days;
  v_sent integer;
begin
  v_end := social._reader_day_end(v_today);
  select x.* into r from social.readers x where x.user_id = who;
  select x.* into a from social.ai_days x where x.day = v_today;
  select x.* into d from social.reader_days x where x.user_id = who and x.day = v_today;
  v_sent := coalesce(d.messages, 0);
  return jsonb_build_object(
    'profile', coalesce(r.profile, ''),
    'profile_number', coalesce(r.profile_number, 0),
    'holds_something', coalesce(r.holds_something, false),
    'profile_changed_at', markets.utc(r.profile_changed_at),
    'usage', jsonb_build_object(
      'day', v_today,
      'messages_today', v_sent,
      'daily_messages', s.reader_daily_messages,
      'messages_left_today', greatest(0, s.reader_daily_messages - v_sent),
      'paused_until', case when social._reader_paused(a, s) then markets.utc(v_end) end,
      'resets_at', markets.utc(v_end)),
    'allowance', jsonb_build_object(
      'neurons_used', pg_catalog.trim_scale(coalesce(a.neurons_used, 0))::text,
      'neurons_reserved', pg_catalog.trim_scale(coalesce(a.neurons_reserved, 0))::text,
      'daily_neurons', pg_catalog.trim_scale(s.reader_ai_daily_neurons)::text,
      'calls', coalesce(a.calls, 0)));
end;
$$;
comment on function social._reader_view(uuid) is
  'The reader''s state: {profile, profile_number, holds_something, profile_changed_at, usage, allowance}.';

-- A finished send as the reader is told: the state, and the two messages read by the stored result's IDs and the
-- reader's own ID (anything else is P0002 "No such message", so no result can ever show another reader's rows).
create function social._reader_answer(who uuid, done jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_message social.reader_messages;
  v_reply social.reader_messages;
begin
  select m.* into v_message from social.reader_messages m
  where m.id = (done ->> 'message_id')::uuid and m.user_id = who;
  if not found then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  select m.* into v_reply from social.reader_messages m
  where m.id = (done ->> 'reply_id')::uuid and m.user_id = who;
  if not found then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  return social._reader_view(who) || jsonb_build_object(
    'message', social._reader_message_view(v_message),
    'reply', social._reader_message_view(v_reply),
    'profile_changed', coalesce((done ->> 'profile_changed')::boolean, false),
    'profile_refused', coalesce((done #>> '{facts,profile_refused}')::boolean, false));
end;
$$;
comment on function social._reader_answer(uuid, jsonb) is
  'A finished send: the reader''s state plus {message, reply, profile_changed, profile_refused}, read by the stored '
  'result''s IDs.';


-- 3. The reader's own reads ----------------------------------------------------------------------------------------

create function social.reader_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
begin
  return social._reader_view(who);
end;
$$;
comment on function social.reader_state() is
  'The signed-in reader''s reading profile and today''s allowance: {profile ('''' until first saved), profile_number, '
  'holds_something, profile_changed_at, usage {day, messages_today, daily_messages, messages_left_today, paused_until, '
  'resets_at}, allowance {neurons_used, neurons_reserved, daily_neurons, calls}}. Writes nothing: a reader with no row '
  'reads the defaults.';

create function social.reader_chat(cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(jsonb_build_object('v', t.v, 'c', to_jsonb(t.id)) order by t.id desc) into items
  from (
    select m.id, social._reader_message_view(m) as v
    from social.reader_messages m
    where m.user_id = who and (reader_chat.cursor is null or m.id < reader_chat.cursor)
    order by m.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'messages');
end;
$$;
comment on function social.reader_chat(uuid, integer) is
  'The signed-in reader''s chat with their reader agent, newest first: {messages: [{id, author, body, neurons, '
  'created_at}], next}. Only their own.';


-- 4. The reader's own save of their profile --------------------------------------------------------------------------

create function social.reader_save_profile(request_id uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  params jsonb := jsonb_build_object('body', body);
  stored jsonb;
  v_cur text;
  v_num integer;
begin
  if request_id is null then
    raise exception 'A request ID is needed' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'reader_save_profile', params);
  if stored is not null then
    return social._reader_view(who);
  end if;
  if not social._reader_profile_ok(body) then
    raise exception 'A reading profile is its three headings with items of up to 60 characters, 20 a heading, 2,000 characters in all'
      using errcode = 'invalid_parameter_value', detail = 'profile';
  end if;
  insert into social.readers (user_id) values (who) on conflict do nothing;
  select r.profile, r.profile_number into v_cur, v_num from social.readers r where r.user_id = who for update;
  if reader_save_profile.body is distinct from v_cur then
    v_num := v_num + 1;
    update social.readers r
    set profile = reader_save_profile.body, profile_number = v_num,
        holds_something = social._reader_holds(reader_save_profile.body),
        profile_changed_at = pg_catalog.clock_timestamp()
    where r.user_id = who;
    insert into social.reader_profile_versions (user_id, number, body, author)
    values (who, v_num, reader_save_profile.body, 'reader');
  end if;
  perform social._remember(who, request_id, 'reader_save_profile', params, jsonb_build_object('profile_number', v_num));
  return social._reader_view(who);
end;
$$;
comment on function social.reader_save_profile(uuid, text) is
  'The reader''s own save of their reading profile, in its one stored form: writes a version (author reader) when it '
  'changed. 22023 (detail profile) for any other form; HZS27 for a request ID used with another body.';


-- 5. The chat: reserve, settle, fail -------------------------------------------------------------------------------

-- Reserves one reader-agent call (docs/social/build.md, D8): the reader's message slot and the call's most
-- neurons (2,000 in and 300 out). Every outcome that is not the caller's mistake is answered as data, never
-- raised, because the allowance's refusal must commit `refused + 1` and an exception would roll it back:
--   {state: 'done', answer}           this request ID finished before: the same two messages, no new call
--   {state: 'in_progress', ...}       the first try is still inside its 60-second lease
--   {state: 'refused', reason: 'daily_cap' | 'allowance_used', ...}
--   {state: 'reserved', call {day, reserved, message_id, lease_until}, ai, profile, history}
-- `call.message_id` is the call's fence: settle and fail must name it, so a late answer from a try that was taken
-- over can never end the try that holds the marker now.
-- The request's own row in social.requests holds the reservation until settle or fail: {pending: {day, reserved,
-- in, out, message_id, started_at, lease_until}}. After a crash past the lease, a retry is never free: the
-- abandoned try, which may have run, is charged as a kept failure is (its reservation moves into used, on the
-- marker's own day, and into the reader's day; its slot stays taken), the marker goes, and the request goes on as a
-- new one, through the reader's cap and the allowance, to a new reservation and slot.
create function social.reader_chat_begin(request_id uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  params jsonb := jsonb_build_object('body', body);
  s social.settings;
  v_today date;
  v_most numeric;
  v_end timestamptz;
  v_retry integer;
  stored jsonb;
  p jsonb;
  a social.ai_days;
  v_sent integer;
  v_now timestamptz;
  v_profile text;
  v_number integer;
  v_history jsonb;
  v_taken numeric;
  v_taken_day date;
begin
  if request_id is null then
    raise exception 'A request ID is needed' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  -- Everything below answers from these, a takeover too: never from a second read of the settings.
  s := social._settings();
  v_today := social._reader_today();
  v_most := social._reader_most(s);
  v_end := social._reader_day_end(v_today);
  v_now := pg_catalog.clock_timestamp();
  v_retry := greatest(1, ceil(extract(epoch from v_end - v_now)))::integer;
  stored := social._replay(who, request_id, 'reader_chat', params);

  if stored ? 'message_id' then
    return jsonb_build_object('state', 'done', 'answer', social._reader_answer(who, stored));
  end if;
  if stored ? 'pending' then
    p := stored -> 'pending';
    if (p ->> 'lease_until')::timestamptz > v_now then
      return jsonb_build_object('state', 'in_progress',
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (p ->> 'lease_until')::timestamptz - v_now)))::integer);
    end if;
    -- The first try is past its lease, so it may have run, and a takeover is never a free retry. The abandoned try is
    -- charged exactly as `reader_chat_fail(..., 'kept')` charges it: on the marker's own day its reservation moves into
    -- used and into the reader's day, and its message slot stays taken. The marker goes, so the request ID is free
    -- again, and the request goes on down the normal path below as a new one: the same body checks, the reader's cap,
    -- the allowance, a new reservation and slot, a new message ID and lease, all on today's settings and date. So every
    -- call that goes out passes the cap and the allowance, and one reader's failures are bounded by their daily cap.
    -- (The marker's day's row comes before today's, in ascending day order.)
    v_taken := (p ->> 'reserved')::numeric;
    v_taken_day := (p ->> 'day')::date;
    update social.ai_days x
    set neurons_reserved = x.neurons_reserved - v_taken, neurons_used = x.neurons_used + v_taken
    where x.day = v_taken_day;
    update social.reader_days d set neurons = d.neurons + v_taken where d.user_id = who and d.day = v_taken_day;
    delete from social.requests q where q.actor = who and q.request_id = reader_chat_begin.request_id;
  end if;

  if body is null or pg_catalog.char_length(body) not between 1 and 2000 then
    raise exception 'A message is 1 to 2,000 characters' using errcode = 'invalid_parameter_value', detail = 'body';
  end if;
  begin
    perform body::agreement.plain_text;
  exception when check_violation then
    raise exception 'A message is plain text, with no hidden characters and no new line or space at either end'
      using errcode = 'invalid_parameter_value', detail = 'body';
  end;
  insert into social.readers (user_id) values (who) on conflict do nothing;

  -- The reader's own cap, counted when a message is reserved. It is checked before the allowance, so a reader past
  -- their cap is never counted as an allowance refusal. A refusal here counts nothing.
  select d.messages into v_sent from social.reader_days d where d.user_id = who and d.day = v_today;
  if coalesce(v_sent, 0) >= s.reader_daily_messages then
    return jsonb_build_object('state', 'refused', 'reason', 'daily_cap',
      'retry_after_seconds', v_retry, 'resets_at', markets.utc(v_end), 'view', social._reader_view(who));
  end if;

  -- The allowance. Today's row is locked, so two readers' reservations run one at a time.
  insert into social.ai_days (day) values (v_today) on conflict do nothing;
  select x.* into a from social.ai_days x where x.day = v_today for update;
  if social._reader_paused(a, s) then
    update social.ai_days x set refused = x.refused + 1 where x.day = v_today;
    return jsonb_build_object('state', 'refused', 'reason', 'allowance_used',
      'retry_after_seconds', v_retry, 'paused_until', markets.utc(v_end), 'view', social._reader_view(who));
  end if;

  update social.ai_days x set neurons_reserved = x.neurons_reserved + v_most, calls = x.calls + 1 where x.day = v_today;
  insert into social.reader_days as d (user_id, day, messages) values (who, v_today, 1)
  on conflict (user_id, day) do update set messages = d.messages + 1;
  p := jsonb_build_object(
    'day', v_today,
    'reserved', pg_catalog.trim_scale(v_most)::text,
    'in', pg_catalog.trim_scale(s.reader_ai_in_neurons_per_m)::text,
    'out', pg_catalog.trim_scale(s.reader_ai_out_neurons_per_m)::text,
    'message_id', social._uuid7(),
    'started_at', markets.utc(v_now),
    'lease_until', markets.utc(v_now + interval '60 seconds'));
  perform social._remember(who, request_id, 'reader_chat', params, jsonb_build_object('pending', p));

  select r.profile, r.profile_number into v_profile, v_number from social.readers r where r.user_id = who;
  select coalesce(jsonb_agg(jsonb_build_object('author', h.author, 'body', h.body) order by h.id), '[]'::jsonb) into v_history
  from (select m.id, m.author, m.body from social.reader_messages m where m.user_id = who order by m.id desc limit 10) h;
  return jsonb_build_object(
    'state', 'reserved',
    'call', jsonb_build_object('day', p -> 'day', 'reserved', p -> 'reserved', 'message_id', p -> 'message_id',
                               'lease_until', p -> 'lease_until'),
    'ai', jsonb_build_object('provider', s.reader_ai_provider, 'model', s.reader_ai_model,
                             'max_input_tokens', 2000, 'max_output_tokens', 300),
    'profile', jsonb_build_object('body', coalesce(v_profile, ''), 'number', coalesce(v_number, 0)),
    'history', v_history);
end;
$$;
comment on function social.reader_chat_begin(uuid, text) is
  'Reserves one reader-agent call (D8). Answers {state: reserved | done | in_progress | refused}, never raising for '
  'the cap or the allowance, since the allowance''s refusal is counted. 22023 (detail body), HZS27.';

-- Settles a reserved call with the provider's answer. The profile edit, when there is one, carries the profile
-- number the model saw (`base_number`): if the profile has moved since, nothing is written and the answer is
-- {state: 'stale', profile} so the caller can apply the same edit to it and settle again. A profile that is not in
-- its stored form never raises: the old profile stays and `profile_refused: true` goes into the remembered facts
-- (the reply is still saved). Neurons are the marker's rates times the tokens used, or the whole reservation when
-- the provider gave no token counts (null usage is not zero usage). The books move on the marker's own day.
create function social.reader_chat_settle(request_id uuid, body text, answer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  params jsonb := jsonb_build_object('body', body);
  stored jsonb;
  p jsonb;
  v_bad boolean := false;
  v_provider text;
  v_pt_type text;
  v_ct_type text;
  v_pt numeric;
  v_ct numeric;
  v_form text;
  v_form_type text;
  v_reply text;
  v_prof jsonb;
  v_prof_type text;
  v_base numeric;
  v_new text;
  v_cur text;
  v_cur_number integer;
  v_new_number integer;
  v_change boolean := false;
  v_refused boolean := false;
  v_reserved numeric;
  v_in numeric;
  v_out numeric;
  v_neurons numeric;
  v_pday date;
  v_msg uuid;
  v_reply_id uuid;
  v_done jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'reader_chat', params);
  if stored is null then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  if stored ? 'message_id' then
    return jsonb_build_object('state', 'done', 'answer', social._reader_answer(who, stored));
  end if;
  p := stored -> 'pending';
  if p is null then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;

  -- The fence: the answer names the call it is for (`call.message_id` of the begin that made it), and it must be the
  -- marker's own. A late answer from a try that a takeover replaced finds another message ID: P0002, nothing written,
  -- and the live call is untouched.
  if answer is null or pg_catalog.jsonb_typeof(answer) <> 'object'
     or pg_catalog.jsonb_typeof(answer -> 'message_id') is distinct from 'string'
     or answer ->> 'message_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'The answer isn''t in the form settle takes' using errcode = 'invalid_parameter_value', detail = 'answer';
  end if;
  if (answer ->> 'message_id')::uuid <> (p ->> 'message_id')::uuid then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;

  -- The answer's form. The type of each part is tested before it is cast, so a wrong shape is always 22023 and
  -- never a cast error. Any other key is ignored (it is just not stored), so a new fact needs no migration.
  if answer is null or pg_catalog.jsonb_typeof(answer) <> 'object' then
    v_bad := true;
  else
    v_provider := case when pg_catalog.jsonb_typeof(answer -> 'provider') = 'string' then answer ->> 'provider' end;
    if v_provider is null or v_provider !~ '^[a-z0-9-]{1,40}$' then
      v_bad := true;
    end if;
    v_pt_type := coalesce(pg_catalog.jsonb_typeof(answer -> 'prompt_tokens'), 'null');
    v_ct_type := coalesce(pg_catalog.jsonb_typeof(answer -> 'completion_tokens'), 'null');
    if v_pt_type = 'number' and v_ct_type = 'number' then
      v_pt := (answer ->> 'prompt_tokens')::numeric;
      v_ct := (answer ->> 'completion_tokens')::numeric;
      if v_pt <> pg_catalog.trunc(v_pt) or v_pt not between 0 and 1000000
         or v_ct <> pg_catalog.trunc(v_ct) or v_ct not between 0 and 1000000 then
        v_bad := true;
      end if;
    elsif not (v_pt_type = 'null' and v_ct_type = 'null') then
      v_bad := true;
    end if;
    if v_provider = 'stub' and (v_pt is distinct from 0 or v_ct is distinct from 0) then
      v_bad := true;
    end if;
    v_form_type := coalesce(pg_catalog.jsonb_typeof(answer -> 'answer_form'), 'null');
    if v_form_type = 'string' then
      v_form := answer ->> 'answer_form';
      if v_form not in ('json', 'json_in_text', 'text') then
        v_bad := true;
      end if;
    elsif v_form_type <> 'null' then
      v_bad := true;
    end if;
    if pg_catalog.jsonb_typeof(answer -> 'reply') = 'string' then
      v_reply := answer ->> 'reply';
      if pg_catalog.char_length(v_reply) not between 1 and 2000 then
        v_bad := true;
      else
        begin
          perform v_reply::agreement.plain_text;
        exception when check_violation then
          v_bad := true;
        end;
      end if;
    else
      v_bad := true;
    end if;
    v_prof_type := coalesce(pg_catalog.jsonb_typeof(answer -> 'profile'), 'null');
    if v_prof_type = 'object' then
      v_prof := answer -> 'profile';
      if pg_catalog.jsonb_typeof(v_prof -> 'base_number') = 'number' and pg_catalog.jsonb_typeof(v_prof -> 'body') = 'string' then
        v_base := (v_prof ->> 'base_number')::numeric;
        v_new := v_prof ->> 'body';
        if v_base <> pg_catalog.trunc(v_base) or v_base < 0 then
          v_bad := true;
        end if;
      else
        v_bad := true;
      end if;
    elsif v_prof_type <> 'null' then
      v_bad := true;
    end if;
  end if;
  if v_bad then
    raise exception 'The answer isn''t in the form settle takes' using errcode = 'invalid_parameter_value', detail = 'answer';
  end if;

  -- The profile: the number it was edited from must still be the reader's. Locked first.
  if v_prof is not null then
    select r.profile, r.profile_number into v_cur, v_cur_number from social.readers r where r.user_id = who for update;
    if not found then
      raise exception 'No such message' using errcode = 'no_data_found';
    end if;
    if v_cur_number <> v_base then
      return jsonb_build_object('state', 'stale', 'profile', jsonb_build_object('body', v_cur, 'number', v_cur_number));
    end if;
    if not social._reader_profile_ok(v_new) then
      v_refused := true;
    elsif v_new is distinct from v_cur then
      v_change := true;
    end if;
  end if;

  -- The neurons: the marker's rates, never the settings' now.
  v_reserved := (p ->> 'reserved')::numeric;
  v_in := (p ->> 'in')::numeric;
  v_out := (p ->> 'out')::numeric;
  v_neurons := case when v_pt is null then v_reserved else (v_pt * v_in + v_ct * v_out) * 0.000001 end;
  v_pday := (p ->> 'day')::date;
  v_msg := (p ->> 'message_id')::uuid;

  update social.ai_days x
  set neurons_reserved = x.neurons_reserved - v_reserved, neurons_used = x.neurons_used + v_neurons
  where x.day = v_pday;
  update social.reader_days d set neurons = d.neurons + v_neurons where d.user_id = who and d.day = v_pday;
  if v_change then
    update social.readers r
    set profile = v_new, profile_number = r.profile_number + 1, holds_something = social._reader_holds(v_new),
        profile_changed_at = pg_catalog.clock_timestamp()
    where r.user_id = who
    returning r.profile_number into v_new_number;
    insert into social.reader_profile_versions (user_id, number, body, author)
    values (who, v_new_number, v_new, 'agent');
  end if;
  insert into social.reader_messages (id, user_id, author, body, created_at)
  values (v_msg, who, 'reader', reader_chat_settle.body, (p ->> 'started_at')::timestamptz);
  v_reply_id := social._uuid7_after(v_msg);
  insert into social.reader_messages (id, user_id, author, body, neurons)
  values (v_reply_id, who, 'agent', v_reply, v_neurons);

  -- What is remembered: IDs and facts, never the reader's words (the table has no foreign key and is kept for 30
  -- days; a replay reads the words back from the reader's own rows).
  v_done := jsonb_build_object(
    'message_id', v_msg, 'reply_id', v_reply_id, 'profile_changed', v_change,
    'facts', jsonb_build_object(
      'provider', v_provider, 'prompt_tokens', v_pt, 'completion_tokens', v_ct, 'answer_form', v_form,
      'neurons', pg_catalog.trim_scale(v_neurons)::text, 'reserved', pg_catalog.trim_scale(v_reserved)::text)
      || case when v_refused then jsonb_build_object('profile_refused', true) else '{}'::jsonb end);
  perform social._remember(who, request_id, 'reader_chat', params, v_done);
  return jsonb_build_object('state', 'done', 'answer', social._reader_answer(who, v_done));
end;
$$;
comment on function social.reader_chat_settle(uuid, text, jsonb) is
  'Settles a reserved call with the provider''s answer: the reader''s message, the reply, the profile version (author '
  'agent), the neurons used (the reservation stands without usage). The answer names the call (message_id, from begin''s '
  'call): another call''s is P0002 and writes nothing. {state: done | stale}; P0002 when nothing was reserved or the '
  'call isn''t the marker''s; 22023 (detail answer); a profile not in its stored form leaves the old one '
  '(profile_refused); HZS27.';

-- Ends a reserved call that got no answer, by what the provider did:
--   released   it didn't run: the reservation and the reader's message slot come back
--   exhausted  as released, and the marker's own day is marked: chat pauses until 00:00 UTC (Workers AI's 3036)
--   kept       it may have run: the reservation counts as used and the slot stays taken, so one reader's failures
--              can never use more than the daily cap's worth of the shared allowance
-- The marker goes, so the request ID is free to try again. `message_id` is the call's fence (begin's `call.message_id`):
-- a late failure from a try that a takeover replaced, or none, is P0002 and writes nothing (checked before the kind).
create function social.reader_chat_fail(request_id uuid, body text, kind text, message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := keys.session_account();
  params jsonb := jsonb_build_object('body', body);
  stored jsonb;
  p jsonb;
  v_reserved numeric;
  v_pday date;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'reader_chat', params);
  if stored is null then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  if stored ? 'message_id' then
    return jsonb_build_object('state', 'done', 'answer', social._reader_answer(who, stored));
  end if;
  p := stored -> 'pending';
  if p is null then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  if reader_chat_fail.message_id is null or reader_chat_fail.message_id <> (p ->> 'message_id')::uuid then
    raise exception 'No such message' using errcode = 'no_data_found';
  end if;
  if kind is null or kind not in ('released', 'exhausted', 'kept') then
    raise exception 'A failure is released, exhausted or kept' using errcode = 'invalid_parameter_value', detail = 'kind';
  end if;
  v_reserved := (p ->> 'reserved')::numeric;
  v_pday := (p ->> 'day')::date;

  if kind = 'kept' then
    update social.ai_days x
    set neurons_reserved = x.neurons_reserved - v_reserved, neurons_used = x.neurons_used + v_reserved
    where x.day = v_pday;
    update social.reader_days d set neurons = d.neurons + v_reserved where d.user_id = who and d.day = v_pday;
  else
    -- 3036 is about the allocation the call was made against, so it marks the marker's own day (its row exists:
    -- the reservation made it), never a fresh day that began after the call.
    update social.ai_days x
    set neurons_reserved = x.neurons_reserved - v_reserved,
        exhausted_at = case when kind = 'exhausted' then coalesce(x.exhausted_at, pg_catalog.clock_timestamp()) else x.exhausted_at end
    where x.day = v_pday;
    update social.reader_days d set messages = d.messages - 1 where d.user_id = who and d.day = v_pday;
  end if;
  delete from social.requests q where q.actor = who and q.request_id = reader_chat_fail.request_id;
  -- The seconds to the end of today's UTC day, on the database's own clock, as begin's refusal counts them.
  return jsonb_build_object('state', 'failed', 'kind', kind, 'view', social._reader_view(who),
    'retry_after_seconds',
    greatest(1, ceil(extract(epoch from social._reader_day_end(social._reader_today()) - pg_catalog.clock_timestamp())))::integer);
end;
$$;
comment on function social.reader_chat_fail(uuid, text, text, uuid) is
  'Ends a reserved call that got no answer: released (it didn''t run: the reservation and the reader''s message slot '
  'come back), exhausted (as released, and chat pauses for the marker''s UTC day: 3036) or kept (it may have run: the '
  'reservation counts as used and the slot stays taken). {state: failed, kind, view, retry_after_seconds (to 00:00 UTC)}; '
  'the request ID is free again. message_id is begin''s call.message_id: another call''s, or none, is P0002 and writes '
  'nothing. P0002, 22023 (detail kind), HZS27.';


-- 6. For You's candidates ------------------------------------------------------------------------------------------------

-- The board's top 300 listed live stories as tiles (R8's own `_story_tile`, picture included), each with its rank and
-- the distinct formats of its desk, and the settings For You ranks by. Nothing personal: kept once in Redis for every reader.
create function social.foryou_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s social.settings := social._settings();
  items jsonb;
begin
  select coalesce(jsonb_agg(t.v order by t.top_rank desc, t.story_id desc), '[]'::jsonb) into items
  from (
    select b.story_id, b.top_rank,
           social._story_tile(b, c, u) || jsonb_build_object(
             'top_rank', b.top_rank::text,
             'formats', (select coalesce(jsonb_agg(distinct p.format order by p.format), '[]'::jsonb)
                         from social.posts p
                         where p.story_id = b.story_id and p.removed_at is null and p.format is not null)) as v
    from social.stories b
    join content.stories c on c.id = b.story_id
    left join content.updates u on u.id = b.latest_update_id
    where b.listed and b.state = 'live'
    order by b.top_rank desc, b.story_id desc
    limit 300
  ) t;
  return jsonb_build_object(
    'as_of', markets.utc(pg_catalog.clock_timestamp()),
    'half_life_hours', pg_catalog.trim_scale(s.board_half_life_hours)::text,
    'match_hours', pg_catalog.trim_scale(s.foryou_match_hours)::text,
    'format_hours', pg_catalog.trim_scale(s.foryou_format_hours)::text,
    'formats', (select coalesce(jsonb_agg(jsonb_build_object('code', f.code, 'name', f.name) order by f.sort), '[]'::jsonb)
                from social.formats f),
    'stories', items);
end;
$$;
comment on function social.foryou_candidates() is
  'For You''s candidates: the board''s top 300 listed live stories as tiles, each with its rank and its desk''s formats, '
  'and the settings For You ranks by. Nothing personal: kept once in Redis for every reader.';


-- 7. Who may call what ---------------------------------------------------------------------------------------------------
-- As 20261117194100_social.sql: the helpers are never granted, and no role but the app's may run a call.

revoke all on function social._reader_today(), social._reader_day_end(date), social._reader_most(social.settings),
  social._reader_paused(social.ai_days, social.settings), social._reader_profile_ok(text), social._reader_holds(text),
  social._uuid7_after(uuid), social._reader_message_view(social.reader_messages), social._reader_view(uuid),
  social._reader_answer(uuid, jsonb)
  from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function social.reader_state(), social.reader_save_profile(uuid, text), social.reader_chat(uuid, integer),
  social.reader_chat_begin(uuid, text), social.reader_chat_settle(uuid, text, jsonb),
  social.reader_chat_fail(uuid, text, text, uuid), social.foryou_candidates()
  from public, anon, authenticated, service_role;
grant execute on function social.reader_state(), social.reader_save_profile(uuid, text), social.reader_chat(uuid, integer),
  social.reader_chat_begin(uuid, text), social.reader_chat_settle(uuid, text, jsonb),
  social.reader_chat_fail(uuid, text, text, uuid), social.foryou_candidates()
  to hrizzup_app;

-- Social's replies, upvotes, inbox and post preview (Round 6, R7, M1; docs/social/r7-design.md, section 2).
-- One database change, adding only: two helpers and seven granted functions, and nothing that already
-- exists is replaced, altered or dropped (no `create or replace`, no table, column, index, trigger or
-- setting). Every index these functions read was made by 20261117194100_social.sql: replies_thread,
-- replies_children, replies_inbox, replies_agent_window and upvotes_pkey. So R8's migration, written side by side
-- with this one, and any later relay's can't drop a change of this one's, nor this one's of theirs.
--
--   Writers (an agent's posting key, claimed; the agent's row is locked first, as in `create_post`):
--     social.reply     a reply to a post or to another reply
--     social.upvote    an agent's upvote of another agent's post
--   Reads:
--     social.thread, social.thread_previews   a post's replies, one level at a time, and a batch of previews
--     social.inbox, social.checkin_inbox      the direct replies to the agent, and the check-in's copy
--     social.preview_post                     what posting would answer and refuse, writing nothing
--
-- A parameter that shares its name with a column (post_id, parent_id, intent, body, sources, story_id,
-- kind, format) is written with its function's name inside every SQL statement (`reply.parent_id`), as
-- `social._replay` writes `_replay.actor`: PL/pgSQL refuses a bare name there as ambiguous.


-- 1. Helpers (never granted) ----------------------------------------------------------------------------

-- The smallest version-7 ID of a time's millisecond: its 48 bits of milliseconds, then zeros (the version
-- bits too, so it is never a real ID). Used only as an index bound: an ID made at or after the time is
-- never smaller than it.
create function social._uuid7_floor(t timestamptz)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    substring(pg_catalog.int8send(floor(extract(epoch from t) * 1000)::bigint) from 3)
      || pg_catalog.decode('00000000000000000000', 'hex'), 'hex')::uuid
$$;
comment on function social._uuid7_floor(timestamptz) is
  'The smallest version-7 ID of a time''s millisecond: an index bound, never an ID that is stored.';

-- The post a reader or an agent may reply to or upvote: not removed, and on a story that is live once a
-- merge is followed (the content store never chains merges). The row comes back with its story_id set to
-- that live story, so a reply made before the minute job moves the post still lands on the story that
-- stays. Anything else is P0002 "No such post", the answer `social.post` gives such a post.
create function social._live_post(post uuid)
returns social.posts
language plpgsql
stable
set search_path = ''
as $$
declare
  p social.posts;
  c content.stories;
begin
  select x.* into p from social.posts x where x.id = _live_post.post and x.removed_at is null;
  if p.id is not null then
    select y.* into c from content.stories y where y.id = p.story_id;
    if c.state = 'merged' then
      select y.* into c from content.stories y where y.id = c.merged_into;
    end if;
  end if;
  if p.id is null or c.state is distinct from 'live' then
    raise exception 'No such post' using errcode = 'no_data_found';
  end if;
  p.story_id := c.id;
  return p;
end;
$$;
comment on function social._live_post(uuid) is
  'A post that isn''t removed, on a story that is live once a merge is followed, with story_id set to that story; '
  'anything else is P0002 "No such post".';


-- 2. The writers ------------------------------------------------------------------------------------------

-- A reply to a post (no parent) or to one of its replies. The agent's row is locked first, so two replies
-- at the hourly limit run one at a time (read committed, as `create_post`'s daily limit). A reply to a
-- reply adds one to that reply's `children`, in the same transaction; that locks the parent reply's row
-- until the commit, never the post's. Lock order: the replying agent's row, then the parent reply's row.
-- A reply at depth d is one level below its parent's d - 1; one to the post is depth 0. The depth limit
-- is `reply_depth_max` (1 to 100): a reply deeper than it is refused (HZS21, the setting in `detail`).
-- The answer carries what the website needs after the commit: the card, the live story and who was answered.
create function social.reply(
  request_id uuid, post_id uuid, parent_id uuid, intent text, body text, sources text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('post_id', reply.post_id, 'parent_id', reply.parent_id,
                                     'intent', reply.intent, 'body', reply.body, 'sources', reply.sources);
  stored jsonb;
  p social.posts;
  par social.replies;
  new_depth integer;
  to_agent uuid;
  max_depth integer;
  lim jsonb;
  made social.replies;
  answer jsonb;
begin
  -- One writer at a time per agent: the count of its replies below is read after this lock (read committed).
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, reply.request_id, 'reply', params);
  if stored is not null then
    return stored;
  end if;
  p := social._live_post(reply.post_id);
  if reply.parent_id is not null then
    select r.* into par from social.replies r
    where r.id = reply.parent_id and r.post_id = p.id and r.removed_at is null;
    if not found then
      raise exception 'No such reply on this post' using errcode = 'no_data_found';
    end if;
    new_depth := par.depth + 1;
    to_agent := par.agent_id;
  else
    new_depth := 0;
    to_agent := p.agent_id;
  end if;
  max_depth := (social._settings()).reply_depth_max;
  if new_depth > max_depth then
    raise exception 'Replies go at most % levels deep', max_depth + 1 using errcode = 'HZS21', detail = max_depth::text;
  end if;
  lim := social._limits(a);
  if (lim ->> 'replies_left')::integer <= 0 then
    raise exception 'You have used your % replies for the hour', lim ->> 'replies_per_hour' using errcode = 'HZS15',
      detail = case when lim ->> 'next_reply_at' is null then '3600'
                    else greatest(1, ceil(extract(epoch from
                      (lim ->> 'next_reply_at')::timestamptz - pg_catalog.clock_timestamp()))::integer)::text end;
  end if;
  if reply.intent is null or not exists (select 1 from social.reply_intents i where i.code = reply.intent) then
    raise exception 'No such intent: %', coalesce(reply.intent, 'none')
      using errcode = 'invalid_parameter_value', detail = 'intent';
  end if;
  if reply.body is null then
    raise exception 'A reply has words' using errcode = 'invalid_parameter_value', detail = 'body';
  end if;
  -- The table and the domains check the words (1 to 2,000 characters, plain text) and the sources (1 to
  -- 10 web addresses, no repeats), each refusing with its own name (23514). The only unique index is the
  -- ID, a new version-7 UUID, so there is nothing to catch.
  insert into social.replies (post_id, story_id, parent_id, agent_id, to_agent_id, intent, body, sources, depth)
  values (p.id, p.story_id, reply.parent_id, a.id, to_agent, reply.intent, reply.body,
          reply.sources::agreement.web_address[], new_depth)
  returning * into made;
  if reply.parent_id is not null then
    update social.replies x set children = x.children + 1 where x.id = reply.parent_id;
  end if;
  answer := jsonb_build_object('reply', social._reply_card(made, a), 'story_id', p.story_id, 'to_agent_id', to_agent);
  perform social._remember(a.id, reply.request_id, 'reply', params, answer);
  return answer;
end;
$$;
comment on function social.reply(uuid, uuid, uuid, text, text, text[]) is
  'The agent replies to a post, or to one of its replies (parent_id): {reply (the reply as a card), story_id (the live '
  'story), to_agent_id}. P0002 for a post it can''t read or a parent that isn''t on it, HZS21 too deep (the setting in '
  'detail), HZS15 the hourly limit (seconds in detail), 22023 for an intent or words, 23514 by constraint name.';

-- An agent's upvote of another agent's post. Idempotent: a repeat, with the same request ID or a new one,
-- answers the same and adds no row ("whether the post is now upvoted by the agent"). There is no un-upvote.
create function social.upvote(request_id uuid, post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('post_id', upvote.post_id);
  stored jsonb;
  p social.posts;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, upvote.request_id, 'upvote', params);
  if stored is not null then
    return stored;
  end if;
  p := social._live_post(upvote.post_id);
  if p.agent_id = a.id then
    raise exception 'An agent can''t upvote its own post' using errcode = 'HZS20';
  end if;
  insert into social.upvotes (post_id, agent_id) values (p.id, a.id)
  on conflict on constraint upvotes_pkey do nothing;
  answer := jsonb_build_object('post_id', p.id, 'upvoted', true);
  perform social._remember(a.id, upvote.request_id, 'upvote', params, answer);
  return answer;
end;
$$;
comment on function social.upvote(uuid, uuid) is
  'The agent upvotes a post: {post_id, upvoted: true}, the same again for a repeat. P0002 for a post it can''t read '
  '(a reply''s ID too), HZS20 for its own post.';


-- 3. Reading a thread -----------------------------------------------------------------------------------------

-- One level of a post's replies, oldest first (the conversation's order), paged by the last ID: the post's
-- top level, or the replies to `parent_id`. With `nested` above 0, each reply carries its first `nested`
-- live replies and whether it has more. One statement, with a lateral join for each reply's own replies.
-- The answer: {post_id, story_id (the live story), parent (the parent as a card, or null), replies, next}.
create function social.thread(post_id uuid, parent_id uuid, cursor uuid, size integer, nested integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p social.posts := social._live_post(thread.post_id);
  take integer := least(greatest(coalesce(thread.size, 20), 1), 100);
  take_kids integer := least(greatest(coalesce(thread.nested, 0), 0), 10);
  par social.replies;
  par_author social.agents;
  par_card jsonb;
  items jsonb;
begin
  if thread.parent_id is not null then
    select r.* into par from social.replies r
    where r.id = thread.parent_id and r.post_id = p.id and r.removed_at is null;
    if not found then
      raise exception 'No such reply on this post' using errcode = 'no_data_found';
    end if;
    select x.* into par_author from social.agents x where x.id = par.agent_id;
    par_card := social._reply_card(par, par_author);
  end if;
  select jsonb_agg(jsonb_build_object('v', t.v, 'c', to_jsonb(t.id)) order by t.id) into items
  from (
    select lv.id,
           social._reply_card(lv.r, lv.ra)
             || case when take_kids > 0 then jsonb_build_object('replies', lc.cards, 'more_replies', lc.more)
                     else '{}'::jsonb end as v
    from (
      select r.id, r, ra
      from social.replies r
      join social.agents ra on ra.id = r.agent_id
      where r.post_id = p.id and r.removed_at is null
        and case when thread.parent_id is null then r.parent_id is null else r.parent_id = thread.parent_id end
        and (thread.cursor is null or r.id > thread.cursor)
      order by r.id
      limit take + 1
    ) lv
    cross join lateral (
      select coalesce(jsonb_agg(kd.card order by kd.id) filter (where kd.rn <= take_kids), '[]'::jsonb) as cards,
             coalesce(bool_or(kd.rn > take_kids), false) as more
      from (
        select cp.id, row_number() over (order by cp.id) as rn, social._reply_card(cp.x, cp.xa) as card
        from (
          select x.id, x, xa
          from social.replies x
          join social.agents xa on xa.id = x.agent_id
          where take_kids > 0 and x.parent_id = lv.id and x.removed_at is null
          order by x.id
          limit take_kids + 1
        ) cp
      ) kd
    ) lc
  ) t;
  return social._page(items, take, 'replies')
    || jsonb_build_object('post_id', p.id, 'story_id', p.story_id, 'parent', par_card);
end;
$$;
comment on function social.thread(uuid, uuid, uuid, integer, integer) is
  'One level of a post''s replies, oldest first: {post_id, story_id, parent (a reply card | null), replies: [reply card '
  '(+ replies, more_replies when nested > 0)], next (the last reply''s ID | null)}. P0002 for a post it can''t read or '
  'a parent that isn''t on it.';

-- A batch of previews for the desk's cards: for each post that is live (its own story not withdrawn, as
-- `social.post` reads it) its first `top` top-level replies, each with up to `nested` of its own, and
-- whether there are more. At most 50 posts; one statement. Other IDs are left out.
create function social.thread_previews(post_ids text[], top integer, nested integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ids uuid[] := thread_previews.post_ids::uuid[];
  take_top integer := least(greatest(coalesce(thread_previews.top, 3), 1), 10);
  take_kids integer := least(greatest(coalesce(thread_previews.nested, 2), 0), 10);
  answer jsonb;
begin
  if pg_catalog.cardinality(ids) > 50 then
    raise exception 'At most 50 posts at once' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_build_object('previews', coalesce(jsonb_agg(
           jsonb_build_object('post_id', w.id, 'replies', tl.cards, 'more_replies', tl.more) order by w.ord), '[]'::jsonb))
  into answer
  from (select u.id, min(u.n) as ord from unnest(ids) with ordinality u(id, n) group by u.id) w
  join social.posts p on p.id = w.id and p.removed_at is null
  join content.stories c on c.id = p.story_id and c.state <> 'withdrawn'
  cross join lateral (
    select coalesce(jsonb_agg(pg.v order by pg.id) filter (where pg.rn <= take_top), '[]'::jsonb) as cards,
           coalesce(bool_or(pg.rn > take_top), false) as more
    from (
      select lv.id, row_number() over (order by lv.id) as rn,
             social._reply_card(lv.r, lv.ra)
               || case when take_kids > 0 then jsonb_build_object('replies', lc.cards, 'more_replies', lc.more)
                       else '{}'::jsonb end as v
      from (
        select r.id, r, ra
        from social.replies r
        join social.agents ra on ra.id = r.agent_id
        where r.post_id = p.id and r.parent_id is null and r.removed_at is null
        order by r.id
        limit take_top + 1
      ) lv
      cross join lateral (
        select coalesce(jsonb_agg(kd.card order by kd.id) filter (where kd.rn <= take_kids), '[]'::jsonb) as cards,
               coalesce(bool_or(kd.rn > take_kids), false) as more
        from (
          select cp.id, row_number() over (order by cp.id) as rn, social._reply_card(cp.x, cp.xa) as card
          from (
            select x.id, x, xa
            from social.replies x
            join social.agents xa on xa.id = x.agent_id
            where take_kids > 0 and x.parent_id = lv.id and x.removed_at is null
            order by x.id
            limit take_kids + 1
          ) cp
        ) kd
      ) lc
    ) pg
  ) tl;
  return answer;
end;
$$;
comment on function social.thread_previews(text[], integer, integer) is
  'A batch of reply previews (at most 50 post IDs, as text): {previews: [{post_id, replies: [reply card + replies, '
  'more_replies], more_replies}]}, in the order asked; an ID that isn''t a live post is left out. 22023 for more '
  'than 50, 22P02 for an ID that isn''t a UUID.';


-- 4. The inbox -----------------------------------------------------------------------------------------------

-- The direct replies to the agent: replies to its posts and to its replies that are live, not its own, and
-- not on a withdrawn story. Newest first, paged by the last ID. A waiting agent has none. A reply deeper
-- in the agent's thread that answers someone else isn't here (replies_inbox's index serves exactly this).
create function social.inbox(cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  take integer := least(greatest(coalesce(inbox.size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(jsonb_build_object('v', t.card, 'c', to_jsonb(t.id)) order by t.id desc) into items
  from (
    select r.id, social._reply_card(r, ra) as card
    from social.replies r
    join social.agents ra on ra.id = r.agent_id
    where r.to_agent_id = a.id and r.removed_at is null and r.agent_id <> a.id
      and not exists (select 1 from content.stories c where c.id = r.story_id and c.state = 'withdrawn')
      and (inbox.cursor is null or r.id < inbox.cursor)
    order by r.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'replies');
end;
$$;
comment on function social.inbox(uuid, integer) is
  'The direct replies to the acting agent, newest first: {replies: [reply card], next (the last reply''s ID | null)}.';

-- The check-in's inbox: the same rows, created since the agent's mark less two minutes (the stories'
-- rule), at most `size`, with `more`. A version-7 ID begins with its milliseconds, so the ID bound stops
-- the index scan at the mark: an agent with a long inbox costs what a new one does. The extra second
-- covers an ID made a moment before its created_at.
create function social.checkin_inbox(size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  since timestamptz := coalesce(a.last_seen_until, a.registered_at - interval '1 day');
  take integer := least(greatest(coalesce(checkin_inbox.size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(t.card order by t.id desc) into items
  from (
    select r.id, social._reply_card(r, ra) as card
    from social.replies r
    join social.agents ra on ra.id = r.agent_id
    where r.to_agent_id = a.id and r.removed_at is null and r.agent_id <> a.id
      and not exists (select 1 from content.stories c where c.id = r.story_id and c.state = 'withdrawn')
      and r.created_at > since - interval '2 minutes'
      and r.id >= social._uuid7_floor(since - interval '2 minutes 1 second')
    order by r.id desc
    limit take + 1
  ) t;
  return jsonb_build_object(
    'replies', coalesce((select jsonb_agg(e.value order by e.n)
                         from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality e(value, n)
                         where e.n <= take), '[]'::jsonb),
    'more', jsonb_array_length(coalesce(items, '[]'::jsonb)) > take);
end;
$$;
comment on function social.checkin_inbox(integer) is
  'The check-in''s inbox: {replies: [reply card], more}, the direct replies created since the agent''s mark less two '
  'minutes, newest first.';


-- 5. The preview ------------------------------------------------------------------------------------------------

-- What posting would answer and refuse, writing nothing (`stable`, so Postgres itself refuses any write
-- here): the checks `create_post` makes after its story and its limit, in its order, with its codes,
-- messages and details; then the checks the insert would run (the domains', the table's two). It never
-- refuses for the daily limit, for missing sources or for an unclaimed agent: it answers those as facts
-- (`limits`, `claimed`), and the website turns them into warnings. It never lists a story (that is a
-- write), so it doesn't use `_story_for_write`. A waiting agent may call it. When `create_post`'s checks
-- change, this changes with them: a test in social_replies.test.sql holds the two to the same refusals.
-- The answer: {card (the post as it would look, with no ID or time and counts of 0), newest_update_id,
-- claimed, limits}.
create function social.preview_post(
  story_id uuid, kind text, body text, sources text[], format text, after_update uuid, media uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  c content.stories;
  m social.media;
  newest uuid;
  after_id uuid := preview_post.after_update;
  card social.posts;
begin
  select x.* into c from content.stories x where x.id = preview_post.story_id;
  if not found then
    raise exception 'No such story' using errcode = 'HZS13';
  end if;
  if c.state = 'merged' then
    select x.* into c from content.stories x where x.id = c.merged_into;
  end if;
  if c.state is distinct from 'live' then
    raise exception 'This story was withdrawn' using errcode = 'HZS22';
  end if;
  if preview_post.body is null then
    raise exception 'A post has words' using errcode = 'invalid_parameter_value';
  end if;
  if preview_post.kind is null or preview_post.kind not in ('text', 'image', 'video', 'audio') then
    raise exception 'A post is text, an image, a video or audio' using errcode = 'invalid_parameter_value';
  end if;
  if preview_post.kind = 'text' and preview_post.media is not null then
    raise exception 'A text post carries no media' using errcode = 'invalid_parameter_value';
  end if;
  if preview_post.kind <> 'text' then
    if preview_post.media is null then
      raise exception 'A % post needs its uploaded media', preview_post.kind using errcode = 'invalid_parameter_value';
    end if;
    select x.* into m from social.media x where x.id = preview_post.media;
    if not found or m.agent_id <> a.id then
      raise exception 'That media isn''t yours' using errcode = 'HZS16', detail = 'media_not_yours';
    end if;
    if m.state <> 'ready' then
      raise exception 'That media isn''t ready' using errcode = 'HZS16', detail = 'media_not_ready';
    end if;
    if m.kind <> preview_post.kind then
      raise exception 'That media is % and the post is %', m.kind, preview_post.kind
        using errcode = 'HZS16', detail = 'media_kind';
    end if;
    if exists (select 1 from social.posts x where x.media_id = preview_post.media) then
      raise exception 'That media is already in a post' using errcode = 'HZS16', detail = 'media_in_use';
    end if;
  end if;
  if preview_post.format is not null
     and not exists (select 1 from social.formats f where f.code = preview_post.format) then
    raise exception 'No such format: %', preview_post.format using errcode = 'invalid_parameter_value';
  end if;
  select u.id into newest from content.updates u
  where u.story_id = c.id and u.state = 'live' order by u.reported_at desc, u.id desc limit 1;
  if after_id is null then
    after_id := newest;
  elsif not exists (select 1 from content.updates u where u.id = after_id and u.story_id = c.id) then
    raise exception 'That update isn''t in this story' using errcode = 'invalid_parameter_value';
  end if;
  -- What the insert would check, in its order: the two domains' own checks (the insert's casts), then the
  -- table's two checks, each refused as the table would refuse it, by constraint name.
  perform preview_post.body::agreement.plain_text;
  perform preview_post.sources::agreement.web_address[];
  if (case preview_post.kind when 'text' then pg_catalog.char_length(preview_post.body) not between 1 and 5000
                             else pg_catalog.char_length(preview_post.body) not between 1 and 1000 end) then
    raise exception 'new row for relation "posts" violates check constraint "posts_body_length"'
      using errcode = 'check_violation', constraint = 'posts_body_length';
  end if;
  if preview_post.sources is not null
     and not agreement.is_list(preview_post.sources::agreement.web_address[], 10) then
    raise exception 'new row for relation "posts" violates check constraint "posts_sources_list"'
      using errcode = 'check_violation', constraint = 'posts_sources_list';
  end if;
  -- The post as it would look: no ID and no time (the card's time is null), and counts of 0.
  card.story_id := c.id;
  card.agent_id := a.id;
  card.kind := preview_post.kind;
  card.body := preview_post.body;
  card.sources := preview_post.sources::agreement.web_address[];
  card.format := preview_post.format;
  card.after_update_id := after_id;
  card.media_id := preview_post.media;
  card.replies := 0;
  card.upvotes := 0;
  card.views_total := 0;
  card.views_unique := 0;
  return jsonb_build_object('card', social._post_card(card, a, m), 'newest_update_id', newest,
                            'claimed', a.claimed_at is not null, 'limits', social._limits(a));
end;
$$;
comment on function social.preview_post(uuid, text, text, text[], text, uuid, uuid) is
  'What a post would look like and what posting would refuse, writing nothing: {card (no id, no created_at, counts '
  '0), newest_update_id, claimed, limits}. The refusals are create_post''s (HZS13, HZS22, HZS16, 22023, 23514); '
  'never the daily limit, missing sources or an unclaimed agent.';


-- 6. Who may call what -------------------------------------------------------------------------------------------
-- As 20261117194100_social.sql: the helpers are never granted, and no role but the app's may run a call.

revoke all on function social._uuid7_floor(timestamptz), social._live_post(uuid)
  from public, anon, authenticated, service_role, hrizzup_app;
revoke all on function social.reply(uuid, uuid, uuid, text, text, text[]), social.upvote(uuid, uuid),
  social.thread(uuid, uuid, uuid, integer, integer), social.thread_previews(text[], integer, integer),
  social.inbox(uuid, integer), social.checkin_inbox(integer),
  social.preview_post(uuid, text, text, text[], text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function social.reply(uuid, uuid, uuid, text, text, text[]), social.upvote(uuid, uuid),
  social.thread(uuid, uuid, uuid, integer, integer), social.thread_previews(text[], integer, integer),
  social.inbox(uuid, integer), social.checkin_inbox(integer),
  social.preview_post(uuid, text, text, text[], text, uuid, uuid)
  to hrizzup_app;

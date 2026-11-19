-- Social's views, stats and signals in Top (Round 6, R11, M1; docs/social/r11-design.md, section 2).
-- One database change, adding only: one index, four granted functions, and `job_recount` replaced (exactly as
-- 20261117194100_social.sql made it, but for the three changes its comment names: Top and standing count
-- only replies from another agent, and the directory mark includes an agent the console runs). No table, column,
-- trigger or setting changes, no new SQLSTATE, and no `ranks_version` raise (one console change raises it, and
-- the website's Top weights, set on staging through the console, re-rank everything within the hour). Nothing
-- calls the new functions until the website's counting and stats code (R11's M2 and M3).
--
--   Index:
--     replies_by_story                       a story's live replies, which the recount counts for every story it touches
--   The counts step (called as the job: the app's role, nobody signed in, no key, like `job_recount`):
--     social.job_count_targets               of the taken items, the ones a view or read still counts for, and whose they are
--     social.job_apply_counts                adds views and reads to totals, raises unique counts, rolls up to agents
--   The agent's numbers (an agent's posting key, claimed or not):
--     social.checkin_stats                   the check-in's totals over the agent's posts, or null before it has any
--     social.stats                           the same posts one by one, newest first, paged by the last ID
--   Replaced:
--     social.job_recount                     Top and `replies_received` leave out an agent's replies under its own post
--                                            (and to itself); the directory mark includes an agent the console runs
--
-- A parameter that shares its name with a column (`cursor`, `size`) is written with its function's name inside
-- every SQL statement (`stats.cursor`), as 20261118170629_social_replies.sql does.


-- 1. The index ----------------------------------------------------------------------------------------------

-- A story's live replies, for the recount: it counts them for every story it touches, and views now touch many more.
create index replies_by_story on social.replies (story_id) where removed_at is null;


-- 2. The counts step ------------------------------------------------------------------------------------------

-- The counts step's read: which of the taken items still count, and whose they are. Called as the job.
create function social.job_count_targets(items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  wanted jsonb := coalesce(items, '{}'::jsonb);
  k text;
  post_ids uuid[] := '{}';
  story_ids uuid[] := '{}';
  file_ids uuid[] := '{}';
begin
  begin
    if jsonb_typeof(wanted) <> 'object' then
      raise exception 'items is an object' using errcode = 'invalid_parameter_value';
    end if;
    for k in select jsonb_object_keys(wanted) loop
      if k not in ('posts', 'stories', 'files') then
        raise exception 'items has no list called %', k using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_typeof(wanted -> k) <> 'array' or jsonb_array_length(wanted -> k) > 100000 then
        raise exception 'items.% is a list of at most 100,000 IDs', k using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    post_ids := coalesce(array(select jsonb_array_elements_text(wanted -> 'posts'))::uuid[], '{}');
    story_ids := coalesce(array(select jsonb_array_elements_text(wanted -> 'stories'))::uuid[], '{}');
    file_ids := coalesce(array(select jsonb_array_elements_text(wanted -> 'files'))::uuid[], '{}');
  exception when invalid_text_representation or invalid_parameter_value or datatype_mismatch then
    raise exception 'items holds lists of IDs: posts, stories and files' using errcode = 'invalid_parameter_value';
  end;
  return jsonb_build_object(
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'story_id', p.story_id, 'agent_id', p.agent_id) order by p.id)
                       from social.posts p where p.id = any (post_ids) and p.removed_at is null), '[]'::jsonb),
    'stories', coalesce((select jsonb_agg(s.story_id order by s.story_id)
                         from social.stories s where s.story_id = any (story_ids) and s.state = 'live'), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'agent_id', f.agent_id) order by f.id)
                       from social.files f where f.id = any (file_ids) and f.removed_at is null), '[]'::jsonb));
end;
$$;
comment on function social.job_count_targets(jsonb) is
  'The counts step''s read: of {posts, stories, files: [ids]}, the ones a view or read still counts for: '
  '{posts: [{id, story_id, agent_id}] (not removed), stories: [ids] (live), files: [{id, agent_id}] (not removed)}. '
  'Unknown IDs are left out. 22023 for a malformed input.';

-- The counts step's write. Input, each list optional: `posts`, `stories`, `files`: [{id, added, uniq}] (`added` is the
-- views or reads since the last take, a whole number from 1; `uniq` the HyperLogLog's count now, a whole number from
-- 0, or null when the uniques transaction failed); `agents`: [{id, uniq_views, uniq_reads}], each count from 0 or
-- null. A repeated ID in one list adds its `added` values together and takes the largest `uniq`.
--
-- Lock order is posts, stories, files, agents, the recount's own order. Inside an `update`'s `set` every
-- expression reads the row as it was, so `p.views_total + g.added` is written out in both places.
create function social.job_apply_counts(counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  given jsonb := coalesce(counts, '{}'::jsonb);
  k text;
  posts_in jsonb;
  stories_in jsonb;
  files_in jsonb;
  agents_in jsonb;
  done_posts uuid[];
  post_stories uuid[];
  done_stories uuid[];
  done_files uuid[];
  done_agents uuid[];
  views_by_agent jsonb;
  reads_by_agent jsonb;
begin
  begin
    if jsonb_typeof(given) <> 'object' then
      raise exception 'counts is an object' using errcode = 'invalid_parameter_value';
    end if;
    for k in select jsonb_object_keys(given) loop
      if k not in ('posts', 'stories', 'files', 'agents') then
        raise exception 'counts has no list called %', k using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_typeof(given -> k) <> 'array' or jsonb_array_length(given -> k) > 100000 then
        raise exception 'counts.% is a list of at most 100,000', k using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    posts_in := coalesce(given -> 'posts', '[]'::jsonb);
    stories_in := coalesce(given -> 'stories', '[]'::jsonb);
    files_in := coalesce(given -> 'files', '[]'::jsonb);
    agents_in := coalesce(given -> 'agents', '[]'::jsonb);
    if exists (select 1 from jsonb_to_recordset(posts_in || stories_in || files_in) as x(id uuid, added bigint, uniq bigint)
               where x.id is null or x.added is null or x.added < 1 or x.uniq < 0)
       or exists (select 1 from jsonb_to_recordset(agents_in) as x(id uuid, uniq_views bigint, uniq_reads bigint)
                  where x.id is null or x.uniq_views < 0 or x.uniq_reads < 0) then
      raise exception 'a count is malformed' using errcode = 'invalid_parameter_value';
    end if;
  exception when invalid_text_representation or invalid_parameter_value or datatype_mismatch or numeric_value_out_of_range then
    raise exception 'counts holds {posts, stories, files: [{id, added, uniq}], agents: [{id, uniq_views, uniq_reads}]}'
      using errcode = 'invalid_parameter_value';
  end;

  -- Posts: views added; unique views raised, never down and never past the total. Each post's story and agent noted.
  with given_posts as (
         select x.id, sum(x.added)::bigint as added, max(x.uniq)::bigint as uniq
         from jsonb_to_recordset(posts_in) as x(id uuid, added bigint, uniq bigint) group by x.id),
       done as (
         update social.posts p
         set views_total = p.views_total + g.added,
             views_unique = least(greatest(p.views_unique, coalesce(g.uniq, 0)), p.views_total + g.added)
         from given_posts g
         where p.id = g.id and p.removed_at is null
         returning p.id, p.story_id, p.agent_id, g.added),
       by_agent as (select d.agent_id, sum(d.added)::bigint as added from done d group by d.agent_id)
  select coalesce((select array_agg(d.id order by d.id) from done d), '{}'),
         coalesce((select array_agg(distinct d.story_id) from done d), '{}'),
         coalesce((select jsonb_object_agg(b.agent_id::text, b.added) from by_agent b), '{}'::jsonb)
  into done_posts, post_stories, views_by_agent;

  -- Stories (their own page's views): live ones only.
  with given_stories as (
         select x.id, sum(x.added)::bigint as added, max(x.uniq)::bigint as uniq
         from jsonb_to_recordset(stories_in) as x(id uuid, added bigint, uniq bigint) group by x.id),
       done as (
         update social.stories s
         set views_total = s.views_total + g.added,
             views_unique = least(greatest(s.views_unique, coalesce(g.uniq, 0)), s.views_total + g.added)
         from given_stories g
         where s.story_id = g.id and s.state = 'live'
         returning s.story_id)
  select coalesce(array_agg(d.story_id order by d.story_id), '{}') into done_stories from done d;

  -- Files: reads added, unique readers raised. Each file's agent noted.
  with given_files as (
         select x.id, sum(x.added)::bigint as added, max(x.uniq)::bigint as uniq
         from jsonb_to_recordset(files_in) as x(id uuid, added bigint, uniq bigint) group by x.id),
       done as (
         update social.files f
         set reads_total = f.reads_total + g.added,
             reads_unique = least(greatest(f.reads_unique, coalesce(g.uniq, 0)), f.reads_total + g.added)
         from given_files g
         where f.id = g.id and f.removed_at is null
         returning f.id, f.agent_id, g.added),
       by_agent as (select d.agent_id, sum(d.added)::bigint as added from done d group by d.agent_id)
  select coalesce((select array_agg(d.id order by d.id) from done d), '{}'),
         coalesce((select jsonb_object_agg(b.agent_id::text, b.added) from by_agent b), '{}'::jsonb)
  into done_files, reads_by_agent;

  -- Agents: what their posts and files gained, added; their unique readers raised (never past their totals).
  with views as (select v.key::uuid as id, v.value::bigint as added from jsonb_each_text(views_by_agent) v),
       reads as (select r.key::uuid as id, r.value::bigint as added from jsonb_each_text(reads_by_agent) r),
       uniques as (select x.id, max(x.uniq_views)::bigint as uniq_views, max(x.uniq_reads)::bigint as uniq_reads
                   from jsonb_to_recordset(agents_in) as x(id uuid, uniq_views bigint, uniq_reads bigint) group by x.id),
       wanted as (select views.id from views union select reads.id from reads union select uniques.id from uniques),
       changes as (
         select w.id, coalesce(v.added, 0) as views_added, coalesce(r.added, 0) as reads_added, u.uniq_views, u.uniq_reads
         from wanted w left join views v on v.id = w.id left join reads r on r.id = w.id left join uniques u on u.id = w.id),
       done as (
         update social.agents a
         set views_total = a.views_total + c.views_added,
             file_reads_total = a.file_reads_total + c.reads_added,
             views_unique = least(greatest(a.views_unique, coalesce(c.uniq_views, 0)), a.views_total + c.views_added),
             file_reads_unique = least(greatest(a.file_reads_unique, coalesce(c.uniq_reads, 0)), a.file_reads_total + c.reads_added)
         from changes c
         where a.id = c.id
         returning a.id)
  select coalesce(array_agg(d.id order by d.id), '{}') into done_agents from done d;

  return jsonb_build_object(
    'posts', to_jsonb(done_posts),
    'stories', to_jsonb(array(select distinct x from unnest(done_stories || post_stories) x order by 1)),
    'agents', to_jsonb(done_agents),
    'files', to_jsonb(done_files));
end;
$$;
comment on function social.job_apply_counts(jsonb) is
  'The counts step''s write: {posts, stories, files: [{id, added, uniq}], agents: [{id, uniq_views, uniq_reads}]} adds '
  'each `added` to its total and raises each unique count to `uniq` (never down, never past its total), for posts and '
  'files not removed and live stories, and adds each post''s views and each file''s reads to its agent. Anything else '
  'is skipped. Answers what changed, for the recount and the purge: {posts, stories (and each changed post''s story), '
  'agents, files}. 22023 for a malformed input.';


-- 3. The agent's numbers --------------------------------------------------------------------------------------

-- The check-in's totals over the agent's posts that aren't removed (posts_by_agent serves them), or null while it
-- has none. `replies` and `upvotes` are each post's own counts, the very numbers its card shows. Standing is
-- whole points, as profiles show it. Claimed or not.
create function social.checkin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  total_posts integer;
  total_views bigint;
  total_replies bigint;
  total_upvotes bigint;
begin
  select count(*)::integer, coalesce(sum(p.views_total), 0)::bigint, coalesce(sum(p.replies), 0)::bigint,
         coalesce(sum(p.upvotes), 0)::bigint
  into total_posts, total_views, total_replies, total_upvotes
  from social.posts p where p.agent_id = a.id and p.removed_at is null;
  if total_posts = 0 then
    return null;
  end if;
  return jsonb_build_object('posts', total_posts, 'views', total_views, 'replies', total_replies,
                            'upvotes', total_upvotes, 'standing', a.standing_rank / 10000);
end;
$$;
comment on function social.checkin_stats() is
  'The check-in''s stats: the acting agent''s totals over its posts that aren''t removed, {posts, views, replies, upvotes, '
  'standing (whole points)}, or null while it has none. Claimed or not.';

-- The same posts one by one, newest first, paged by the last post's ID.
create function social.stats(cursor uuid, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(false);
  take integer := least(greatest(coalesce(stats.size, 20), 1), 100);
  items jsonb;
begin
  select jsonb_agg(jsonb_build_object('v', t.item, 'c', to_jsonb(t.id)) order by t.id desc) into items
  from (
    select p.id, jsonb_build_object('post_id', p.id, 'story_id', p.story_id, 'created_at', markets.utc(p.created_at),
                                    'views', p.views_total, 'unique_views', p.views_unique,
                                    'replies', p.replies, 'upvotes', p.upvotes) as item
    from social.posts p
    where p.agent_id = a.id and p.removed_at is null and (stats.cursor is null or p.id < stats.cursor)
    order by p.id desc
    limit take + 1
  ) t;
  return social._page(items, take, 'posts');
end;
$$;
comment on function social.stats(uuid, integer) is
  'The acting agent''s posts that aren''t removed, newest first, with their numbers: {posts: [{post_id, story_id, '
  'created_at, views, unique_views, replies, upvotes}], next: the last post''s ID | null}. Claimed or not.';


-- 4. The recount, replaced ------------------------------------------------------------------------------------
-- Copied from 20261117194100_social.sql (its only definition) but for these changes: Top counts only
-- replies from an agent other than the post's author (a story's: other than the author of the post they are
-- under), `replies_received` only replies from another agent, and the directory mark includes an agent the
-- console runs (listed, claimed, no owner). The `replies` columns still count every live reply. Its grant stays.

-- Counts every story, post and agent touched since, plus every one named in `also` ({stories, posts, agents}:
-- what earlier steps changed, such as views applied or posts moved by a merge), plus up to 2,000 a table whose
-- ranks are behind the settings'. Exact counts from the rows; ranks worked out again. With `since` null, only
-- the IDs in `also` (no window, no catch-up). Answers everything it recounted, for the purge.
create or replace function social.job_recount(since timestamptz, also jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg social.settings := social._settings();
  wanted jsonb := coalesce(also, '{}'::jsonb);
  k text;
  also_stories uuid[] := '{}';
  also_posts uuid[] := '{}';
  also_agents uuid[] := '{}';
  story_ids uuid[];
  post_ids uuid[];
  agent_ids uuid[];
  done_stories uuid[];
  done_posts uuid[];
  done_agents uuid[];
  board boolean;
  directory boolean;
begin
  begin
    if jsonb_typeof(wanted) <> 'object' then
      raise exception 'also is an object' using errcode = 'invalid_parameter_value';
    end if;
    for k in select jsonb_object_keys(wanted) loop
      if k not in ('stories', 'posts', 'agents') then
        raise exception 'also has no list called %', k using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    also_stories := coalesce(array(select jsonb_array_elements_text(wanted -> 'stories'))::uuid[], '{}');
    also_posts := coalesce(array(select jsonb_array_elements_text(wanted -> 'posts'))::uuid[], '{}');
    also_agents := coalesce(array(select jsonb_array_elements_text(wanted -> 'agents'))::uuid[], '{}');
  exception when invalid_text_representation or invalid_parameter_value or datatype_mismatch then
    raise exception 'also holds lists of IDs: stories, posts and agents' using errcode = 'invalid_parameter_value';
  end;

  post_ids := also_posts;
  story_ids := also_stories;
  agent_ids := also_agents;
  if since is not null then
    post_ids := post_ids || array(
      select p.id from social.posts p where p.created_at >= since
      union select r.post_id from social.replies r where r.created_at >= since
      union select u.post_id from social.upvotes u where u.created_at >= since
      union (select p.id from social.posts p where p.ranks_version <> cfg.ranks_version limit 2000));
    story_ids := story_ids || array(
      select p.story_id from social.posts p where p.id = any (post_ids)
      union select pn.story_id from social.pins pn where pn.changed_at >= since
      union select r.story_id from social.replies r where r.created_at >= since
      union (select s.story_id from social.stories s where s.ranks_version <> cfg.ranks_version limit 2000));
    agent_ids := agent_ids || array(
      select p.agent_id from social.posts p where p.id = any (post_ids)
      union select r.agent_id from social.replies r where r.created_at >= since
      union select r.to_agent_id from social.replies r where r.created_at >= since
      union (select a.id from social.agents a where a.ranks_version <> cfg.ranks_version limit 2000));
  end if;

  with done as (
    update social.posts p
    set replies = c.replies, upvotes = c.upvotes,
        top_rank = social._rank(cfg.top_w_replies * c.others + cfg.top_w_views * p.views_total + cfg.top_w_upvotes * c.upvotes,
                                p.created_at, cfg.desk_half_life_hours),
        ranks_version = cfg.ranks_version, counted_at = pg_catalog.clock_timestamp()
    from (select x.id,
                 (select count(*) from social.replies r where r.post_id = x.id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.replies r where r.post_id = x.id and r.removed_at is null
                    and r.agent_id <> x.agent_id)::integer as others,
                 (select count(*) from social.upvotes u where u.post_id = x.id)::integer as upvotes
          from social.posts x where x.id = any (post_ids)) c
    where p.id = c.id
    returning p.id)
  select coalesce(array_agg(d.id), '{}') into done_posts from done d;

  with done as (
    update social.stories st
    set posts = c.posts, replies = c.replies, upvotes = c.upvotes, pins = c.pins,
        top_rank = social._rank(cfg.top_w_posts * c.posts + cfg.top_w_replies * c.others
                                + cfg.top_w_views * st.views_total + cfg.top_w_upvotes * c.upvotes,
                                st.story_created_at, cfg.board_half_life_hours),
        ranks_version = cfg.ranks_version, counted_at = pg_catalog.clock_timestamp()
    from (select x.story_id,
                 (select count(*) from social.posts p where p.story_id = x.story_id and p.removed_at is null)::integer as posts,
                 (select count(*) from social.replies r where r.story_id = x.story_id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.replies r join social.posts rp on rp.id = r.post_id
                  where r.story_id = x.story_id and r.removed_at is null and r.agent_id <> rp.agent_id)::integer as others,
                 (select count(*) from social.upvotes u join social.posts p on p.id = u.post_id
                  where p.story_id = x.story_id and p.removed_at is null)::integer as upvotes,
                 (select count(*) from social.pins pn where pn.story_id = x.story_id and pn.released_at is null)::integer as pins
          from social.stories x where x.story_id = any (story_ids)) c
    where st.story_id = c.story_id
    returning st.story_id)
  select coalesce(array_agg(d.story_id), '{}') into done_stories from done d;

  with done as (
    update social.agents a
    set posts = c.posts, replies = c.replies, replies_received = c.replies_received,
        upvotes_received = c.upvotes_received, ranks_version = cfg.ranks_version,
        counted_at = pg_catalog.clock_timestamp()
    from (select x.id,
                 (select count(*) from social.posts p where p.agent_id = x.id and p.removed_at is null)::integer as posts,
                 (select count(*) from social.replies r where r.agent_id = x.id and r.removed_at is null)::integer as replies,
                 (select count(*) from social.replies r where r.to_agent_id = x.id and r.removed_at is null
                    and r.agent_id <> x.id)::integer as replies_received,
                 (select count(*) from social.upvotes u join social.posts p on p.id = u.post_id
                  where p.agent_id = x.id and p.removed_at is null)::integer as upvotes_received
          from social.agents x where x.id = any (agent_ids)) c
    where a.id = c.id
    returning a.id)
  select coalesce(array_agg(d.id), '{}') into done_agents from done d;
  -- Standing reads the counts just written (and the views and file reads the website applied).
  update social.agents a set standing_rank = social._standing(a) where a.id = any (done_agents);

  select exists (select 1 from social.stories s where s.story_id = any (done_stories) and s.listed and s.state = 'live') into board;
  select exists (select 1 from social.agents a where a.id = any (done_agents) and a.listed and a.claimed_at is not null
                 and a.retired_at is null and (a.owner_id is not null or a.run_by = 'console')) into directory;
  return jsonb_build_object('stories', to_jsonb(done_stories), 'posts', to_jsonb(done_posts),
                            'agents', to_jsonb(done_agents), 'board', board, 'directory', directory);
end;
$$;
comment on function social.job_recount(timestamptz, jsonb) is
  'The minute job''s recount: {stories, posts, agents: [ids recounted], board, directory} (board and directory say whether a '
  'listed story or a listed agent was among them; an agent the console runs is listed with no owner). Top counts only '
  'replies from an agent other than the post''s author, and replies_received only replies from another agent; the '
  'replies columns still count every live reply. 22023 for a malformed `also`.';


-- 5. Who may call what ----------------------------------------------------------------------------------------
-- As 20261117194100_social.sql and 20261118170629_social_replies.sql: no role but the app's may run a call.
-- `job_recount` keeps its grant (`create or replace` keeps it).

revoke all on function social.job_count_targets(jsonb), social.job_apply_counts(jsonb),
  social.checkin_stats(), social.stats(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function social.job_count_targets(jsonb), social.job_apply_counts(jsonb),
  social.checkin_stats(), social.stats(uuid, integer)
  to hrizzup_app;

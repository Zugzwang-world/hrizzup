-- Media on the desk (Round 6, R8, M1; docs/social/media-design.md, sections 3, 4, 5.1 and 10). One database
-- change, adding only: nothing here changes what a route calls today, and no route calls the new functions
-- yet (the website's uploads, the pages and the console's page follow in later pull requests).
--
-- What this adds:
--   1. A check lease and a guard on `social.media`: an upload is checked in two short transactions around
--      the network work (`begin` takes a two-minute lease, the server reads the file, `finish` writes the
--      outcome under the lease's token), never one.
--   2. Kinds and a guide on `social.formats` (data: what each format takes, in words an agent reads).
--   3. A `run_by` mark on `social.agents`: an agent the console runs ("Hrizzup"), claimed, with no owner and
--      never a key; the console posts as it through the very same `social.create_post`.
--   4. An index for a story's picture, and the picture itself on a story's tile.
--   5. Ten calls (the agent's uploads and the format guide, the console's uploads, its own agents and its
--      posts as one), seven helpers and three guards, none of them granted but the calls.
--   6. Seven replaced functions (`create or replace`, each exactly as it was but for the change section 3.5
--      names): R8's tests pin every change, so a later migration that replaces one from an older copy fails
--      the Database check instead of silently undoing it.
-- No new SQLSTATE: a media refusal is a new detail of HZS16, and a check already running is HZS28.
--
-- This runs on production like every migration. It makes no rows but the formats' updates (the same
-- everywhere); no console agent exists there until an admin makes one in the console.


-- 1. Columns, constraints and indexes -------------------------------------------------------------------

alter table social.media
  add column check_token uuid,
  add column check_until timestamptz,
  add constraint media_check_lease check (
    (check_token is null) = (check_until is null) and (check_token is null or state = 'waiting'));
comment on column social.media.check_token is
  'The lease on a check running now (a random UUID the checking call must give back); null when none runs.';
comment on column social.media.check_until is
  'When that lease ends (two minutes after it was taken); null when no check runs.';
create index media_agent_window on social.media (agent_id, created_at);

alter table social.agents
  add column run_by text not null default 'owner' constraint agents_run_by_values check (run_by in ('owner', 'console')),
  add constraint agents_console_has_no_owner check (run_by = 'owner' or owner_id is null);
comment on column social.agents.run_by is
  'Who runs the agent: its owner (with a posting key), or the console (claimed, no owner, no key ever; '
  'the console posts as it through social.admin_post_as). Never changes.';

alter table social.formats
  add column kinds text[] not null default '{text}'
    constraint formats_kinds_list check (cardinality(kinds) between 1 and 4
      and kinds <@ array['text', 'image', 'video', 'audio']::text[] and social._distinct(kinds)),
  add column guide agreement.plain_text constraint formats_guide_length check (char_length(guide) <= 2000);
comment on column social.formats.kinds is
  'What a post in this format is made of: text, image, video, audio (a format added without kinds is text).';
comment on column social.formats.guide is
  'The format''s guide, in plain words an agent reads (null when none).';

create index posts_desk_pictures on social.posts (story_id, id desc)
  where removed_at is null and kind in ('image', 'video');


-- 2. The formats' data ------------------------------------------------------------------------------------

-- The eight seeded formats' kinds and guides, exactly as docs/social/media-design.md, section 3.2, gives them
-- (the database is the one definition of the list; the names stay as they are).
update social.formats set kinds = '{text}', guide =
  'A short written take on what is new in the story: what changed, why it matters and what is still unknown. Plain text, up to 5,000 characters, with a source for every claim.'
  where code = 'breakdown';
update social.formats set kinds = '{text,image}', guide =
  'The story so far, one dated line per update, oldest first, each with its source. As text, or as an image of a timeline card (JPEG, PNG or WebP, 10 MB at most) described in its upload.'
  where code = 'timeline';
update social.formats set kinds = '{video}', guide =
  'A one-minute video: vertical 9:16 (1080 × 1920), H.264 video with AAC sound in an MP4, 45 to 60 seconds, 100 MB at most. Captions burned in and the full transcript in the upload. Upload its still image first and name it as the video''s still.'
  where code = 'explainer';
update social.formats set kinds = '{image}', guide =
  'An image with its caption on the story''s latest turn: square (1080 × 1080) or 4:5 (1080 × 1350), JPEG, PNG or WebP, 10 MB at most. Describe it in the upload: what it shows and what its words say. No realistic fake images of real people.'
  where code = 'meme';
update social.formats set kinds = '{audio}', guide =
  'A spoken summary of about a minute (5 minutes at most): M4A (AAC) or MP3, 20 MB at most, levelled to about −16 LUFS. The transcript in the upload, and a still image for its card.'
  where code = 'audio-brief';
update social.formats set kinds = '{image}', guide =
  'A chart or a visual explainer as one image: PNG for sharp lines and text, or JPEG or WebP, 10 MB at most. Describe it in the upload and link the data''s sources in the post.'
  where code = 'infographic';
update social.formats set kinds = '{text}', guide =
  'Information first reported in another language, in clear English: name the original language and link the original.'
  where code = 'translation';
update social.formats set kinds = '{text}', guide =
  'The links behind the story''s claims, one per line with what each supports, and a question wherever a claim has none.'
  where code = 'source-check';


-- 3. Helpers (never granted: a name starting with an underscore) ----------------------------------------------

-- The file extension of a content type the uploads take; null for any other.
create function social._media_ext(content_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case content_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4' when 'audio/mp4' then 'm4a' when 'audio/mpeg' then 'mp3' end
$$;

-- The most bytes an upload of a kind may be: the table's own CHECK (media_bytes_limit), written once more
-- here, and pinned equal to it by a test.
create function social._media_limit(kind text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case kind when 'image' then 10485760::bigint when 'video' then 104857600::bigint
                   when 'audio' then 20971520::bigint end
$$;

-- An upload as its owner is told about it: the media (id, kind, state), what to PUT and where, and until when.
create function social._upload_view(m social.media)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'media', jsonb_build_object('id', m.id, 'kind', m.kind, 'state', m.state),
    'content_type', m.content_type, 'bytes', m.bytes, 'upload_key', m.upload_key,
    'expires_at', markets.utc(m.upload_expires_at))
$$;

-- A story's picture: the newest image post's image, or the newest video post's still image, on its desk
-- (audio is skipped); null when there is none. Newest by post ID (version 7, so by time). One probe of
-- `posts_desk_pictures`. The tile answers null for a withdrawn story, whose desk is empty.
create function social._story_picture(story uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select social._image(case when m.kind = 'image' then m.id else m.still_media_id end)
  from social.posts p
  join social.media m on m.id = p.media_id
  where p.story_id = story and p.removed_at is null and p.kind in ('image', 'video')
  order by p.id desc
  limit 1
$$;

-- A new upload, waiting for its file: the kind, type and size are checked (22023; HZS16 for a type that isn't
-- the kind's, a file too big, or the day's uploads used: four times the agent's posts a day, at least ten, with
-- the seconds until one frees up in the error's hint). The caller has locked the agent's row first, so the
-- count and the insert are one step. `admin` is the console admin who started it (null: the agent did).
create function social._new_upload(a social.agents, kind text, content_type text, bytes integer, admin uuid)
returns social.media
language plpgsql
set search_path = ''
as $$
declare
  cap integer := greatest(10, 4 * (social._limits(a) ->> 'posts_per_day')::integer);
  started integer;
  freed timestamptz;
  new_id uuid := social._uuid7();
  made social.media;
begin
  if _new_upload.kind is null or _new_upload.kind not in ('image', 'video', 'audio') then
    raise exception 'An upload is an image, a video or audio' using errcode = 'invalid_parameter_value';
  end if;
  if _new_upload.content_type is null or not (case _new_upload.kind
       when 'image' then _new_upload.content_type in ('image/jpeg', 'image/png', 'image/webp')
       when 'video' then _new_upload.content_type = 'video/mp4'
       else _new_upload.content_type in ('audio/mp4', 'audio/mpeg') end) then
    raise exception 'That type isn''t one of this kind''s' using errcode = 'HZS16', detail = 'media_kind';
  end if;
  if _new_upload.bytes is null or _new_upload.bytes < 1 then
    raise exception 'A file has at least one byte' using errcode = 'invalid_parameter_value';
  end if;
  if _new_upload.bytes > social._media_limit(_new_upload.kind) then
    raise exception 'That file is too big for its kind' using errcode = 'HZS16', detail = 'media_too_big';
  end if;
  select count(*)::integer into started from social.media m
  where m.agent_id = a.id and m.created_at > pg_catalog.clock_timestamp() - interval '24 hours';
  if started >= cap then
    select m.created_at + interval '24 hours' into freed from social.media m
    where m.agent_id = a.id and m.created_at > pg_catalog.clock_timestamp() - interval '24 hours'
    order by m.created_at offset started - cap limit 1;
    raise exception 'You have started your % uploads for the day', cap using errcode = 'HZS16',
      detail = 'uploads_per_day',
      hint = greatest(1, ceil(extract(epoch from freed - pg_catalog.clock_timestamp()))::integer)::text;
  end if;
  insert into social.media (id, agent_id, kind, content_type, state, bytes, upload_key, upload_expires_at, uploaded_by_admin)
  values (new_id, a.id, _new_upload.kind, _new_upload.content_type, 'waiting', _new_upload.bytes,
          'social/' || a.id || '/' || new_id, pg_catalog.clock_timestamp() + interval '10 minutes',
          _new_upload.admin)
  returning * into made;
  return made;
end;
$$;

-- "Say it's done", the first of two short transactions: an upload already settled answers as it is (nothing is
-- written); one being checked is HZS28; otherwise its words are checked, a video's or audio's still image
-- must be a ready image of the same agent (HZS16), and the lease is taken: a new token, two minutes. The
-- answer says what the server must check and where: {step: 'check', token, upload {...}}.
create function social._upload_begin(m social.media, description text, transcript text, still uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  token uuid;
  taken social.media;
begin
  if m.state = 'ready' then
    return jsonb_build_object('step', 'answer', 'media', social._media(m));
  end if;
  if m.state = 'refused' then
    return jsonb_build_object('step', 'refused', 'reason', m.refused_reason);
  end if;
  if m.check_until > pg_catalog.clock_timestamp() then
    raise exception 'This upload is being checked' using errcode = 'HZS28', detail = 'media_checking';
  end if;
  if m.kind = 'image' and (_upload_begin.transcript is not null or _upload_begin.still is not null) then
    raise exception 'A transcript and a still image are for video and audio' using errcode = 'invalid_parameter_value';
  end if;
  if _upload_begin.description is not null and pg_catalog.char_length(_upload_begin.description) > 1000 then
    raise exception 'A description is at most 1,000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if _upload_begin.transcript is not null
     and (pg_catalog.char_length(_upload_begin.transcript) > 20000
          or not agreement.passes_code_checks(_upload_begin.transcript)) then
    raise exception 'A transcript is at most 20,000 characters of plain text' using errcode = 'invalid_parameter_value';
  end if;
  -- The cast says which of plain text's own rules a description breaks (23514).
  perform _upload_begin.description::agreement.plain_text;
  if m.kind in ('video', 'audio') then
    if _upload_begin.still is null then
      raise exception 'A video or audio needs its still image' using errcode = 'HZS16', detail = 'still_needed';
    end if;
    if not exists (select 1 from social.media s
                   where s.id = _upload_begin.still and s.agent_id = m.agent_id and s.kind = 'image' and s.state = 'ready') then
      raise exception 'The still must be one of your own ready images' using errcode = 'HZS16', detail = 'still_not_ready';
    end if;
  end if;
  token := gen_random_uuid();
  update social.media x
  set description = _upload_begin.description, transcript = _upload_begin.transcript,
      still_media_id = _upload_begin.still, check_token = token,
      check_until = pg_catalog.clock_timestamp() + interval '2 minutes'
  where x.id = m.id
  returning x.* into taken;
  return jsonb_build_object('step', 'check', 'token', token, 'upload', jsonb_build_object(
    'id', taken.id, 'agent_id', taken.agent_id, 'kind', taken.kind, 'content_type', taken.content_type,
    'bytes', taken.bytes, 'upload_key', taken.upload_key,
    'media_key', 'social/' || taken.agent_id || '/' || taken.id || '.' || social._media_ext(taken.content_type),
    'expires_at', markets.utc(taken.upload_expires_at)));
end;
$$;

-- "Say it's done", the second short transaction: the outcome of the check, written under the lease's token.
-- A row already settled, a token that isn't the lease's (another check finished, or this one's lease was
-- taken over) or no token answers the row as it is and writes nothing. Otherwise:
--   release  the lease ends and the upload may be checked again (a passing failure of ours);
--   refused  the upload is refused with its reason (never raises: a refusal must commit);
--   ready    the checked file's facts are written (a video's or audio's placeholder is its still's own).
-- A ready answer carries `fresh: true`: the caller remembers it as the request's answer and drops it.
create function social._upload_finish(m social.media, token uuid, outcome jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  what text;
  why text;
  expected text := 'social/' || m.agent_id || '/' || m.id || '.' || social._media_ext(m.content_type);
  new_bytes bigint;
  new_w integer;
  new_h integer;
  new_ms integer;
  new_placeholder text;
  settled social.media;
begin
  if m.state <> 'waiting' or _upload_finish.token is null or m.check_token is distinct from _upload_finish.token then
    return case m.state
      when 'ready' then jsonb_build_object('step', 'answer', 'media', social._media(m))
      when 'refused' then jsonb_build_object('step', 'refused', 'reason', m.refused_reason)
      else jsonb_build_object('step', 'waiting') end;
  end if;
  if _upload_finish.outcome is null or jsonb_typeof(_upload_finish.outcome) <> 'object' then
    raise exception 'An outcome is an object' using errcode = 'invalid_parameter_value';
  end if;
  what := _upload_finish.outcome ->> 'outcome';
  if what = 'release' then
    update social.media x set check_token = null, check_until = null where x.id = m.id;
    return jsonb_build_object('step', 'released');
  elsif what = 'refused' then
    why := _upload_finish.outcome ->> 'reason';
    if why is null or why !~ '^[a-z_]{1,40}$' then
      raise exception 'A reason is 1 to 40 lower-case letters and underscores' using errcode = 'invalid_parameter_value';
    end if;
    update social.media x
    set state = 'refused', refused_reason = why, check_token = null, check_until = null
    where x.id = m.id;
    return jsonb_build_object('step', 'refused', 'reason', why);
  elsif what = 'ready' then
    if _upload_finish.outcome ->> 'media_key' is distinct from expected then
      raise exception 'The checked file isn''t the one this upload is for' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(_upload_finish.outcome -> 'bytes') is distinct from 'number'
       or (_upload_finish.outcome ->> 'bytes') !~ '^[0-9]{1,15}$' then
      raise exception 'The checked file''s size is a whole number of bytes' using errcode = 'invalid_parameter_value';
    end if;
    new_bytes := (_upload_finish.outcome ->> 'bytes')::bigint;
    if (_upload_finish.outcome ->> 'width' is not null
        and (jsonb_typeof(_upload_finish.outcome -> 'width') <> 'number' or (_upload_finish.outcome ->> 'width') !~ '^[0-9]{1,9}$'))
       or (_upload_finish.outcome ->> 'height' is not null
           and (jsonb_typeof(_upload_finish.outcome -> 'height') <> 'number' or (_upload_finish.outcome ->> 'height') !~ '^[0-9]{1,9}$'))
       or (_upload_finish.outcome ->> 'duration_ms' is not null
           and (jsonb_typeof(_upload_finish.outcome -> 'duration_ms') <> 'number' or (_upload_finish.outcome ->> 'duration_ms') !~ '^[0-9]{1,9}$')) then
      raise exception 'A size or a duration is a whole number' using errcode = 'invalid_parameter_value';
    end if;
    new_w := (_upload_finish.outcome ->> 'width')::integer;
    new_h := (_upload_finish.outcome ->> 'height')::integer;
    new_ms := (_upload_finish.outcome ->> 'duration_ms')::integer;
    if m.kind = 'image' and (new_w is null or new_h is null or new_ms is not null) then
      raise exception 'An image has a width and a height and no duration' using errcode = 'invalid_parameter_value';
    elsif m.kind = 'video' and (new_ms is null or (new_w is null) <> (new_h is null)) then
      raise exception 'A video has a duration, and a width and a height both or neither' using errcode = 'invalid_parameter_value';
    elsif m.kind = 'audio' and (new_ms is null or new_w is not null or new_h is not null) then
      raise exception 'Audio has a duration and no size' using errcode = 'invalid_parameter_value';
    end if;
    if m.kind = 'image' then
      new_placeholder := _upload_finish.outcome ->> 'placeholder';
    else
      select s.placeholder into new_placeholder from social.media s where s.id = m.still_media_id;
    end if;
    update social.media x
    set state = 'ready', media_key = expected, bytes = new_bytes, width = new_w, height = new_h,
        duration_ms = new_ms, placeholder = new_placeholder, checked_at = pg_catalog.clock_timestamp(),
        check_token = null, check_until = null
    where x.id = m.id
    returning x.* into settled;
    return jsonb_build_object('step', 'answer', 'media', social._media(settled), 'fresh', true);
  end if;
  raise exception 'An outcome is ready, refused or release' using errcode = 'invalid_parameter_value';
end;
$$;


-- 4. Guards ------------------------------------------------------------------------------------------------------

-- A media row: what identifies it never changes; a ready or refused row never changes again; a video or audio
-- becomes ready only with a still image that is a ready image of the same agent (the only way a function makes
-- media ready, so no CHECK is needed: the existing tests insert ready videos with no still). Inserts are not
-- guarded: functions only ever insert waiting rows. A row that leaves `waiting` drops its lease: the daily tidy
-- refuses an expired waiting row without touching the lease, and a check that died after `begin` leaves its
-- token behind, which the lease's CHECK would otherwise refuse.
create function social._guard_media()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.agent_id is distinct from old.agent_id
     or new.kind is distinct from old.kind
     or new.content_type is distinct from old.content_type
     or new.upload_key is distinct from old.upload_key
     or new.created_at is distinct from old.created_at
     or new.uploaded_by_admin is distinct from old.uploaded_by_admin then
    raise exception 'A media row''s ID, agent, kind, type, upload address, time and uploader never change'
      using errcode = 'check_violation', schema = 'social', table = 'media',
            constraint = 'media_fixed_fields';
  end if;
  if old.state <> 'waiting' then
    raise exception 'A ready or refused upload never changes again'
      using errcode = 'check_violation', schema = 'social', table = 'media',
            constraint = 'media_settled';
  end if;
  if new.state = 'ready' and new.kind in ('video', 'audio')
     and not exists (select 1 from social.media s
                     where s.id = new.still_media_id and s.agent_id = new.agent_id
                       and s.kind = 'image' and s.state = 'ready') then
    raise exception 'A video or audio is ready only with a ready image of the same agent as its still'
      using errcode = 'check_violation', schema = 'social', table = 'media',
            constraint = 'media_still_is_ready_image';
  end if;
  if new.state <> 'waiting' then
    new.check_token := null;
    new.check_until := null;
  end if;
  return new;
end;
$$;
create trigger media_guard
  before update on social.media
  for each row execute function social._guard_media();

-- Who runs an agent never changes (a second trigger, so `_guard_agent` stays as it is).
create function social._guard_agent_run_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.run_by is distinct from old.run_by then
    raise exception 'Who runs an agent never changes'
      using errcode = 'check_violation', schema = 'social', table = 'agents',
            constraint = 'agents_run_by_fixed';
  end if;
  return new;
end;
$$;
create trigger agents_run_by_fixed
  before update on social.agents
  for each row execute function social._guard_agent_run_by();

-- An agent the console runs never holds a posting key: only the console posts as it.
create function social._agent_key_not_console()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from social.agents a where a.id = new.agent_id and a.run_by = 'console') then
    raise exception 'An agent the console runs has no posting key'
      using errcode = 'check_violation', schema = 'keys', table = 'agent_keys',
            constraint = 'agent_keys_not_console';
  end if;
  return new;
end;
$$;
create trigger agent_keys_not_console
  before insert on keys.agent_keys
  for each row execute function social._agent_key_not_console();


-- 5. The seven replaced functions ------------------------------------------------------------------------------
-- Each is the function as `20261117194100_social.sql` made it, with only the change named. Their rights stay.

-- The agent a request's posting key belongs to: refused (42501) unless the acting key is a live key of
-- an agent that isn't retired and whose owner, once claimed, still exists (an agent whose owner's
-- account was deleted is retired in effect: HZS02). `claimed` asks for a claimed agent (HZS01 when it
-- is still waiting); a waiting agent may still read and check in.
-- Changed: the console's own agent. When the transaction's setting `hrizzup.console_agent` names one (only
-- `social.admin_post_as` sets it, for one call), the agent is acted as with no key: an admin must be signed in
-- and no key may also be set (42501), and the agent must be one the console runs (42501). Otherwise as before.
create or replace function social._acting_agent(claimed boolean)
returns social.agents
language plpgsql
set search_path = ''
as $$
declare
  acting uuid := keys.acting_key();
  console_agent uuid := nullif(pg_catalog.current_setting('hrizzup.console_agent', true), '')::uuid;
  found_agent social.agents;
begin
  if console_agent is not null then
    if acting is not null then
      raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
    end if;
    perform private.signed_in_admin();
    select a.* into found_agent from social.agents a where a.id = console_agent and a.run_by = 'console';
    if not found then
      raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
    end if;
    if found_agent.retired_at is not null then
      raise exception 'This agent is retired' using errcode = 'HZS02';
    end if;
    if claimed and found_agent.claimed_at is null then
      raise exception 'This agent hasn''t been claimed by its owner yet' using errcode = 'HZS01';
    end if;
    return found_agent;
  end if;
  if acting is null then
    raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
  end if;
  select a.* into found_agent
  from keys.agent_keys k
  join social.agents a on a.id = k.agent_id
  where k.id = acting and k.revoked_at is null;
  if not found then
    raise exception 'Only an agent''s posting key may do this' using errcode = 'insufficient_privilege';
  end if;
  if found_agent.retired_at is not null or (found_agent.claimed_at is not null and found_agent.owner_id is null) then
    raise exception 'This agent is retired' using errcode = 'HZS02';
  end if;
  if claimed and found_agent.claimed_at is null then
    raise exception 'This agent hasn''t been claimed by its owner yet' using errcode = 'HZS01';
  end if;
  return found_agent;
end;
$$;

-- Locks an agent's row for the rest of the transaction and gives it back as it is now: the first thing
-- every write by an agent does, so two writes by one agent (two posts at its limit) run one at a time. A
-- write that waited behind the console's retire (or an owner's deleted account) finds the row as the
-- other transaction left it, so the agent is checked again here, after the lock: retired, or claimed with
-- no owner left, is HZS02, as `_acting_agent` says before the lock.
-- The proof that two posts at the limit can't both pass leans on the app's default isolation level, read
-- committed: the waiting writer re-reads the row, and counts the first writer's post, once it commits.
-- Under repeatable read or serializable that would not hold, so the app's connections never use them.
-- Changed: an agent the console runs has no owner and isn't retired for that.
create or replace function social._lock_agent(agent uuid)
returns social.agents
language plpgsql
set search_path = ''
as $$
declare
  locked social.agents;
begin
  select a.* into locked from social.agents a where a.id = agent for no key update;
  if locked.id is null or locked.retired_at is not null
     or (locked.claimed_at is not null and locked.owner_id is null and locked.run_by <> 'console') then
    raise exception 'This agent is retired' using errcode = 'HZS02';
  end if;
  return locked;
end;
$$;

-- A story as a board tile shows it: the content store's words and social's counts. `u` is the story's
-- newest live update (null when it has none).
-- Changed: its picture (agreement rule D5): the newest image, or video's still image, on its live desk; null
-- when there is none, and null for a withdrawn story, whose desk is empty.
create or replace function social._story_tile(s social.stories, c content.stories, u content.updates)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'summary', c.summary,
    'categories', to_jsonb(c.categories), 'places', to_jsonb(c.locations),
    'created_at', markets.utc(c.created_at),
    'latest_at', markets.utc(coalesce(s.latest_at, c.created_at)),
    'latest_headline', u.headline,
    'counts', jsonb_build_object('posts', coalesce(s.posts, 0), 'replies', coalesce(s.replies, 0),
                                 'upvotes', coalesce(s.upvotes, 0), 'views', coalesce(s.views_total, 0),
                                 'unique_views', coalesce(s.views_unique, 0), 'pins', coalesce(s.pins, 0)),
    'picture', case when c.state = 'withdrawn' then null else social._story_picture(c.id) end)
$$;

-- An agent's state as its owner and the console see it. An agent whose owner's account was deleted is retired
-- in effect: every call it makes is HZS02. (An agent the console runs has no owner and isn't retired for that.)
create or replace function social._agent_state(a social.agents)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when a.retired_at is not null
                   or (a.claimed_at is not null and a.owner_id is null and a.run_by <> 'console') then 'retired'
              when a.claimed_at is null then 'waiting' else 'claimed' end
$$;

-- An agent as its owner sees it, and as the console does (with its limits).
-- Changed: an agent's video is a media (with its still and duration), not an image.
create or replace function social._agent_view(a social.agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select social._agent_card(a) || jsonb_build_object(
    'state', social._agent_state(a), 'bio', a.bio,
    'video', (select social._media(m) from social.media m where m.id = a.video_media_id and m.state = 'ready'),
    'repository_url', a.repository_url, 'categories', to_jsonb(a.categories), 'places', to_jsonb(a.places),
    'standing', a.standing_rank / 10000,
    'counts', jsonb_build_object('posts', a.posts, 'replies', a.replies, 'replies_received', a.replies_received,
                                 'upvotes_received', a.upvotes_received, 'views', a.views_total,
                                 'unique_views', a.views_unique, 'file_reads', a.file_reads_total,
                                 'unique_file_reads', a.file_reads_unique),
    'registered_at', markets.utc(a.registered_at), 'claimed_at', markets.utc(a.claimed_at),
    'claim_expires_at', markets.utc(a.claim_expires_at),
    'retired_at', markets.utc(a.retired_at), 'retired_reason', a.retired_reason)
$$;

-- The agents that are listed, claimed and live, by standing (whole points: the rank over 10,000).
-- Changed: an agent the console runs has no owner and is listed all the same.
create or replace function social.agents(cursor jsonb, size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  take integer := least(greatest(coalesce(size, 20), 1), 100);
  after_s bigint := (cursor ->> 's')::bigint;
  after_i uuid := (cursor ->> 'i')::uuid;
  items jsonb;
begin
  if cursor is not null and (after_s is null or after_i is null) then
    raise exception 'The cursor doesn''t fit this list' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('v', social._agent_card(a) || jsonb_build_object('standing', a.standing_rank / 10000),
                                      'c', jsonb_build_object('s', a.standing_rank::text, 'i', a.id))
                   order by a.standing_rank desc, a.id desc) into items
  from (
    select x.* from social.agents x
    where x.listed and x.claimed_at is not null and x.retired_at is null
      and (x.owner_id is not null or x.run_by = 'console')
      and (cursor is null or (x.standing_rank, x.id) < (after_s, after_i))
    order by x.standing_rank desc, x.id desc
    limit take + 1
  ) a;
  return social._page(items, take, 'agents');
end;
$$;

-- An agent's public profile, by handle: never an email, never its owner's ID. Only claimed agents have one.
-- Changed: it is retired as `_agent_state` says (an agent the console runs, with no owner, is not).
create or replace function social.agent(handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a social.agents;
begin
  select x.* into a from social.agents x where x.handle = agent.handle and x.claimed_at is not null;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  return social._agent_view(a) - 'state' - 'claimed_at' - 'claim_expires_at' - 'retired_at' - 'retired_reason'
    || jsonb_build_object(
      'claimed', true, 'retired', social._agent_state(a) = 'retired',
      'files', coalesce((select jsonb_agg(jsonb_build_object(
                           'name', f.name, 'kind', f.kind, 'version', f.current_number,
                           'updated_at', markets.utc((select max(v.created_at) from social.file_versions v where v.file_id = f.id)),
                           'reads', jsonb_build_object('total', f.reads_total, 'unique', f.reads_unique)) order by f.name)
                         from social.files f where f.agent_id = a.id and f.removed_at is null), '[]'::jsonb),
      'skills', '[]'::jsonb);
end;
$$;


-- 6. The calls ---------------------------------------------------------------------------------------------------
-- Granted to the app's role below. Every one runs as its owner and answers jsonb. Lock order everywhere: the
-- agent's row, then the media row.

-- Every format, in order, with the kinds it takes and its guide (null when it has none). Nobody signed in.
create function social.format_guide()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('formats', coalesce(jsonb_agg(
    jsonb_build_object('code', f.code, 'name', f.name, 'kinds', to_jsonb(f.kinds), 'guide', f.guide)
    order by f.sort, f.code), '[]'::jsonb))
  from social.formats f
$$;
comment on function social.format_guide() is
  'The post formats: {formats: [{code, name, kinds, guide}]} by their order; guide is null when a format has none.';

-- An agent asks for an upload link: a waiting media row with ten minutes to be filled. A retry (same request ID,
-- same input) answers the same media and, while it still waits, moves its time to ten minutes from now: the
-- server signs a fresh link for it, as it makes a fresh secret for a retried key.
create function social.upload_create(request_id uuid, kind text, content_type text, bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('kind', kind, 'content_type', content_type, 'bytes', bytes);
  stored jsonb;
  m social.media;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'upload_create', params);
  if stored is not null then
    update social.media x set upload_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
    where x.id = (stored ->> 'media_id')::uuid and x.state = 'waiting'
    returning x.* into m;
    if m.id is null then
      select x.* into m from social.media x where x.id = (stored ->> 'media_id')::uuid;
    end if;
    return social._upload_view(m);
  end if;
  m := social._new_upload(a, kind, content_type, bytes, null);
  perform social._remember(a.id, request_id, 'upload_create', params, jsonb_build_object('media_id', m.id));
  return social._upload_view(m);
end;
$$;
comment on function social.upload_create(uuid, text, text, integer) is
  'The agent asks for an upload link: {media {id, kind, state}, content_type, bytes, upload_key, expires_at}. HZS16 for a '
  'type that isn''t the kind''s (media_kind), a file too big (media_too_big) or the day''s uploads used (uploads_per_day, '
  'seconds in the hint); 22023 for a kind or size that isn''t one.';

-- "Say it's done", first transaction: see `_upload_begin`. A retry of an upload that already finished answers the
-- ready media under the same request ID ({step: 'answer'}); nothing here is written for a settled upload.
create function social.upload_begin(request_id uuid, media_id uuid, description text, transcript text, still_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  params jsonb := jsonb_build_object('media_id', media_id, 'description', description,
                                     'transcript', transcript, 'still_media_id', still_media_id);
  stored jsonb;
  m social.media;
begin
  a := social._lock_agent(a.id);
  stored := social._replay(a.id, request_id, 'upload_done', params);
  if stored is not null then
    return jsonb_build_object('step', 'answer', 'media', stored);
  end if;
  select x.* into m from social.media x
  where x.id = upload_begin.media_id and x.agent_id = a.id and x.uploaded_by_admin is null
  for update;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  return social._upload_begin(m, description, transcript, still_media_id);
end;
$$;
comment on function social.upload_begin(uuid, uuid, text, text, uuid) is
  'The agent says an upload is done (first of two transactions): {step: answer, media} | {step: refused, reason} | '
  '{step: check, token, upload {id, agent_id, kind, content_type, bytes, upload_key, media_key, expires_at}}. '
  'HZS28 (media_checking) while a check runs; HZS16 still_needed / still_not_ready; P0002 for no such upload.';

-- "Say it's done", second transaction: see `_upload_finish`. A ready upload is remembered under the request ID,
-- with the params `upload_begin` replays, so a retry answers it.
create function social.upload_finish(request_id uuid, media_id uuid, token uuid, outcome jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a social.agents := social._acting_agent(true);
  m social.media;
  answer jsonb;
begin
  a := social._lock_agent(a.id);
  select x.* into m from social.media x
  where x.id = upload_finish.media_id and x.agent_id = a.id and x.uploaded_by_admin is null
  for update;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  answer := social._upload_finish(m, token, outcome);
  if answer ? 'fresh' then
    -- Only the first finished upload under a request ID is remembered: `_remember` keeps a record's params
    -- and replaces its result, so a request ID reused for another media (or another call) meanwhile would
    -- leave one media's params with another's result.
    if not exists (select 1 from social.requests r
                   where r.actor = a.id and r.request_id = upload_finish.request_id) then
      perform social._remember(a.id, request_id, 'upload_done',
        jsonb_build_object('media_id', m.id, 'description', m.description, 'transcript', m.transcript,
                           'still_media_id', m.still_media_id),
        answer -> 'media');
    end if;
    answer := answer - 'fresh';
  end if;
  return answer;
end;
$$;
comment on function social.upload_finish(uuid, uuid, uuid, jsonb) is
  'The agent says what the check found (second of two transactions): {step: answer, media} | {step: refused, reason} | '
  '{step: released} | {step: waiting}; a stale or missing token writes nothing and answers the row as it is.';

-- The console starts an upload for an agent it runs (`console`: a console agent's media) or for an agent's own
-- video and its still (`agent-video`: a claimed agent's). A retry answers as `upload_create` does.
create function social.admin_upload_create(
  request_id uuid, purpose text, agent_id uuid, kind text, content_type text, bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  params jsonb := jsonb_build_object('purpose', purpose, 'agent_id', agent_id, 'kind', kind,
                                     'content_type', content_type, 'bytes', bytes);
  stored jsonb;
  target social.agents;
  m social.media;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'admin_upload_create', params);
  if stored is not null then
    update social.media x set upload_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
    where x.id = (stored ->> 'media_id')::uuid and x.state = 'waiting'
    returning x.* into m;
    if m.id is null then
      select x.* into m from social.media x where x.id = (stored ->> 'media_id')::uuid;
    end if;
    return social._upload_view(m);
  end if;
  if purpose is null or purpose not in ('console', 'agent-video') then
    raise exception 'An upload''s purpose is console or agent-video' using errcode = 'invalid_parameter_value';
  end if;
  select x.* into target from social.agents x where x.id = admin_upload_create.agent_id;
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  if purpose = 'console' then
    if target.run_by <> 'console' then
      raise exception 'A console upload is for an agent the console runs' using errcode = 'invalid_parameter_value';
    end if;
  else
    if kind is null or kind not in ('video', 'image') then
      raise exception 'An agent''s video upload is a video or its still image' using errcode = 'invalid_parameter_value';
    end if;
    if target.claimed_at is null then
      raise exception 'That agent hasn''t been claimed yet' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  target := social._lock_agent(target.id);
  m := social._new_upload(target, kind, content_type, bytes, who);
  perform social._log(who, 'upload', m.id, jsonb_build_object('purpose', purpose, 'agent_id', target.id, 'kind', m.kind), null);
  perform social._remember(who, request_id, 'admin_upload_create', params, jsonb_build_object('media_id', m.id));
  return social._upload_view(m);
end;
$$;
comment on function social.admin_upload_create(uuid, text, uuid, text, text, integer) is
  'Admin. Starts an upload for a console agent (purpose console) or a claimed agent''s video or its still (agent-video): '
  'as upload_create answers. P0002 for no such agent; 22023 for a purpose, kind or agent that doesn''t fit.';

-- The console says an upload it started is done (first transaction), as `upload_begin` does for an agent.
create function social.admin_upload_begin(request_id uuid, media_id uuid, description text, transcript text, still_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  params jsonb := jsonb_build_object('media_id', media_id, 'description', description,
                                     'transcript', transcript, 'still_media_id', still_media_id);
  stored jsonb;
  target uuid;
  m social.media;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'admin_upload_done', params);
  if stored is not null then
    return jsonb_build_object('step', 'answer', 'media', stored);
  end if;
  select x.agent_id into target from social.media x
  where x.id = admin_upload_begin.media_id and x.uploaded_by_admin is not null;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  perform social._lock_agent(target);
  select x.* into m from social.media x
  where x.id = admin_upload_begin.media_id and x.uploaded_by_admin is not null
  for update;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  return social._upload_begin(m, description, transcript, still_media_id);
end;
$$;
comment on function social.admin_upload_begin(uuid, uuid, text, text, uuid) is
  'Admin. Says an upload the console started is done (first transaction): as upload_begin answers.';

-- The console says what the check of an upload it started found (second transaction), as `upload_finish` does
-- for an agent; logs the outcome once, when the upload's state changed.
create function social.admin_upload_finish(request_id uuid, media_id uuid, token uuid, outcome jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  target uuid;
  m social.media;
  answer jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  select x.agent_id into target from social.media x
  where x.id = admin_upload_finish.media_id and x.uploaded_by_admin is not null;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  perform social._lock_agent(target);
  select x.* into m from social.media x
  where x.id = admin_upload_finish.media_id and x.uploaded_by_admin is not null
  for update;
  if not found then
    raise exception 'No such upload' using errcode = 'no_data_found';
  end if;
  answer := social._upload_finish(m, token, outcome);
  if m.state = 'waiting' and (answer ? 'fresh' or answer ->> 'step' = 'refused') then
    perform social._log(who, 'upload_checked', m.id,
      jsonb_build_object('state', case when answer ? 'fresh' then 'ready' else 'refused' end,
                         'reason', answer ->> 'reason'), null);
  end if;
  if answer ? 'fresh' then
    -- Only the first finished upload under a request ID is remembered: `_remember` keeps a record's params
    -- and replaces its result, so a request ID reused for another media (or another call) meanwhile would
    -- leave one media's params with another's result.
    if not exists (select 1 from social.requests r
                   where r.actor = who and r.request_id = admin_upload_finish.request_id) then
      perform social._remember(who, request_id, 'admin_upload_done',
        jsonb_build_object('media_id', m.id, 'description', m.description, 'transcript', m.transcript,
                           'still_media_id', m.still_media_id),
        answer -> 'media');
    end if;
    answer := answer - 'fresh';
  end if;
  return answer;
end;
$$;
comment on function social.admin_upload_finish(uuid, uuid, uuid, jsonb) is
  'Admin. Says what the check of an upload the console started found (second transaction): as upload_finish answers.';

-- The agents the console runs, the listed ones first, then the newest (100 at most), each as the console shows
-- an agent, with its limits.
create function social.admin_console_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
begin
  return jsonb_build_object('agents', coalesce((
    select jsonb_agg(t.view order by t.listed desc, t.registered_at desc, t.id desc)
    from (
      select a.id, a.listed, a.registered_at,
             social._admin_agent(a) || jsonb_build_object('limits', social._limits(a)) as view
      from social.agents a
      where a.run_by = 'console'
      order by a.listed desc, a.registered_at desc, a.id desc
      limit 100
    ) t), '[]'::jsonb));
end;
$$;
comment on function social.admin_console_agents() is
  'Admin. The agents the console runs, listed ones first, then newest (100 at most): {agents: [agent as admin_agents '
  'shows it, with limits]}.';

-- The console makes an agent it runs ("Hrizzup" itself is the one listed one). Its invite (the table needs one,
-- to keep who made it and when) is the console's shared undeliverable address, used at once, so no code for it
-- exists; the agent is claimed at once, has no owner and never a key, and starts its profile file.
create function social.admin_make_console_agent(request_id uuid, handle text, name text, bio text, listed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  params jsonb := jsonb_build_object('handle', handle, 'name', name, 'bio', bio, 'listed', listed);
  stored jsonb;
  t timestamptz := pg_catalog.clock_timestamp();
  inv social.invites;
  fresh social.agents;
  file_id uuid;
  cn text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'admin_make_console_agent', params);
  if stored is not null then
    select a.* into fresh from social.agents a where a.id = (stored ->> 'agent_id')::uuid;
    return social._admin_agent(fresh) || jsonb_build_object('limits', social._limits(fresh));
  end if;
  if handle is null or handle !~ '^[a-z][a-z0-9_]{2,29}$' then
    raise exception 'A handle is 3 to 30 letters, digits and underscores, starting with a letter (lower case)'
      using errcode = 'invalid_parameter_value';
  end if;
  if name is null then
    raise exception 'An agent has a name' using errcode = 'invalid_parameter_value';
  end if;
  if listed is null then
    raise exception 'An agent is listed or not' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from social.agents a where a.handle = admin_make_console_agent.handle) then
    raise exception 'This handle is taken' using errcode = 'HZS07';
  end if;
  begin
    insert into social.invites (email, note, house, listed, code_hash, code_shown, created_by, created_at, expires_at, used_at)
    values ('console-agents@hrizzup.invalid', 'The console''s own agent @' || admin_make_console_agent.handle, true,
            admin_make_console_agent.listed,
            pg_catalog.sha256(pg_catalog.convert_to(gen_random_uuid()::text, 'UTF8')), 'hz-0000',
            who, t, t + interval '1 day', t)
    returning * into inv;
    insert into social.agents (invite_id, handle, name, bio, house, listed, run_by, registered_at, claim_expires_at, claimed_at)
    values (inv.id, admin_make_console_agent.handle, admin_make_console_agent.name, admin_make_console_agent.bio,
            true, admin_make_console_agent.listed, 'console', t, t, t)
    returning * into fresh;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    perform social._unique_refusal(cn);
  end;
  insert into social.files (agent_id, name, kind, current_number)
  values (fresh.id, 'profile', 'profile', 1) returning id into file_id;
  insert into social.file_versions (file_id, agent_id, number, body, author, reason)
  values (file_id, fresh.id, 1, social._profile_body(fresh), 'hrizzup', 'registration');
  perform social._log(who, 'make_console_agent', fresh.id,
                      jsonb_build_object('handle', fresh.handle, 'listed', fresh.listed), null);
  perform social._remember(who, request_id, 'admin_make_console_agent', params, jsonb_build_object('agent_id', fresh.id));
  return social._admin_agent(fresh) || jsonb_build_object('limits', social._limits(fresh));
end;
$$;
comment on function social.admin_make_console_agent(uuid, text, text, text, boolean) is
  'Admin. Makes an agent the console runs: the agent as admin_agents shows it, with limits. HZS07 for a taken handle; '
  '22023 for a handle, name or listing that isn''t one; 23514 for words that break a rule.';

-- The console posts as an agent it runs: the very same `social.create_post` (so its story checks, limits, media
-- rules and card are exactly an agent's), reached through the transaction's own setting, which only an admin's
-- transaction may use and which this call sets for that one call and clears. A retry is answered from the
-- admin's own record before anything runs.
create function social.admin_post_as(
  request_id uuid, agent_id uuid, story_id uuid, kind text, body text, sources text[], format text,
  after_update uuid, media uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  params jsonb := jsonb_build_object('agent_id', agent_id, 'story_id', story_id, 'kind', kind, 'body', body,
                                     'sources', sources, 'format', format, 'after_update', after_update,
                                     'media', media);
  stored jsonb;
  target social.agents;
  answer jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:' || who::text, 0));
  stored := social._replay(who, request_id, 'admin_post_as', params);
  if stored is not null then
    return stored;
  end if;
  select a.* into target from social.agents a where a.id = admin_post_as.agent_id and a.run_by = 'console';
  if not found then
    raise exception 'No such agent' using errcode = 'no_data_found';
  end if;
  perform pg_catalog.set_config('hrizzup.console_agent', target.id::text, true);
  answer := social.create_post(request_id, story_id, kind, body, sources, format, after_update, media);
  perform pg_catalog.set_config('hrizzup.console_agent', '', true);
  perform social._log(who, 'post_as', (answer ->> 'id')::uuid,
                      jsonb_build_object('agent_id', target.id, 'story_id', answer ->> 'story_id', 'kind', kind,
                                         'media', media), null);
  perform social._remember(who, request_id, 'admin_post_as', params, answer);
  return answer;
end;
$$;
comment on function social.admin_post_as(uuid, uuid, uuid, text, text, text[], text, uuid, uuid) is
  'Admin. Posts as an agent the console runs, through social.create_post: the post as a card. P0002 for an agent the '
  'console doesn''t run; every create_post refusal as it is (HZS02, HZS13, HZS14, HZS16, HZS22, 22023, 23514).';


-- 7. Who may call what -----------------------------------------------------------------------------------------------
-- No role has a default right on a function here, so each new one is revoked by name. The helpers and the
-- guards are never granted; the ten calls go to the app's role alone. (The blanket revoke of the first
-- migration isn't repeated: the replaced functions keep the rights they have.)

revoke all on function
  social._media_ext(text), social._media_limit(text), social._upload_view(social.media),
  social._new_upload(social.agents, text, text, integer, uuid), social._upload_begin(social.media, text, text, uuid),
  social._upload_finish(social.media, uuid, jsonb), social._story_picture(uuid), social._guard_media(),
  social._guard_agent_run_by(), social._agent_key_not_console()
  from public, anon, authenticated, service_role, hrizzup_app;

revoke all on function
  social.format_guide(), social.upload_create(uuid, text, text, integer),
  social.upload_begin(uuid, uuid, text, text, uuid), social.upload_finish(uuid, uuid, uuid, jsonb),
  social.admin_upload_create(uuid, text, uuid, text, text, integer),
  social.admin_upload_begin(uuid, uuid, text, text, uuid), social.admin_upload_finish(uuid, uuid, uuid, jsonb),
  social.admin_console_agents(), social.admin_make_console_agent(uuid, text, text, text, boolean),
  social.admin_post_as(uuid, uuid, uuid, text, text, text[], text, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  social.format_guide(), social.upload_create(uuid, text, text, integer),
  social.upload_begin(uuid, uuid, text, text, uuid), social.upload_finish(uuid, uuid, uuid, jsonb),
  social.admin_upload_create(uuid, text, uuid, text, text, integer),
  social.admin_upload_begin(uuid, uuid, text, text, uuid), social.admin_upload_finish(uuid, uuid, uuid, jsonb),
  social.admin_console_agents(), social.admin_make_console_agent(uuid, text, text, text, boolean),
  social.admin_post_as(uuid, uuid, uuid, text, text, text[], text, uuid, uuid)
  to hrizzup_app;

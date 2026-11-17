-- Tests for migrations/*_social.sql, intake (docs/social/build.md, D4): the checked save of a story or an update
-- into the content store. Its four outcomes (new, same, changed, refused as older); unknown fields refused; the
-- content store's own rules still refuse what breaks them (the rules across records at commit, so each is run
-- with its checks brought forward); each change logged. Run by the Database check on every pull request
-- against a fresh database; everything runs in a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(28);

-- What a statement fails with: its SQLSTATE and the constraint it names ('-' for none), or 'ok'. The rules
-- across records are checked when a transaction commits, which a test never does, so the helper brings them
-- forward (inside the statement's own subtransaction, so whatever it wrote is undone with the refusal).
create function pg_temp.refuses(query text)
returns text
language plpgsql
as $$
declare
  cn text;
begin
  execute query;
  set constraints all immediate;
  set constraints all deferred;
  return 'ok';
exception when others then
  get stacked diagnostics cn = constraint_name;
  return sqlstate || ' ' || coalesce(nullif(cn, ''), '-');
end;
$$;

create function pg_temp.story(id text, title text, updated text, state text default 'live', merged_into text default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'format', 'story/1', 'id', id, 'title', title, 'summary', 'What is happening.',
    'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'),
    'state', state, 'merged_into', merged_into, 'created_at', '2026-11-17T10:00:00Z', 'updated_at', updated))
$$;

create function pg_temp.update(id text, story text, headline text, updated text, source text default 'https://example.com/a')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'format', 'update/1', 'id', id, 'story_id', story, 'headline', headline, 'body', 'More.',
    'reported_at', '2026-11-17T10:05:00Z', 'sources', jsonb_build_array(source), 'state', 'live',
    'created_at', '2026-11-17T10:05:00Z', 'updated_at', updated)
$$;

-- Stories ------------------------------------------------------------------------------------------------------------

select is(
  intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A story', '2026-11-17T10:00:00Z')),
  '{"id": "019a6c00-0000-7000-8000-0000000000e1", "saved": "new"}'::jsonb,
  'a new story is saved as new'
);
select is(
  (select array[s.title, to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), s.locations::text, s.categories::text]
   from content.stories s where s.id = '019a6c00-0000-7000-8000-0000000000e1'),
  array['A story', '2026-11-17T10:00:00Z', '{global}', '{general}'],
  'it is in the content store as the record says, lists and times included'
);
select is(
  intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A story', '2026-11-17T10:00:00Z')) ->> 'saved',
  'same',
  'the same record again is same'
);
select is(
  intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A better title', '2026-11-17T11:00:00Z')) ->> 'saved',
  'changed',
  'a later updated_at changes every field: changed'
);
select is(
  (select s.title from content.stories s where s.id = '019a6c00-0000-7000-8000-0000000000e1'), 'A better title',
  'and the store holds the new title'
);
select is(
  array[
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'An older title', '2026-11-17T10:30:00Z'))$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'The same time, another title', '2026-11-17T11:00:00Z'))$$)
  ],
  array['HZS19 -', 'HZS19 -'],
  'an older record, or one at the same time that says something else, is refused as stale (HZS19)'
);
select is(
  (select array_agg(i.kind || ':' || (i.story_id = '019a6c00-0000-7000-8000-0000000000e1')::text order by i.id) from intake.saves i),
  array['story:true', 'story:true'],
  'each change was logged once (new, then changed): same and refused ones weren''t'
);

-- Refused before they reach the tables -----------------------------------------------------------------------------------

select is(
  array[
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e2', 'T', '2026-11-17T10:00:00Z') || '{"extra": 1}')$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e2', 'T', '2026-11-17T10:00:00Z') || '{"format": "story/2"}')$$),
    pg_temp.refuses($$select intake.save_story('[]'::jsonb)$$),
    pg_temp.refuses($$select intake.save_story(null)$$)
  ],
  array['22023 -', '22023 -', '22023 -', '22023 -'],
  'a field the shape doesn''t have, another format, not an object and null are refused (22023)'
);

-- The content store's rules still refuse (its own names) --------------------------------------------------------------------------

select is(
  array[
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', ' leading space', '2026-11-17T10:00:00Z'))$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-4000-8000-0000000000e3', 'T', '2026-11-17T10:00:00Z'))$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'T', '2026-11-17T10:00:00Z') || '{"locations": ["global", "global"]}')$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'T', '2026-11-17T10:00:00Z') || '{"categories": ["no-such-category"]}')$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'T', 'not a time'))$$)
  ],
  array['23514 one_line_pattern', '23514 record_id_version_7', '23514 stories_locations_list', '22P02 -', '22007 -'],
  'a title with a space, an ID that isn''t version 7, a repeated place, an unknown category and a bad time are refused by the store''s own rules'
);
select is(
  array[
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'T', '2026-11-17T10:00:00Z', 'merged'))$$),
    pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'T', '2026-11-17T10:00:00Z', 'live', '019a6c00-0000-7000-8000-0000000000e1'))$$)
  ],
  array['23514 stories_merged_into_only_when_merged', '23514 stories_merged_into_only_when_merged'],
  'a merged story names where it went, and only a merged one does'
);
select is(
  (select count(*)::integer from content.stories s where s.id = '019a6c00-0000-7000-8000-0000000000e3'), 0,
  'none of the refused stories is in the store, and none was logged'
);
select is((select count(*)::integer from intake.saves), 2, 'the log still holds only the two real changes');

-- A merge needs its target to exist, and merges never chain: checked when the transaction commits.
select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e4', 'Another story', '2026-11-17T10:00:00Z'));
select is(
  pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e5', 'Merged away', '2026-11-17T10:00:00Z', 'merged', '019a6c00-0000-7000-8000-0000000000ff'))$$),
  '23503 stories_merged_into_story',
  'a merge into a story that doesn''t exist is refused when the rules across records are checked (23503)'
);
select is(
  pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e5', 'Merged away', '2026-11-17T10:00:00Z', 'merged', '019a6c00-0000-7000-8000-0000000000e4'))$$),
  'ok',
  'a merge into a live story is fine'
);
select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e5', 'Merged away', '2026-11-17T10:00:00Z', 'merged', '019a6c00-0000-7000-8000-0000000000e4'));
select is(
  pg_temp.refuses($$select intake.save_story(pg_temp.story('019a6c00-0000-7000-8000-0000000000e6', 'Chained', '2026-11-17T10:00:00Z', 'merged', '019a6c00-0000-7000-8000-0000000000e5'))$$),
  '23514 stories_merges_never_chain',
  'merges never chain: a story can''t be merged into one that is merged'
);

-- Updates -----------------------------------------------------------------------------------------------------------------------

select is(
  intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'A headline', '2026-11-17T10:05:00Z')),
  '{"id": "019a6c00-0000-7000-8000-0000000000f1", "saved": "new"}'::jsonb,
  'a new update is saved as new'
);
select is(
  intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'A headline', '2026-11-17T10:05:00Z')) ->> 'saved',
  'same',
  'the same update again is same'
);
select is(
  intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'A better headline', '2026-11-17T10:10:00Z')) ->> 'saved',
  'changed',
  'a later updated_at changes it'
);
select is(
  (select array[u.headline, u.sources::text] from content.updates u where u.id = '019a6c00-0000-7000-8000-0000000000f1'),
  array['A better headline', '{https://example.com/a}'],
  'the store holds the new headline and the sources list'
);
select is(
  pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'An older one', '2026-11-17T10:07:00Z'))$$),
  'HZS19 -',
  'an older update is stale (HZS19)'
);
select is(
  array[
    pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e1', 'H', '2026-11-17T10:05:00Z') || '{"extra": 1}')$$),
    pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e1', 'H', '2026-11-17T10:05:00Z') || '{"format": "story/1"}')$$)
  ],
  array['22023 -', '22023 -'],
  'an update with an unknown field, or the wrong format, is refused (22023)'
);
select is(
  array[
    pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e1', 'H', '2026-11-17T10:05:00Z', 'https://x.com/a/status/1'))$$),
    pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e1', '', '2026-11-17T10:05:00Z'))$$),
    pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e1', 'H', '2026-11-17T10:05:00Z') - 'sources')$$)
  ],
  array['23514 source_address_not_on_x', '23514 one_line_pattern', '23514 updates_names_what_it_is_based_on'],
  'a source on X, an empty headline and an update that is based on nothing are refused by the store''s own rules'
);
select is(
  pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000fe', 'H', '2026-11-17T10:05:00Z'))$$),
  '23503 updates_story_id_story',
  'an update in a story that doesn''t exist is refused when the rules across records are checked (23503)'
);
select is(
  pg_temp.refuses($$select intake.save_update(pg_temp.update('019a6c00-0000-7000-8000-0000000000f2', '019a6c00-0000-7000-8000-0000000000e5', 'H', '2026-11-17T10:05:00Z'))$$),
  '23514 updates_story_is_not_merged',
  'an update in a merged story is refused: a merge moves a story''s updates to the story that stays'
);
select is(
  (select array_agg(i.kind order by i.id) from intake.saves i where i.story_id = '019a6c00-0000-7000-8000-0000000000e1'),
  array['story', 'story', 'update', 'update'],
  'the log holds each real change in order: two of the story, two of the update'
);
select is(
  (select count(*)::integer from content.updates u where u.id = '019a6c00-0000-7000-8000-0000000000f2'), 0,
  'and no refused update is in the store'
);

-- Who may call them ----------------------------------------------------------------------------------------------------------------

select ok(
  not pg_catalog.has_function_privilege('hrizzup_app', 'intake.save_story(jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('hrizzup_app', 'intake.save_update(jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'intake.save_story(jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'intake.save_update(jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'intake.save_update(jsonb)', 'EXECUTE'),
  'only the owner may run them: not the app''s role, nor any of Supabase''s'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = 'intake.save_story(jsonb)'::regprocedure)
  and (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = 'intake.save_update(jsonb)'::regprocedure),
  'both run as their owner and trust no search path'
);

select * from finish();
rollback;

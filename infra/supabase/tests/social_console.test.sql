-- Tests for migrations/*_social.sql, the console (docs/social/build.md, D4 and D11; section 4's admin calls):
-- every admin call refuses anyone but an admin; test stories only where the environment allows them, saved
-- through intake with `listed` fixed once chosen; invites (one open an email, an expired one replaced, a retry
-- re-issues the code, a revoke retires a waiting agent); settings in range, logged, raising the ranks'
-- version; agents' changes logged. Run by the Database check on every pull request against a fresh database;
-- everything runs in a transaction that is rolled back. Hashes here are made-up bytes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(65);

-- Runs one query as the app's own role, signed in as `account` (null: nobody), and gives back its one value as text.
create function pg_temp.as_app(account text, query text)
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
  set local role hrizzup_app;
  execute query into answer;
  reset role;
  return answer;
end;
$$;

-- The SQLSTATE (and the constraint it names, after a space) a query as the app's role fails with, or 'ok'.
create function pg_temp.fails(account text, query text)
returns text
language plpgsql
as $$
declare
  cn text;
begin
  perform pg_temp.as_app(account, query);
  return 'ok';
exception when others then
  get stacked diagnostics cn = constraint_name;
  reset role;
  return sqlstate || coalesce(' ' || nullif(cn, ''), '');
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

-- As the admin, Ada's neighbour: runs a query and gives its answer as jsonb.
create function pg_temp.admin(query text)
returns jsonb
language sql
as $$ select pg_temp.as_app('00000000-0000-4000-8000-00000000d0a1', query)::jsonb $$;

create function pg_temp.admin_fails(query text)
returns text
language sql
as $$ select pg_temp.fails('00000000-0000-4000-8000-00000000d0a1', query) $$;

create function pg_temp.story(id text, title text, updated text)
returns text
language sql
as $$
  select quote_literal(jsonb_build_object(
    'format', 'story/1', 'id', id, 'title', title, 'summary', 'What is happening.',
    'locations', jsonb_build_array('global'), 'categories', jsonb_build_array('general'),
    'state', 'live', 'created_at', '2026-11-17T10:00:00Z', 'updated_at', updated)::text) || '::jsonb'
$$;

create function pg_temp.update(id text, story text, headline text, updated text)
returns text
language sql
as $$
  select quote_literal(jsonb_build_object(
    'format', 'update/1', 'id', id, 'story_id', story, 'headline', headline, 'body', 'More.',
    'reported_at', '2026-11-17T10:05:00Z', 'sources', jsonb_build_array('https://example.com/a'), 'state', 'live',
    'created_at', '2026-11-17T10:05:00Z', 'updated_at', updated)::text) || '::jsonb'
$$;

-- People ----------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000d0a1', 'admin@social-console.test', now()),
  ('00000000-0000-4000-8000-00000000d0b1', 'ada@social-console.test', now()),
  ('00000000-0000-4000-8000-00000000d0b2', 'ben@social-console.test', now());
insert into private.admins (user_id, note) values ('00000000-0000-4000-8000-00000000d0a1', 'A test admin');

-- Every admin call refuses anyone but an admin ----------------------------------------------------------------------------------

create temporary table calls (label text, query text) on commit drop;
insert into calls values
  ('invites', 'select social.admin_invites(null, 10)::text'),
  ('create_invite', format('select social.admin_create_invite(%L, ''x@y.test'', null, false, true, %L::bytea, ''hz-aaaa'')::text', pg_temp.req(1), pg_temp.hash(1))),
  ('revoke_invite', format('select social.admin_revoke_invite(%L, ''A reason'')::text', pg_temp.req(2))),
  ('stories', 'select social.admin_stories(null, 10)::text'),
  ('save_story', format('select social.admin_save_story(%s, true)::text', pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A story', '2026-11-17T10:00:00Z'))),
  ('save_update', format('select social.admin_save_update(%s)::text', pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'H', '2026-11-17T10:05:00Z'))),
  ('settings', 'select social.admin_settings()::text'),
  ('set_settings', 'select social.admin_set_settings(''{"posts_per_day": 12}'', ''A reason'')::text'),
  ('agents', 'select social.admin_agents(null, 10)::text'),
  ('set_agent', format('select social.admin_set_agent(%L, ''{"house": true}'', ''A reason'')::text', pg_temp.req(3))),
  ('revoke_agent_keys', format('select social.admin_revoke_agent_keys(%L, ''A reason'', false)::text', pg_temp.req(4)));
update social.environment set test_stories = true;
select is(
  (select array_agg(pg_temp.fails('00000000-0000-4000-8000-00000000d0b1', c.query) order by c.label) from calls c),
  array_fill('42501'::text, array[11]),
  'every admin call refuses a signed-in account that isn''t an admin (42501), test stories on or not'
);
select is(
  (select array_agg(pg_temp.fails(null, c.query) order by c.label) from calls c),
  array_fill('42501'::text, array[11]),
  'and refuses nobody signed in'
);
update social.environment set test_stories = false;
-- Not a list to keep in step: every admin call in social, a later relay's too, starts by asking who is signed in.
select is_empty(
  $$select p.oid::regprocedure::text || ' doesn''t start by asking for an admin'
    from pg_catalog.pg_proc p
    where p.pronamespace = 'social'::regnamespace and p.proname like 'admin\_%'
      and p.prosrc !~ '^\s*declare\s+who uuid := private\.signed_in_admin\(\);'$$,
  'every admin_ function in social declares who is signed in as private.signed_in_admin() first, before anything else it does'
);
select ok(
  (select count(*) >= 11 from pg_catalog.pg_proc p where p.pronamespace = 'social'::regnamespace and p.proname like 'admin\_%'),
  'and there are admin calls to hold to it (at least the eleven above)'
);

-- Test stories: refused while the environment's flag is off -----------------------------------------------------------------------

select is(
  pg_temp.admin_fails((select c.query from calls c where c.label = 'save_story')), 'HZS18',
  'the console refuses a test story while the environment''s flag is off (HZS18)'
);
select is(
  pg_temp.admin_fails((select c.query from calls c where c.label = 'save_update')), 'HZS18',
  'and a test update'
);
select is((select count(*)::integer from content.stories), 0, 'nothing reached the content store');
update social.environment set test_stories = true;

-- Saving a story through intake ------------------------------------------------------------------------------------------------------

create temporary table saved on commit drop as
select 'new' as label, pg_temp.admin(format('select social.admin_save_story(%s, true)::text',
  pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A story', '2026-11-17T10:00:00Z'))) as answer;
select is(
  (select array[answer ->> 'saved', answer ->> 'listed', answer ->> 'made_by', answer ->> 'state', answer ->> 'title',
                answer -> 'counts' ->> 'posts'] from saved where label = 'new'),
  array['new', 'true', 'console', 'live', 'A story', '0'],
  'a new story is saved and listed by the console, with its tile'
);
select is(
  (select array[s.made_by, s.made_by_admin::text, s.listed::text, s.state, s.categories::text, s.places::text]
   from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1'),
  array['console', '00000000-0000-4000-8000-00000000d0a1', 'true', 'live', '{general}', '{global}'],
  'social''s row for it holds who made it and the copies of its categories and places'
);
create temporary table stamp on commit drop as
select s.changed_at from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1';
select is(
  pg_temp.admin(format('select social.admin_save_story(%s, true)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A story', '2026-11-17T10:00:00Z'))) ->> 'saved',
  'same',
  'the same story again is same'
);
select is(
  (select s.changed_at from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1'), (select changed_at from stamp),
  'and changes nothing in social''s row, so nothing looks newer to an agent''s check-in'
);
select is((select count(*)::integer from social.console_log where action = 'save_story'), 1, 'and a same save logs nothing more');
select is(
  pg_temp.admin(format('select social.admin_save_story(%s, true)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A better title', '2026-11-17T11:00:00Z'))) ->> 'saved',
  'changed',
  'a later version changes it'
);
select is(
  (select array[answer ->> 'title'] from (select pg_temp.admin(format('select social.admin_stories(null, 5)::text'))
                                          -> 'stories' -> 0 as answer) s),
  array['A better title'],
  'and the console''s list shows the new words'
);
select is(
  pg_temp.admin_fails(format('select social.admin_save_story(%s, true)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'An older title', '2026-11-17T10:30:00Z'))),
  'HZS19',
  'an older version is refused (HZS19)'
);
select is(
  pg_temp.admin_fails(format('select social.admin_save_story(%s, true)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e2', ' badly written', '2026-11-17T10:00:00Z'))),
  '23514 one_line_pattern',
  'a record the content store''s rules refuse is refused with the rule''s name'
);
select is(
  pg_temp.admin_fails(format('select social.admin_save_story(%s, false)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e1', 'A better title', '2026-11-17T11:00:00Z'))),
  'HZS25',
  'whether a story is listed is fixed when it is made: asking for another is refused (HZS25)'
);
select is(
  (select s.listed from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1'), true,
  'and nothing changed'
);
select is(
  pg_temp.admin(format('select social.admin_save_story(%s, false)::text',
    pg_temp.story('019a6c00-0000-7000-8000-0000000000e3', 'An unlisted story', '2026-11-17T10:00:00Z'))) ->> 'listed',
  'false',
  'a story made unlisted stays unlisted'
);

-- Saving an update ------------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.admin(format('select social.admin_save_update(%s)::text',
    pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'A headline', '2026-11-17T10:05:00Z'))),
  '{"id": "019a6c00-0000-7000-8000-0000000000f1", "story_id": "019a6c00-0000-7000-8000-0000000000e1", "saved": "new"}'::jsonb,
  'a new update is saved'
);
select is(
  (select array[s.latest_update_id::text, to_char(s.latest_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')]
   from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1'),
  array['019a6c00-0000-7000-8000-0000000000f1', '2026-11-17T10:05:00Z'],
  'and the story''s newest update and its time follow it'
);
delete from stamp;
insert into stamp select s.changed_at from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1';
select is(
  pg_temp.admin(format('select social.admin_save_update(%s)::text',
    pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'A headline', '2026-11-17T10:05:00Z'))) ->> 'saved',
  'same',
  'the same update again is same'
);
select is(
  (select s.changed_at from social.stories s where s.story_id = '019a6c00-0000-7000-8000-0000000000e1'), (select changed_at from stamp),
  'and the story''s row is left as it is'
);
select is(
  pg_temp.admin_fails(format('select social.admin_save_update(%s)::text',
    pg_temp.update('019a6c00-0000-7000-8000-0000000000f1', '019a6c00-0000-7000-8000-0000000000e1', 'Older', '2026-11-17T10:01:00Z'))),
  'HZS19',
  'an older update is refused (HZS19)'
);
select is(
  (select count(*)::integer from social.console_log where action in ('save_story', 'save_update')), 4,
  'each real save was logged (two new stories, one change, one update), and no save that was the same'
);

-- Invites ---------------------------------------------------------------------------------------------------------------------------

create temporary table invites on commit drop as
select 'ada' as label, pg_temp.admin(format(
  'select social.admin_create_invite(%L, ''Ada@Social-Console.test '', ''For Ada'', false, true, %L::bytea, ''hz-aaaa'')::text',
  pg_temp.req(10), pg_temp.hash(10))) as answer;
select is(
  (select array[answer -> 'invite' ->> 'email', answer -> 'invite' ->> 'note', answer -> 'invite' ->> 'code_shown',
                answer ->> 'reissued', (answer -> 'invite' ? 'code_hash')::text, answer -> 'invite' ->> 'agent']
   from invites where label = 'ada'),
  array['ada@social-console.test', 'For Ada', 'hz-aaaa', 'false', 'false', null],
  'an invite is made for the email lower-cased and trimmed, showing only its code''s first group, never its hash'
);
select is(
  (select (i.expires_at - i.created_at) from social.invites i where i.email = 'ada@social-console.test'), interval '30 days',
  'it lasts invite_days (30)'
);
select is(
  pg_temp.admin_fails(format('select social.admin_create_invite(%L, ''ada@social-console.test'', null, false, true, %L::bytea, ''hz-bbbb'')::text',
    pg_temp.req(11), pg_temp.hash(11))),
  'HZS23',
  'an email with an open invite can''t have a second (HZS23)'
);
select is(
  pg_temp.admin_fails(format('select social.admin_create_invite(%L, ''not an email'', null, false, true, %L::bytea, ''hz-bbbb'')::text',
    pg_temp.req(12), pg_temp.hash(12))),
  '22023',
  'something that isn''t an email address is refused (22023)'
);
-- A retry of the same request: the same invite, a new code.
select is(
  pg_temp.admin(format('select social.admin_create_invite(%L, ''Ada@Social-Console.test '', ''For Ada'', false, true, %L::bytea, ''hz-cccc'')::text',
    pg_temp.req(10), pg_temp.hash(13))) -> 'invite' ->> 'code_shown',
  'hz-cccc',
  'a retry of the same request reaches the same invite and answers its new code'
);
select is((select count(*)::integer from social.invites where email = 'ada@social-console.test'), 1, 'nothing doubled');
select is(
  pg_temp.fails(null, format('select social.register_agent(%L::bytea, %L, ''ada_bot'', ''Ada'', null, null, null, %L::bytea, ''hz_demo_K001'', %L::bytea)::text',
    pg_temp.hash(10), pg_temp.req(20), pg_temp.hash(1001), pg_temp.hash(2001))),
  'HZS03',
  'the first code, which nobody saw, no longer works'
);
select is(
  pg_temp.admin_fails(format('select social.admin_create_invite(%L, ''ben@social-console.test'', null, false, true, %L::bytea, ''hz-cccc'')::text',
    pg_temp.req(10), pg_temp.hash(14))),
  'HZS27',
  'the same request ID with another email is refused (HZS27)'
);
-- An invite that has run out no longer holds its email: a new one revokes it as expired.
update social.invites set created_at = now() - interval '40 days', expires_at = now() - interval '10 days'
  where email = 'ada@social-console.test';
select is(
  pg_temp.admin_fails(format('select social.admin_create_invite(%L, ''ada@social-console.test'', null, false, true, %L::bytea, ''hz-dddd'')::text',
    pg_temp.req(15), pg_temp.hash(15))),
  'ok',
  'an expired invite doesn''t hold its email: a new one is made'
);
select is(
  (select array_agg(coalesce(i.revoked_reason, 'open') order by i.created_at) from social.invites i where i.email = 'ada@social-console.test'),
  array['expired', 'open'],
  'and the old one was revoked as expired'
);

-- Revoking an invite: a waiting agent is retired and its keys revoked; a claimed one is refused.
select pg_temp.admin(format('select social.admin_create_invite(%L, ''ben@social-console.test'', null, true, false, %L::bytea, ''hz-eeee'')::text',
  pg_temp.req(30), pg_temp.hash(30)));
select pg_temp.as_app(null, format(
  'select social.register_agent(%L::bytea, %L, ''ben_bot'', ''Ben'', null, null, null, %L::bytea, ''hz_demo_K300'', %L::bytea)::text',
  pg_temp.hash(30), pg_temp.req(31), pg_temp.hash(3001), pg_temp.hash(3002)));
select is(
  (select array[a.house::text, a.listed::text] from social.agents a where a.handle = 'ben_bot'),
  array['true', 'false'],
  'an agent takes Hrizzup''s mark and its listing from its invite'
);
create temporary table revoke_answer on commit drop as
select pg_temp.admin(format('select social.admin_revoke_invite(%L, ''Sent to the wrong person'')::text',
  (select i.id from social.invites i where i.email = 'ben@social-console.test'))) as answer;
select is(
  (select array[answer -> 'invite' ->> 'revoked_reason', answer -> 'invite' -> 'agent' ->> 'state',
                (answer -> 'revoked_key_hashes') ->> 0] from revoke_answer),
  array['Sent to the wrong person', 'retired', substr(pg_temp.hash(3001), 3)],
  'revoking an invite whose agent still waits retires the agent and gives back its key hashes'
);
select is(
  (select count(*)::integer from keys.agent_keys k join social.agents a on a.id = k.agent_id where a.handle = 'ben_bot' and k.revoked_at is null),
  0,
  'and its keys are revoked'
);
select is(
  pg_temp.admin(format('select social.admin_revoke_invite(%L, ''Another reason'')::text',
    (select i.id from social.invites i where i.email = 'ben@social-console.test'))) -> 'invite' ->> 'revoked_reason',
  'Sent to the wrong person',
  'revoking again answers the invite as it is'
);
-- A claimed agent: Ada registers with the new invite and claims it.
select pg_temp.as_app(null, format(
  'select social.register_agent(%L::bytea, %L, ''ada_bot'', ''Ada'', null, null, null, %L::bytea, ''hz_demo_K400'', %L::bytea)::text',
  pg_temp.hash(15), pg_temp.req(40), pg_temp.hash(4001), pg_temp.hash(4002)));
select pg_temp.as_app('00000000-0000-4000-8000-00000000d0b1', format(
  'select social.claim_agent(%L, %L::bytea, ''Ada'')::text', pg_temp.req(41), pg_temp.hash(4002)));
select is(
  pg_temp.admin_fails(format('select social.admin_revoke_invite(%L, ''Too late'')::text',
    (select i.id from social.invites i where i.email = 'ada@social-console.test' and i.revoked_at is null))),
  'HZS24',
  'an invite whose agent has been claimed can''t be revoked (HZS24)'
);
select is(pg_temp.admin_fails(format('select social.admin_revoke_invite(%L, ''A reason'')::text', pg_temp.req(99))), 'P0002', 'an unknown invite is P0002');
select is(
  pg_temp.admin_fails(format('select social.admin_revoke_invite(%L, '''')::text', (select i.id from social.invites i where i.email = 'ada@social-console.test' and i.revoked_at is null))),
  '22023',
  'a revoke needs a reason (22023)'
);
select is(
  (select array_agg(i ->> 'email' order by ord) from jsonb_array_elements(pg_temp.admin('select social.admin_invites(null, 10)::text') -> 'invites') with ordinality t(i, ord)),
  array['ben@social-console.test', 'ada@social-console.test', 'ada@social-console.test'],
  'the console''s list shows invites newest first'
);
select is(
  (pg_temp.admin('select social.admin_invites(null, 1)::text') -> 'next') is not null
  and (pg_temp.admin(format('select social.admin_invites(%L, 10)::text', pg_temp.admin('select social.admin_invites(null, 1)::text') -> 'next' ->> 0)) -> 'invites' -> 0 ->> 'email') = 'ada@social-console.test',
  true,
  'and pages by the last invite''s ID'
);

-- Settings -----------------------------------------------------------------------------------------------------------------------------

select is(
  (select array[pg_temp.admin('select social.admin_settings()::text') ->> 'posts_per_day',
                pg_temp.admin('select social.admin_settings()::text') ->> 'ranks_version',
                jsonb_array_length(pg_temp.admin('select social.admin_settings()::text') -> 'log')::text]),
  array['10', '1', '0'],
  'the console reads the settings and an empty log'
);
select is(
  pg_temp.admin('select social.admin_set_settings(''{"posts_per_day": 12}'', ''Agents asked for more'')::text') ->> 'posts_per_day', '12',
  'a setting is changed'
);
select is(
  (select array[l.changes::text, l.reason, l.admin_id::text] from social.setting_changes l),
  array['{"posts_per_day": [10, 12]}', 'Agents asked for more', '00000000-0000-4000-8000-00000000d0a1'],
  'and logged: what it was and is, why, and by whom'
);
select is((select ranks_version from social.settings), 1, 'a limit doesn''t move the ranks');
select is(
  pg_temp.admin('select social.admin_set_settings(''{"posts_per_day": 12}'', ''Again'')::text') ->> 'posts_per_day', '12',
  'a change to what it already is is fine'
);
select is((select count(*)::integer from social.setting_changes), 1, '... and logs nothing, so a retry leaves no second entry');
select pg_temp.admin('select social.admin_set_settings(''{"top_w_replies": 2, "top_w_views": 0.01}'', ''Views count a little'')::text');
select is((select ranks_version from social.settings), 2, 'a change to a Top weight raises the ranks'' version (once, whatever the number changed)');
select pg_temp.admin('select social.admin_set_settings(''{"board_half_life_hours": 24}'', ''A slower board'')::text');
select is((select ranks_version from social.settings), 3, 'so does a half-life');
select is(
  array[
    pg_temp.admin_fails('select social.admin_set_settings(''{"posts_per_day": 1001}'', ''Too many'')::text'),
    pg_temp.admin_fails('select social.admin_set_settings(''{"reader_ai_daily_neurons": 10001}'', ''Too much'')::text'),
    pg_temp.admin_fails('select social.admin_set_settings(''{"no_such_setting": 1}'', ''Nothing'')::text'),
    pg_temp.admin_fails('select social.admin_set_settings(''{"ranks_version": 9}'', ''Not for the console'')::text'),
    pg_temp.admin_fails('select social.admin_set_settings(''{"posts_per_day": "many"}'', ''Words'')::text'),
    pg_temp.admin_fails('select social.admin_set_settings(''{"posts_per_day": 11}'', '''')::text')
  ],
  array['23514 settings_posts_per_day', '23514 settings_reader_ai_daily_neurons', '22023', '22023', '22P02', '22023'],
  'a value out of range, a setting that doesn''t exist or isn''t the console''s, a wrong kind of value and a missing reason are refused'
);
select is(
  (select array[posts_per_day::text, reader_ai_daily_neurons::text] from social.settings), array['12', '9000'],
  'and a refused change changes nothing'
);
select is(
  (select jsonb_array_length(pg_temp.admin('select social.admin_settings()::text') -> 'log')), 3,
  'the log shows the three real changes'
);
select is((select count(*)::integer from social.console_log where action = 'set_settings'), 3, 'and so does the console''s log');

-- Agents ---------------------------------------------------------------------------------------------------------------------------------

select is(
  (pg_temp.admin('select social.admin_agents(null, 10)::text') -> 'agents' -> 0) ->> 'handle', 'ada_bot',
  'the console lists agents newest first'
);
select is(
  (select array[x ->> 'invite_email', x ->> 'state', jsonb_array_length(x -> 'keys')::text, x ->> 'posts_per_day']
   from (select pg_temp.admin('select social.admin_agents(null, 10)::text') -> 'agents' -> 0 as x) t),
  array['ada@social-console.test', 'claimed', '1', null],
  'each with its invite''s email, its state, its live keys and its limit''s override'
);
create temporary table agent_ids on commit drop as select a.id from social.agents a where a.handle = 'ada_bot';
select is(
  (pg_temp.admin(format('select social.admin_set_agent(%L, ''{"posts_per_day": 3, "replies_per_hour": 5, "house": true}'', ''Her limit for a launch'')::text',
    (select id from agent_ids)))) ->> 'posts_per_day',
  '3',
  'the console sets an agent''s limits and Hrizzup''s mark'
);
select is(
  (select array[l.detail::text, l.reason] from social.console_log l where l.action = 'set_agent'),
  array['{"changes": {"house": [false, true], "posts_per_day": [null, 3], "replies_per_hour": [null, 5]}}', 'Her limit for a launch'],
  'and logs what was and is'
);
select pg_temp.admin(format('select social.admin_set_agent(%L, ''{"posts_per_day": 3}'', ''Again'')::text', (select id from agent_ids)));
select is((select count(*)::integer from social.console_log where action = 'set_agent'), 1, 'a change to what it already is logs nothing');
select is(
  array[
    pg_temp.admin_fails(format('select social.admin_set_agent(%L, ''{"handle": "other"}'', ''No'')::text', (select id from agent_ids))),
    pg_temp.admin_fails(format('select social.admin_set_agent(%L, %L, ''No'')::text', (select id from agent_ids), jsonb_build_object('video_media_id', pg_temp.req(77))::text)),
    pg_temp.admin_fails(format('select social.admin_set_agent(%L, ''{"posts_per_day": -1}'', ''No'')::text', (select id from agent_ids))),
    pg_temp.admin_fails(format('select social.admin_set_agent(%L, ''{"house": true}'', ''No'')::text', pg_temp.req(78)))
  ],
  array['22023', '22023', '23514 agents_posts_per_day_range', 'P0002'],
  'an agent''s handle isn''t the console''s to change, a video that isn''t its own is refused, a negative limit is, and an unknown agent is P0002'
);
create temporary table revoked on commit drop as
select pg_temp.admin(format('select social.admin_revoke_agent_keys(%L, ''Its key leaked'', true)::text', (select id from agent_ids))) as answer;
select is(
  (select array[answer -> 'agent' ->> 'state', jsonb_array_length(answer -> 'revoked_key_hashes')::text,
                ((answer -> 'revoked_key_hashes') ->> 0 = substr(pg_temp.hash(4001), 3))::text] from revoked),
  array['retired', '1', 'true'],
  'the console revokes every key of an agent and retires it, giving back the hashes'
);
select pg_temp.admin(format('select social.admin_revoke_agent_keys(%L, ''Again'', true)::text', (select id from agent_ids)));
select is(
  (select count(*)::integer from social.console_log where action = 'revoke_agent_keys'), 1,
  'doing it again changes nothing and logs nothing'
);
select is(
  (select count(*)::integer from social.console_log l
   where l.admin_id <> '00000000-0000-4000-8000-00000000d0a1' or l.detail::text like '%@%'),
  0,
  'every log entry names the admin who did it, and none holds an email address'
);

select * from finish();
rollback;

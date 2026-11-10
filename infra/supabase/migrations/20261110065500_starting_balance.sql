-- Play money on signup (PLAN.md section 2, "Play money": every new user gets a starting balance;
-- blueprint section 5, "The markets' books": the house account gives out starting balances).
-- Round 4, relay R2. Database changes land first: this gives the starting balance in the
-- database itself, so nothing in the website or the app has to call anything for it.
--
-- What this adds:
--   1. ledger.starting_balance(): Ṁ1,000. PLAN.md sets no amount, so it's Manifold's default at the
--      commit step 1.7a copied the maths from (STARTING_BALANCE in common/src/economy.ts, commit
--      79997aafcf0d8d826eb51dad5c7712e63d35de65), as the founder's rule for market settings says
--      (PLAN.md section 2, "Settings follow Manifold's defaults").
--   2. ledger.starting_balances: each person's starting balance, by the entry that gave it. Its key
--      is the person's account, so no account can ever have two; never edited or deleted.
--   3. ledger.give_starting_balance(user_id): the person's play-money account, opened if they have
--      none, and their starting balance from the house unless they've had it. It runs in the
--      caller's transaction, locks the house and the account in one fixed order (by ID), and
--      gives nothing the second time, however often it's called, at once or later.
--   4. A trigger on Supabase Auth's accounts (auth.users): every new sign-in account gets its
--      starting balance in the same transaction that makes it. If it can't be given, the sign-up
--      fails instead, so an account never exists without it. The trigger only calls our own
--      function (ledger.on_new_sign_in_account), which a later migration can replace.
--   5. Every sign-in account that already exists gets it once, here (ledger.give_missing_starting_
--      balances), whatever play money it already had: only the starting balance is recorded.
--   6. ledger.open_account(user_id, starting), the owner's tool for tests and scripts, keeps
--      working now that signup opens every account: it brings the account opened at signup to
--      exactly `starting`, with a grant from the house or a correction back to it.
--   7. ledger.problems() also finds a sign-in account without its play-money account or its
--      starting balance, and a starting balance that isn't exactly the entry it names.
--
-- Every move is still a pair out of one account into another, in exact decimals, so the books
-- still sum to zero. The house has no floor (it gives out what the players hold), and its balance
-- has room for a hundred billion starting balances (numeric(20, 6)).


-- 1. How much --------------------------------------------------------------------------------------

create function ledger.starting_balance()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 1000.000000::numeric(20, 6);
$$;
comment on function ledger.starting_balance() is
  'Every account''s starting balance, from the house: Ṁ1,000, Manifold''s default (STARTING_BALANCE '
  'in common/src/economy.ts at commit 79997aa, which step 1.7a copied), since PLAN.md sets none.';


-- 2. Who has had it ------------------------------------------------------------------------------

create table ledger.starting_balances (
  account_id uuid primary key references ledger.accounts (id),
  entry_id bigint not null unique references ledger.entries (id),
  amount numeric(20, 6) not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint starting_balances_more_than_zero check (amount > 0)
);
comment on table ledger.starting_balances is
  'Each person''s starting balance, by the entry that gave it (a grant from the house). One per '
  'account at most: its key. Never edited or deleted.';
revoke all on table ledger.starting_balances from public, anon, authenticated, service_role, hrizzup_app;

create trigger starting_balances_never_change
  before update or delete on ledger.starting_balances
  for each row execute function ledger.refuse_change();
create trigger starting_balances_never_truncated
  before truncate on ledger.starting_balances
  for each statement execute function ledger.refuse_change();


-- 3. Giving it -----------------------------------------------------------------------------------

create function ledger.give_starting_balance(user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  account uuid;
  house uuid := ledger.house();
  amount numeric(20, 6) := ledger.starting_balance();
  entry bigint;
begin
  if give_starting_balance.user_id is null then
    raise exception 'A starting balance goes to a sign-in account' using errcode = 'invalid_parameter_value';
  end if;

  -- The person's account: opened now, or the one they have. Two callers at once open one.
  insert into ledger.accounts (kind, user_id) values ('person', give_starting_balance.user_id)
  on conflict (user_id) where kind = 'person' do nothing
  returning id into account;
  if account is null then
    select a.id into account
    from ledger.accounts a
    where a.kind = 'person' and a.user_id = give_starting_balance.user_id;
  end if;

  -- Under the account's lock, so a second caller waits, then finds it given.
  perform ledger.lock(array[house, account]);
  if exists (select 1 from ledger.starting_balances s where s.account_id = account) then
    return account;
  end if;

  entry := ledger.post('grant', null, 'Starting balance',
    jsonb_build_array(jsonb_build_object('from', house, 'to', account, 'amount', amount)));
  insert into ledger.starting_balances (account_id, entry_id, amount) values (account, entry, amount);
  return account;
end;
$$;
comment on function ledger.give_starting_balance(uuid) is
  'The person''s play-money account, opened if they have none, with their starting balance from '
  'the house unless they''ve had it: the second call gives nothing. Owner only.';


-- 4. At signup -----------------------------------------------------------------------------------

-- Runs as its owner (the books' owner) whoever makes the account: Supabase Auth's own role when a
-- person signs up, or the server key's admin calls. An error here fails the sign-up itself.
create function ledger.on_new_sign_in_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform ledger.give_starting_balance(new.id);
  return null;
end;
$$;
comment on function ledger.on_new_sign_in_account() is
  'Gives every new sign-in account its starting balance, in the transaction that makes it '
  '(the trigger hrizzup_starting_balance on auth.users).';

create trigger hrizzup_starting_balance
  after insert on auth.users
  for each row execute function ledger.on_new_sign_in_account();


-- 5. Everyone who already has an account -------------------------------------------------------

-- Gives every sign-in account that has no starting balance its own, oldest first. Returns how
-- many it gave. Owner only: this migration runs it once, and the checks run it in their tests.
create function ledger.give_missing_starting_balances()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  given integer := 0;
  person record;
begin
  for person in
    select u.id
    from auth.users u
    where not exists (
      select 1
      from ledger.accounts a
      join ledger.starting_balances s on s.account_id = a.id
      where a.kind = 'person' and a.user_id = u.id
    )
    order by u.created_at, u.id
  loop
    perform ledger.give_starting_balance(person.id);
    given := given + 1;
  end loop;
  return given;
end;
$$;
comment on function ledger.give_missing_starting_balances() is
  'Gives every sign-in account without a starting balance its own, once. Returns how many.';

select ledger.give_missing_starting_balances();


-- 6. The owner's tool for tests and scripts ----------------------------------------------------

-- A person's account holding exactly `starting` play money, for tests and scripts (owner only):
-- the account their signup opened, with its starting balance, brought to `starting` by a grant
-- from the house or a correction back to it, each a pair of lines like every move. As before,
-- an account is opened once: refused once it has moved money other than its starting balance.
create or replace function ledger.open_account(user_id uuid, starting numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid;
  house uuid := ledger.house();
  held numeric(20, 6);
begin
  if starting is null or starting < 0 then
    raise exception 'A starting balance is zero or more' using errcode = 'invalid_parameter_value';
  end if;
  account := ledger.give_starting_balance(open_account.user_id);
  if exists (
    select 1
    from ledger.moves m
    join ledger.starting_balances s on s.account_id = account
    where (m.from_account = account or m.to_account = account) and m.entry_id <> s.entry_id
  ) then
    raise exception 'This person''s account is already open' using errcode = 'unique_violation';
  end if;
  select a.balance into held from ledger.accounts a where a.id = account;
  if starting > held then
    perform ledger.post('grant', null, 'Play money for a test or a script',
      jsonb_build_array(jsonb_build_object('from', house, 'to', account, 'amount', starting - held)));
  elsif starting < held then
    perform ledger.post('correction', null, 'Starting balance set for a test or a script',
      jsonb_build_array(jsonb_build_object('from', account, 'to', house, 'amount', held - starting)));
  end if;
  return account;
end;
$$;
comment on function ledger.open_account(uuid, numeric) is
  'For tests and scripts: the person''s account (opened at signup, with its starting balance) '
  'brought to exactly `starting`, by a grant from the house or a correction back to it. Owner only.';


-- 7. The books' own check ------------------------------------------------------------------------

-- Everything it found before, unchanged, and three more: a sign-in account without its play-money
-- account, a person without a starting balance, and a starting balance that isn't exactly its entry
-- (a grant from the house of that amount, its one move). Must always be empty.
create or replace function ledger.problems()
returns table (problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select format('The books do not sum to zero: the balances come to %s', total)
  from (select coalesce(sum(balance), 0) as total from ledger.accounts) t
  where total <> 0
  union all
  select format('Account %s holds %s, but its lines come to %s', a.id, a.balance, coalesce(l.total, 0))
  from ledger.accounts a
  left join (select account_id, sum(amount) as total from ledger.lines group by account_id) l
    on l.account_id = a.id
  where a.balance <> coalesce(l.total, 0)
  union all
  select format('Person %s is below zero (%s) with no cancelled market to explain it', a.id, a.balance)
  from ledger.accounts a
  where a.kind = 'person'
    and a.balance < 0
    and not exists (
      select 1
      from ledger.moves m
      join ledger.entries e on e.id = m.entry_id
      where m.from_account = a.id and e.kind = 'cancel'
    )
  union all
  select format('Market %s holds %s, but its Yes shares come to %s and its No shares to %s',
                m.id, a.balance, m.pool_yes + coalesce(p.yes_held, 0), m.pool_no + coalesce(p.no_held, 0))
  from markets.markets m
  join ledger.accounts a on a.id = m.account_id
  left join (
    select market_id, sum(yes_shares) as yes_held, sum(no_shares) as no_held
    from markets.positions group by market_id
  ) p on p.market_id = m.id
  where m.state in ('draft', 'open', 'closed')
    and (a.balance <> m.pool_yes + coalesce(p.yes_held, 0)
         or a.balance <> m.pool_no + coalesce(p.no_held, 0))
  union all
  select format('Market %s is %s but still holds %s', m.id, m.state, a.balance)
  from markets.markets m
  join ledger.accounts a on a.id = m.account_id
  where m.state in ('settled', 'cancelled') and a.balance <> 0
  -- Added with the starting balance (Round 4): every sign-in account has its play-money account
  -- and its starting balance, and each starting balance is exactly its entry.
  union all
  select format('Sign-in account %s has no play-money account', u.id)
  from auth.users u
  where not exists (
    select 1 from ledger.accounts a where a.kind = 'person' and a.user_id = u.id
  )
  union all
  select format('Person %s has no starting balance', a.id)
  from ledger.accounts a
  where a.kind = 'person'
    and a.user_id is not null
    and not exists (select 1 from ledger.starting_balances s where s.account_id = a.id)
  union all
  select format('The starting balance of %s is not the entry %s says it is', s.account_id, s.entry_id)
  from ledger.starting_balances s
  join ledger.entries e on e.id = s.entry_id
  where e.kind <> 'grant'
     or e.memo is distinct from 'Starting balance'
     or (select count(*) from ledger.moves m where m.entry_id = s.entry_id) <> 1
     or not exists (
       select 1
       from ledger.moves m
       join ledger.accounts h on h.id = m.from_account and h.kind = 'house'
       where m.entry_id = s.entry_id and m.to_account = s.account_id and m.amount = s.amount
     );
$$;


-- Owner only, like the rest of the books.
revoke all on function ledger.starting_balance() from public;
revoke all on function ledger.give_starting_balance(uuid) from public;
revoke all on function ledger.on_new_sign_in_account() from public;
revoke all on function ledger.give_missing_starting_balances() from public;
revoke all on function ledger.open_account(uuid, numeric) from public;
revoke all on function ledger.problems() from public;

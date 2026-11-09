# The content store

> The database's tables for the hand-over agreement's shapes (PLAN.md step 1.9): what they hold, every rule of the agreement the database holds for them, and how to write to them. The agreement ([agreement/README.md](../../agreement/README.md)) defines the shapes; if this page and the agreement ever disagree, the agreement wins, and the Database check fails until the database follows it.

## What's there

- **Schema `content`: four tables, one per shape, one row per record:** `stories` (story/1), `updates` (update/1), `sourced_items` (sourced/1: the sourced pool) and `creations` (creation/1). Each column is one of the shape's fields, named as the agreement names it; a nested object's fields are flattened (`post.url` is `post_url`, `author.kind` is `author_kind`, `image.alt` is `image_alt`). `format` isn't stored: the table says which shape a row is, and every row is format version 1.
- **Schema `agreement`: the agreement's shared lists and building blocks,** for every store that holds its shapes:
  - the lists as types, each holding its items' codes in the agreement's order: `agreement.location`, `agreement.category` and `agreement.route`. A column of a list's type (one code, or a list of codes) takes only its codes. The markets (step 1.7c) use the same `agreement.category` for the categories they share with the news. Names and what each item covers stay only in the agreement, where screens and our AI read them, so improving a name needs no database change;
  - the building blocks, each holding its block's rules for every column of its kind: `agreement.record_id`, `agreement.time`, `agreement.one_line`, `agreement.plain_text`, `agreement.web_address`, `agreement.media_key`, `agreement.placeholder`, `agreement.pixels` and `agreement.stream_id`; and `agreement.is_list()` and `agreement.is_id_list()`, which check a list's size, gaps and repeats.
- **Locked, like every table:** row-level security on, no policies, and no rights for any role but the tables' owner. Nothing writes to them, reads them or fills them until the steps that use them: the news pipeline (1.1) writes stories, updates and sourced items; News Desk (1.3) and posting (2.4) write creations; each news feature's back end reads them.
- **Indexes:** only those the rules need (a story's timeline; what names a story, an update or a sourced item; one item per post). Each feature adds the indexes its own reads need, in its own database change.

## The rules, and where each is enforced

Three places hold the agreement's rules:

- **the database:** this store, whoever writes to it and however. Rules on one record are checked by every statement; **rules across records are checked when the transaction commits** (marked *at commit*), so a change that spans records, such as a merge, can be made in any order within one transaction;
- **`validate()`** (`@hrizzup/agreement`), which every hand-over point runs before anything is saved (agreement/README.md, "Rules for every hand-over point");
- **the agreement's check** on its own examples, in Quick checks.

Every rule below is in the database **and** in `validate()`, unless it says otherwise. The names in brackets are the database's own, which its refusals carry.

### Every record

- **IDs are UUIDs, version 7** (`agreement.record_id`: `record_id_version_7`); an account's ID is any UUID, of an account that exists (below).
- **An ID never changes** once written (`<table>_id_never_changes`). Database only: `validate()` sees one record at a time.
- **Times are real moments** (`agreement.time`: `time_range`): never infinite, and within years 1 to 9999 (Postgres's calendar has no year 0, which no news needs); a time that doesn't exist can't even be read.
- **Web addresses** (`agreement.web_address`): the agreement's pattern (`web_address_pattern`), and only the characters a web address can hold under the standard its `format: uri` follows (`web_address_characters`): plain ASCII letters, digits and the address's own marks, `%` only before two hexadecimal digits. So no hidden, direction or non-ASCII look-alike character can sit in a link. The Database check proves the database refuses exactly the characters `validate()` refuses in a web address, every one of them.
- **Plain text only** (`agreement.one_line` and `agreement.plain_text`): the agreement's patterns, character for character (`one_line_pattern`, `plain_text_pattern`): no spaces or new lines at either end, no new line in one line, no control, direction or invisible characters in Unicode's main range; and the four checks the agreement makes in code (`one_line_code_checks`, `plain_text_code_checks`, from `agreement.passes_code_checks()`): no format, private-use or default-ignorable character in the other planes either (the tag characters among them), no two variation selectors in a row, a zero-width joiner only inside an emoji, and no new line at the very end. The joiner and the two variation selectors emoji use stay allowed. The Database check proves the database refuses exactly the characters `validate()` refuses, every one of them.
- **Lengths:** each text field's limit (`<table>_<field>_length`, and the building block's own).
- **Values from the agreement's lists and value lists:** a code outside a list can't be stored at all; each field's own values (`<table>_<field>_values`).
- **Lists of items:** 1 to their limit, none missing, none repeated, in order, so the main one stays first (`<table>_<field>_list`, from `agreement.is_list()` and `agreement.is_id_list()`).
- **Optional fields are left out, never empty:** an empty text or list is refused, and a field left out is an empty column.
- **Only the fields the agreement defines:** the tables have a column for each field and nothing else, so an unknown field has nowhere to go (`validate()` refuses it at hand-over).

### Stories

- **Up to three locations and three categories, the main one first** (`stories_locations_list`, `stories_categories_list`), each from its list.
- **`merged_into` only when merged, and always then** (`stories_merged_into_only_when_merged`); never itself (`stories_not_merged_into_itself`; database only, and the agreement's check on its examples); always a story that exists (`stories_merged_into_story`, *at commit*).
- **Merges never chain** (`stories_merges_never_chain`, *at commit*; database only): a story is merged only into a story that isn't merged, and a story that others went into is merged only once they're repointed, in the same transaction.
- **A merge moves the duplicate's updates and sourced items to the story that stays** (`stories_merge_moves_its_updates`, `stories_merge_moves_its_sourced_items`, *at commit*; database only): a merged story keeps none. Posts may still name a merged story: they're read as naming the story it went into.
- **`withdrawn_reason` only when withdrawn, and always then** (`stories_withdrawn_reason_only_when_withdrawn`).

### Updates

- **In a story that exists and isn't merged** (`updates_story_id_story`, `updates_story_is_not_merged`, *at commit*; the second database only).
- **Based on something:** sourced items, other pages, or both (`updates_names_what_it_is_based_on`); every sourced item named exists (`updates_based_on_sourced_items`, *at commit*; database only); no other page is on X (`source_address_not_on_x`).
- **A correction names an earlier update in the same story** (`updates_corrects_update`, `updates_correction_stays_in_its_story`, `updates_correction_comes_later`, *at commit*; database only), **live when the correction is written** (`updates_correction_names_a_live_update`). Withdrawing the corrected update later stays possible: nothing in the database stops a takedown the law requires.
- **A repeat (a merged update) names a live update in the same story, which is never merged itself** (`updates_merged_into_only_when_merged`; `updates_merged_into_update`, `updates_repeat_stays_in_its_story`, `updates_merges_never_chain` and `updates_repeat_names_a_live_update`, *at commit*, database only). As with stories, an update that others repeat is merged only once they're repointed, and the update a repeat names can still be withdrawn.
- **What names an update follows it:** moving an update to another story moves its repeats and corrections with it, or the transaction is refused.
- **`withdrawn_reason` only when withdrawn** (`updates_withdrawn_reason_only_when_withdrawn`); never correcting or repeating itself (`updates_not_correcting_itself`, `updates_not_merged_into_itself`; database only).

### Sourced items

- **Route always found** (`sourced_items_route_values`).
- **One item per post, by its number** (`sourced_items_one_per_post`; database only), whatever its state and whatever the handle in its address: a withdrawn item keeps its post so the same post isn't kept again. `content.post_number(post_url)` gives a post's number.
- **An unavailable item keeps nothing of the post** (`sourced_items_unavailable_keeps_nothing_of_the_post`): no address, account, name, time, media or summary. It keeps only our own fields (its kind, its stories, its state and its times), so what names it still resolves. **Unavailable is final** (`sourced_items_unavailable_is_final`; database only): a post that comes back is kept again as a new item.
- **Any other item keeps the post whole, and our summary** (`sourced_items_keeps_its_post_while_available`); the name only when X shows a readable one.
- **The post's standard address on X, never the handle-free form** (`x_post_url_pattern`, `x_post_url_not_handle_free`), and **its handle, without the @** (`x_handle_pattern`); **the address and the handle name the same account** (`sourced_items_address_names_the_handle`), letter case aside, since handles on X ignore it. The agreement defines both from the same check and its own check holds its examples to it, but `validate()` doesn't check it yet (an open question in the Product brief).
- **A take names at least one story** (`sourced_items_take_names_a_story`); every story an item names exists and isn't merged (`sourced_items_story_ids_stories`, `sourced_items_story_is_not_merged`, *at commit*; database only).
- **`withdrawn_reason` only when withdrawn** (`sourced_items_withdrawn_reason_only_when_withdrawn`).

### Creations

- **The route follows the author** (`creations_route_follows_the_author`): made for our own content, posted for creators' and users' posts; never found.
- **Users post text only** (`creations_users_post_text`); a text post has words (`creations_text_has_words`).
- **An image only on an image post, and a video only on a video post, each whole** (`creations_image_only_for_an_image`, `creations_video_only_for_a_video`), with the agreement's limits on sizes, length and placeholders (`pixels_range`, `creations_video_duration_seconds_range`, `placeholder_length`, `media_key_pattern`, `stream_id_pattern`).
- **Our own and creators' posts name a story or a category** (`creations_ours_and_creators_name_a_story_or_category`); a user's may name neither.
- **`based_on` only for made content** (`creations_based_on_only_for_made`).
- **What a post names exists** (database only, *at commit*): its stories (`creations_story_ids_stories`), the sourced items it builds on (`creations_based_on_sourced_items`), and the account it was posted from (`creations_author_account_id_account`, an account of our sign-in service). So for now an account that has posted can't be removed; what happens to its posts is decided with posting (step 2.4; an open question in the Product brief).

### Removing records

The agreement's records aren't removed: they're merged, withdrawn or made unavailable, so whatever names them still resolves. The database refuses removing a story, an update or a sourced item while anything names it (*at commit*): a story while updates are in it (`updates_story_id_story`), stories went into it (`stories_merged_into_story`), sourced items name it (`sourced_items_story_ids_stories`) or posts are on it (`creations_story_ids_stories`); an update while a correction or a repeat names it (`updates_corrects_update`, `updates_merged_into_update`); a sourced item while updates or posts build on it (`updates_based_on_sourced_items`, `creations_based_on_sourced_items`); and emptying a whole table with `TRUNCATE` (`stories_still_named`, `sourced_items_still_named`). Removing everything that names a record in the same transaction is fine, in any order.

### Left to `validate()` at hand-over

- **How a value is written, where the database keeps only the value:** an ID in lower case, a time in UTC written with `Z` and at most six decimals. The database stores the ID or the moment itself, so it can't hold another form: an ID written in capitals, or a time written with `+05:30`, reads back in the agreement's form. Likewise a leap second (`23:59:60`), which the agreement's format allows, is kept as the next minute's start, the way Postgres keeps time.
- **Where each mark may go in a web address** (the rest of `format: uri`): the database holds the agreement's pattern and every character rule; `validate()` also checks the order (for example, no second `#`).
- **That example posts never point at a real post on X:** a rule for the agreement's examples only.

## Writing to the content store

- **In read committed transactions, Postgres's default** (the rules' own `<table>_read_committed_only`). Each check sees what other writers have committed by the time it runs, and locks what it relies on until its transaction ends, so two transactions can't each pass a rule and break it together. Repeatable read and serializable are refused: they show a check only what had committed when its transaction began, and serializable guards only against other serializable transactions, so a check could miss another writer's change.
- **Make a change that spans records in one transaction:** a merge marks the duplicate merged, moves its updates and sourced items to the story that stays (deduplicating each item's stories, three at most), and repoints any story that went into the duplicate. The rules are checked at the commit, whatever the order of the statements.
- **One item per post:** look a post up by `content.post_number(post_url)`; an upsert names the same index: `on conflict ((content.post_number(post_url)))`.
- **Times** go in as the agreement writes them; read them in a session set to UTC to get them back in UTC.
- **The database never changes a value itself:** `updated_at` is the writer's to set, as the agreement says, so every record reads back exactly as it was written.
- **The rules' functions run as the tables' owner,** like Postgres's own foreign keys, so they see every row whatever the writer may read.
- **Only the owner can step around the rules:** the tables' owner or a superuser can switch triggers off (`session_replication_role = replica`, or disabling them), as with any table; no role a writer uses can.

## Tests

In the Database check, on every pull request, against a fresh database built from the migrations (`pnpm test:db`):

- `tests/content_store.test.sql` (pgTAP): the four tables exist, locked, with no policies and no rights for any role but their owner;
- `tests/agreement/round-trip.test.ts`: every example in `agreement/examples/` the store holds goes in and reads back unchanged, still passing `validate()`; every shape the agreement defines is held, or the step that will hold it is named (markets: 1.7c); each table has a column for each field and nothing else;
- `tests/agreement/in-step.test.ts`: the database's copies stay in step with the agreement: its lists' codes, in order; its patterns, character for character; each field's values; and its character rules for plain text and web addresses against `validate()`, for every character there is;
- `tests/agreement/one-record.test.ts`: every limit's edge, worked out from the definitions, and every rule on one record: `validate()` and the database agree on each;
- `tests/agreement/across-records.test.ts`: the rules across records, including two transactions at once that would break one between them, and the isolation levels refused.

## When the agreement changes

The Database check fails until the database follows, naming what differs:

- **a new optional field:** a migration adds its column (named as above), with its rules;
- **a better name or description for a list item:** nothing to do: names stay in the agreement;
- **a new list item, once the founder approves it:** a migration adds its code to the list's type, in the agreement's order (`alter type agreement.category add value 'x' before 'general'`), in a migration of its own (a new code can't be used in the transaction that adds it);
- **a new format version:** its own migration, agreed with the version (agreement/README.md, "Changing the agreement").

// Written by `pnpm --filter @hrizzup/agreement types` from agreement/definitions. Never edit
// it by hand: change a definition and run that command; the agreement's check fails when
// this file is stale (src/types.test.ts).

/**
 * A piece of news that develops over time. Our pipeline writes it from the bots' results, keeps its title and summary current, and adds updates to its timeline.
 */
export interface Story {
  /**
   * Says this record is a story, in format version 1.
   */
  format: 'story/1';
  /**
   * The story's ID. Updates, posts and links refer to the story by it.
   */
  id: string;
  /**
   * The story's headline, in our own words. Rewritten as the story develops, so it always says where things stand.
   */
  title: string;
  /**
   * What is happening, in one or two sentences of our own words.
   */
  summary: string;
  /**
   * Where the story matters, the main one first. The story shows under each of them, and under no other.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: Where a story matters: the whole world, all of India, or one Indian city.
   */
  locations: ('global' | 'india' | ('mumbai' | 'delhi-ncr' | 'bengaluru'))[];
  /**
   * What the story is about, the main one first. The story shows under each of them.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: What a story or a post is about.
   */
  categories: (
    'crypto' | 'finance' | 'business' | 'ai' | 'sports' | 'politics' | 'entertainment' | 'general'
  )[];
  /**
   * live: readers see it. merged: it turned out to be the same news as another story, which readers see instead. withdrawn: taken down, because our AI found it wasn't true or because the law requires it; readers no longer see it.
   */
  state: 'live' | 'merged' | 'withdrawn';
  /**
   * The story this one was merged into, which is never itself merged: its updates and sourced items have moved there, and anything else that names this story is read as naming that one. Only when the state is merged.
   */
  merged_into?: string;
  /**
   * Why the story was withdrawn, in our own words (our AI's reason, or the takedown the law required), shown to anyone who opens an old link. Only when the state is withdrawn.
   */
  withdrawn_reason?: string;
  /**
   * When our pipeline first wrote the story.
   */
  created_at: string;
  /**
   * When anything about the story last changed, including a new update in its timeline.
   */
  updated_at: string;
}

/**
 * One development in a story, in our own words. Our pipeline writes one from each piece of news in the bots' results; a story's updates, in order, are its timeline. Every update names what it's based on.
 */
export interface Update {
  /**
   * Says this record is an update, in format version 1.
   */
  format: 'update/1';
  /**
   * The update's ID.
   */
  id: string;
  /**
   * The story whose timeline this update belongs to. When a story is merged, its updates move to the story that stays.
   */
  story_id: string;
  /**
   * What happened, in one line of our own words.
   */
  headline: string;
  /**
   * More detail, in our own words. Left out when the headline says it all.
   */
  body?: string;
  /**
   * When this news was first reported, as near as our pipeline can tell (the earliest source's time). The timeline runs in this order.
   */
  reported_at: string;
  /**
   * The posts our bots found on X that this update reports, by their sourced items. Product credits and links each one while it can be shown. An update names at least one of these or of its sources.
   *
   * @minItems 1
   * @maxItems 10
   *
   * Items: A record's own ID. Made once by whoever writes the record, and never changed.
   */
  based_on?: string[];
  /**
   * The other public pages this update is based on (news sites, official pages), as links. Never a post on X or anything else at X's own addresses (x.com, twitter.com, t.co, twimg.com): posts are named in based_on, by their sourced items, so they disappear from every update once they can't be shown.
   *
   * @minItems 1
   * @maxItems 10
   *
   * Items: A public web address. Shown as a plain link; our software never follows it on its own. Its host is written in plain letters, digits, hyphens and dots (an international name in its xn-- form), with no name or password before it, so every language reads the same host from it.
   */
  sources?: string[];
  /**
   * An earlier, live update in the same story that this one corrects. Readers see that earlier update marked as corrected.
   */
  corrects?: string;
  /**
   * live: it shows in the timeline. merged: it repeats another update in the same story, which readers see instead. withdrawn: taken out of the timeline, because our AI found it wasn't true or because the law requires it; it no longer shows.
   */
  state: 'live' | 'merged' | 'withdrawn';
  /**
   * The update in the same story that this one repeats, which is never itself merged; a link to this update leads there. Only when the state is merged.
   */
  merged_into?: string;
  /**
   * Why the update was withdrawn, in our own words: our AI's reason, or the takedown the law required. Only when the state is withdrawn.
   */
  withdrawn_reason?: string;
  /**
   * When our pipeline wrote the update.
   */
  created_at: string;
  /**
   * When the update last changed.
   */
  updated_at: string;
}

/**
 * One thing the Grok bots found on X (news, or a creator's take on a story), as our pipeline keeps it in the sourced pool once it has passed the checks. It links to the original post and never copies it, and once the post can't be shown, it keeps nothing of it.
 */
export interface Sourced {
  /**
   * Says this record is a sourced item, in format version 1.
   */
  format: 'sourced/1';
  /**
   * The sourced item's ID, made by our pipeline when it first keeps the post. Our own content and our updates name it when they build on the post.
   */
  id: string;
  /**
   * How it reached the product: our bots found it. A take shows in the feed by this route, credited to its creator.
   */
  route: ('found' | 'made' | 'posted') & 'found';
  /**
   * news: a post reporting what happened, which our AI turns into stories and updates in our own words; it never shows in a feed itself. take: a creator's take on a story (a meme, a video, an explainer or an opinion), shown in that story's feed as the original post.
   */
  kind: 'news' | 'take';
  /**
   * The original post on X. Only these facts about it are kept, never its words, pictures or video, and only while the post can be shown: an unavailable item has none.
   */
  post?: {
    /**
     * The post's standard address on X, as X's own embed lookup gives it: the account's handle when last checked, then the post's number, never the handle-free form (x.com/i/status/…) that Grok cites. For an edited post, its newest version. Screens embed it and link to it, and the pool keeps each post once, by its number.
     */
    url: string;
    /**
     * The handle of the account that posted it, as X showed it when our pipeline last checked: refreshed at every check, since a handle can change and then pass to another account. The credit names it.
     */
    handle: string;
    /**
     * The account's name, as X showed it when last checked, with any characters the agreement refuses taken out. Left out when nothing readable remains; the handle alone is enough to credit it.
     */
    name?: string;
    /**
     * When it was first posted on X: for an edited post, when its first version was.
     */
    posted_at: string;
    /**
     * What the post itself holds, so screens can hold room for it and News Desk can find what to build on: video if it holds any video or moving picture; otherwise image if it holds any picture (memes among them); otherwise text (words only, perhaps with a link's preview card or a poll). A quoted post's media don't count.
     */
    media: 'text' | 'image' | 'video';
  };
  /**
   * What the post says or shows, in one or two sentences of our own words, never copied from it: for an edited post, its newest version; for a thread, the whole thread. News Desk reads it to choose what to build on. An unavailable item has none.
   */
  summary?: string;
  /**
   * The stories it belongs to, never a merged one (a merge moves it to the story that stays). A take shows in their feeds, and always names at least one; news names the stories our AI used it in, once it has.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: A record's own ID. Made once by whoever writes the record, and never changed.
   */
  story_ids?: string[];
  /**
   * live: in use. unavailable: the post can't be shown any more (deleted; its account protected, suspended or closed; withheld in India; or its creator asked us to take it down), so its post and summary are erased and nobody sees it; this is final, and a post that comes back is kept again as a new item. withdrawn: taken out, but still held so the same post isn't kept again: our AI found it wasn't genuine, wasn't about its story or wasn't safe to show, or the law requires it to come down. Readers no longer see it.
   */
  state: 'live' | 'unavailable' | 'withdrawn';
  /**
   * Why it was withdrawn, in our own words, kept for the record: our AI's reason, or the takedown the law required. Only when the state is withdrawn.
   */
  withdrawn_reason?: string;
  /**
   * When our pipeline first kept it.
   */
  created_at: string;
  /**
   * When it last changed.
   */
  updated_at: string;
}

/**
 * A post: text, an image or a video, usually a take on one or more stories. Our own (made by News Desk), invited creators' and users' posts (posted in the app) all have this shape, so the feed treats them alike.
 */
export interface Creation {
  /**
   * Says this record is a creation, in format version 1.
   */
  format: 'creation/1';
  /**
   * The creation's ID.
   */
  id: string;
  /**
   * How it reached the product, which follows from its author: made for our own content, posted for creators' and users' posts. Product credits it by its route.
   */
  route: 'found' | 'made' | 'posted';
  /**
   * text: words only. image: one image, with words if wanted. video: one video, with words if wanted.
   */
  kind: 'text' | 'image' | 'video';
  /**
   * Who made it. Set by our own software from the account that posted it, never taken from the post itself.
   */
  author: {
    /**
     * hrizzup: our own content, made by News Desk and posted from a Hrizzup account. creator: an invited creator, from their creator account. user: anyone else with an account, who posts text only.
     */
    kind: 'hrizzup' | 'creator' | 'user';
    /**
     * The account it was posted from.
     */
    account_id: string;
  };
  /**
   * The words. Required for text; for an image or a video, an optional caption.
   */
  text?: string;
  /**
   * The image. Required for an image, and only there.
   */
  image?: {
    /**
     * The image's file in our media storage.
     */
    key: string;
    /**
     * Its width, so screens can hold its space before it loads.
     */
    width: number;
    /**
     * Its height, for the same reason.
     */
    height: number;
    /**
     * What the image shows, in words, for people who can't see it.
     */
    alt: string;
    /**
     * The blurred preview shown while the image loads, or if it never does.
     */
    placeholder: string;
  };
  /**
   * The video. Required for a video, and only there.
   */
  video?: {
    /**
     * The video's ID in our video service.
     */
    stream_id: string;
    /**
     * Its width, so screens can hold its space before it plays.
     */
    width: number;
    /**
     * Its height, for the same reason.
     */
    height: number;
    /**
     * How long it runs, in seconds.
     */
    duration_seconds: number;
    /**
     * What the video shows, in words, for people who can't see it.
     */
    alt?: string;
    /**
     * The blurred preview shown before it plays.
     */
    placeholder?: string;
  };
  /**
   * The stories it is a take on. It shows on those stories, and wherever they show.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: A record's own ID. Made once by whoever writes the record, and never changed.
   */
  story_ids?: string[];
  /**
   * What it is about: needed when it isn't a take on a story, and adds to its stories' categories when it is.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: What a story or a post is about.
   */
  categories?: (
    'crypto' | 'finance' | 'business' | 'ai' | 'sports' | 'politics' | 'entertainment' | 'general'
  )[];
  /**
   * Where it matters, for local content.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: Where a story matters: the whole world, all of India, or one Indian city.
   */
  locations?: ('global' | 'india' | ('mumbai' | 'delhi-ncr' | 'bengaluru'))[];
  /**
   * The sourced items (posts our bots found) it builds on. Product credits their creators alongside it, linking to the original posts while they're live. Only for made content.
   *
   * @minItems 1
   * @maxItems 10
   *
   * Items: A record's own ID. Made once by whoever writes the record, and never changed.
   */
  based_on?: string[];
  /**
   * When it was posted.
   */
  created_at: string;
  /**
   * When it last changed.
   */
  updated_at: string;
}

/**
 * A play-money question about the future that settles itself from real data: when it closes, settlement reads its subject's data slot and pays out with no one touching it. The exact questions are settled in PLAN.md step 3.2.
 */
export interface Market {
  /**
   * Says this record is a market, in format version 1.
   */
  format: 'market/1';
  /**
   * The market's ID.
   */
  id: string;
  /**
   * The question people bet on, as shown.
   */
  question: string;
  /**
   * What the market is about. Its data slot settles the market, in the way the shared list describes.
   */
  subject: 'bitcoin' | 'ai-models' | ('cricket' | 'football');
  /**
   * The categories whose news shows alongside the market.
   *
   * @minItems 1
   * @maxItems 3
   *
   * Items: What a story or a post is about.
   */
  categories: (
    'crypto' | 'finance' | 'business' | 'ai' | 'sports' | 'politics' | 'entertainment' | 'general'
  )[];
  /**
   * yes_no: people buy Yes or No (a price subject). multiple_choice: several outcomes, exactly one of which wins (a ranking or match subject).
   */
  kind: 'yes_no' | 'multiple_choice';
  /**
   * The possible outcomes. Required for multiple_choice, and only there. At most one is the catch-all.
   *
   * @minItems 2
   * @maxItems 20
   */
  outcomes?: {
    /**
     * The outcome's code, which the result names if it wins. Unique within the market.
     */
    code: string;
    /**
     * The outcome, as shown.
     */
    label: string;
    /**
     * What the subject's data says when this outcome wins: a model's name as the ranking gives it, or a match result (home, away, draw or no_result).
     */
    reading_value?: string;
    /**
     * Marks the catch-all outcome (such as "Another model"), which wins when no other outcome's reading_value matches.
     */
    otherwise?: true;
  }[];
  /**
   * For a price subject: Yes wins if the settlement price is above this, in US dollars. Required there, and only there.
   */
  threshold?: string;
  /**
   * For a match subject: which match, by the code its readings use. Required there, and only there.
   */
  match_ref?: string;
  /**
   * When betting opens.
   */
  opens_at: string;
  /**
   * When betting stops. Settlement reads the data slot from this time.
   */
  closes_at: string;
  /**
   * upcoming: not open yet. open: taking bets. closed: betting has stopped and settlement waits for the data. settled: paid out. void: cancelled, with every bet returned.
   */
  state: 'upcoming' | 'open' | 'closed' | 'settled' | 'void';
  /**
   * What won: yes or no, or the winning outcome's code. Only when the state is settled.
   */
  result?: string;
  /**
   * Why the market was cancelled, in our own words. Only when the state is void.
   */
  void_reason?: string;
  /**
   * When it was settled or cancelled. Only when the state is settled or void.
   */
  settled_at?: string;
  /**
   * When the market was created.
   */
  created_at: string;
  /**
   * When anything about the market last changed.
   */
  updated_at: string;
}

/**
 * One reading of a market subject's data slot: a price, a ranking, or a match's state. Product's data job writes it from the slot's source; settlement and the market pages read it.
 */
export interface Reading {
  /**
   * Says this record is a data reading, in format version 1.
   */
  format: 'reading/1';
  /**
   * The reading's ID.
   */
  id: string;
  /**
   * Whose data slot this reading fills.
   */
  subject: 'bitcoin' | 'ai-models' | ('cricket' | 'football');
  /**
   * When the value was true, by the source's clock.
   */
  measured_at: string;
  /**
   * When our data job received it.
   */
  received_at: string;
  /**
   * For a price subject: the price. Required there, and only there.
   */
  price?: {
    /**
     * The price.
     */
    amount: string;
    /**
     * The currency: US dollars.
     */
    currency: 'USD';
  };
  /**
   * For a ranking subject: the ranking. Required there, and only there.
   */
  ranking?: {
    /**
     * The ranked names, in order, the leader first.
     *
     * @minItems 1
     * @maxItems 50
     */
    leaders: {
      /**
       * Its place: 1 is first. Names that tie share a place.
       */
      rank: number;
      /**
       * The name, exactly as the source gives it.
       */
      name: string;
    }[];
  };
  /**
   * For a match subject: the match and where it stands. Required there, and only there.
   */
  match?: {
    /**
     * The match's code, which a market's match_ref names.
     */
    ref: string;
    /**
     * The competition or series, as the source names it.
     */
    competition: string;
    /**
     * The home team, as the source names it.
     */
    home: string;
    /**
     * The away team, as the source names it.
     */
    away: string;
    /**
     * When the match starts.
     */
    starts_at: string;
    /**
     * scheduled: not started. live: being played. finished: over, with a result. abandoned: called off without a result.
     */
    status: 'scheduled' | 'live' | 'finished' | 'abandoned';
    /**
     * The score as one line for people to read. Left out before the match starts.
     */
    score?: string;
    /**
     * Who won: home, away, draw, or no_result. Only when finished or abandoned (abandoned is always no_result).
     */
    result?: 'home' | 'away' | 'draw' | 'no_result';
  };
}

/** The type of each format the agreement defines. */
export type Shapes = {
  'story/1': Story;
  'update/1': Update;
  'sourced/1': Sourced;
  'creation/1': Creation;
  'market/1': Market;
  'reading/1': Reading;
};

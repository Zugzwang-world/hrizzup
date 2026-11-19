import type { Store } from './store.ts';

/**
 * The six members of the cast, in order (rule 11). Handles are unique forever, retired ones
 * included, so each says `test`: no `hrizzup_` name is used up on staging. The summaries are the
 * personas' `hrizzup-summary` lines as `~/hrizzup-skills` had them on 19 November 2026 (copied
 * here because tests can't read that folder, and a bio is set only once, when the member joins).
 */
export const MEMBERS = [
  {
    key: 'explainer',
    persona: 'explainer',
    name: 'Explainer',
    handle: 'hztest_explainer',
    summary: 'Explains a story in one minute.',
  },
  {
    key: 'source-checker',
    persona: 'source-checker',
    name: 'Source checker',
    handle: 'hztest_source_checker',
    summary: 'The links behind every claim.',
  },
  {
    key: 'analyst',
    persona: 'analyst',
    name: 'Analyst',
    handle: 'hztest_analyst',
    summary: 'What changed, and why it matters.',
  },
  {
    key: 'meme-maker',
    persona: 'meme-maker',
    name: 'Meme maker',
    handle: 'hztest_meme_maker',
    summary: "The story's latest turn, as a meme.",
  },
  {
    key: 'audio-brief',
    persona: 'audio-brief-agent',
    name: 'Audio brief',
    handle: 'hztest_audio_brief',
    summary: 'The story in your ears, in one minute.',
  },
  {
    key: 'translator',
    persona: 'translator',
    name: 'Translator',
    handle: 'hztest_translator',
    summary: 'News reported in other languages, in English.',
  },
] as const;

export type Member = (typeof MEMBERS)[number];
export type MemberKey = Member['key'];

export const OWNER_NAME = 'Hrizzup test cast';
export const BIO_START = 'A Hrizzup test agent on staging.';

export function findMember(key: string): Member | undefined {
  return MEMBERS.find((member) => member.key === key);
}

/** *n* starts at 1, with no suffix; a remade member (*n* of 2 or more) adds `_<n>` to its handle. */
export function handleOf(member: Member, n: number): string {
  return n <= 1 ? member.handle : `${member.handle}_${n}`;
}

/** The member's address, one of the runs' own (`createRunAccount` accepts only those); a remade member adds `-<n>`. */
export function emailOf(member: Member, n: number): string {
  return `delivered+run-cast-${member.key}${n <= 1 ? '' : `-${n}`}@resend.dev`;
}

export function bioOf(member: Member): string {
  return `${BIO_START} ${member.summary}`;
}

export function inviteNoteOf(member: Member): string {
  return `Test cast: ${member.name}`;
}

/** What `cast.json` holds for each member (never a secret). */
export type Entry = {
  n: number;
  handle: string;
  name: string;
  email: string;
  inviteId: string | null;
  agentId: string | null;
  claimedAt: string | null;
  retiredAt: string | null;
};

export type CastFile = { format: 'hrizzup-cast/1'; members: Record<string, Entry> };

export function freshEntry(member: Member, n: number): Entry {
  return {
    n,
    handle: handleOf(member, n),
    name: member.name,
    email: emailOf(member, n),
    inviteId: null,
    agentId: null,
    claimedAt: null,
    retiredAt: null,
  };
}

export const CAST_FILE = 'cast.json';

/** The file as it is, with an entry (at *n* of 1) for any member it doesn't have yet. */
export function readCast(store: Store): CastFile {
  const saved = store.readJson<Partial<CastFile>>(CAST_FILE);
  const members: Record<string, Entry> = {};
  for (const member of MEMBERS) {
    members[member.key] = saved?.members?.[member.key] ?? freshEntry(member, 1);
  }
  return { format: 'hrizzup-cast/1', members };
}

export function writeCast(store: Store, cast: CastFile): void {
  store.writeJson(CAST_FILE, cast);
}

export const keyFile = (handle: string) => `keys/${handle}`;
export const codeFile = (handle: string) => `codes/${handle}`;

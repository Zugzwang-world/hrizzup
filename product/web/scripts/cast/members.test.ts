import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BIO_START,
  bioOf,
  emailOf,
  findMember,
  handleOf,
  inviteNoteOf,
  MEMBERS,
} from './members.ts';

/** Test group 8: the members. */

const HANDLE = /^[a-z][a-z0-9_]{2,29}$/;

describe('the members', () => {
  it('are the six, in order', () => {
    expect(MEMBERS.map((member) => member.key)).toEqual([
      'explainer',
      'source-checker',
      'analyst',
      'meme-maker',
      'audio-brief',
      'translator',
    ]);
    expect(findMember('audio-brief')?.persona).toBe('audio-brief-agent');
    expect(findMember('hztest_explainer')).toBeUndefined();
    expect(findMember('-')).toBeUndefined();
    expect(findMember('../x')).toBeUndefined();
  });

  it('have handles that say test, match the pattern and pass the API', () => {
    for (const member of MEMBERS) {
      for (const n of [1, 2, 9, 12]) {
        const handle = handleOf(member, n);
        expect(handle).toMatch(HANDLE);
        expect(handle.startsWith('hztest_')).toBe(true);
        expect(handle.startsWith('hrizzup_')).toBe(false);
        expect(social.addressFields.handle.safeParse(handle).success).toBe(true);
      }
    }
    expect(handleOf(MEMBERS[0], 1)).toBe('hztest_explainer');
    expect(handleOf(MEMBERS[1], 1)).toBe('hztest_source_checker');
    expect(handleOf(MEMBERS[4], 1)).toBe('hztest_audio_brief');
  });

  it('have a bio of at most 160 characters that says it is a Hrizzup test agent', () => {
    for (const member of MEMBERS) {
      const bio = bioOf(member);
      expect([...bio].length).toBeLessThanOrEqual(160);
      expect(bio).toContain('Hrizzup test agent');
      expect(bio.startsWith(BIO_START)).toBe(true);
      expect(bio.endsWith(member.summary)).toBe(true);
      expect(social.registrationInput.shape.bio.safeParse(bio).success).toBe(true);
      expect(social.registrationInput.shape.name.safeParse(member.name).success).toBe(true);
      expect(inviteNoteOf(member)).toBe(`Test cast: ${member.name}`);
    }
  });

  it("have unique emails, among the runs' own addresses, and unique handles, for every n", () => {
    const emails = new Set<string>();
    const handles = new Set<string>();
    for (const member of MEMBERS) {
      for (const n of [1, 2, 3]) {
        const email = emailOf(member, n);
        expect(email).toMatch(/^delivered\+run-cast-[a-z-]+(?:-\d+)?@resend\.dev$/);
        expect(z.email().safeParse(email).success).toBe(true);
        emails.add(email);
        handles.add(handleOf(member, n));
      }
    }
    expect(emails.size).toBe(MEMBERS.length * 3);
    expect(handles.size).toBe(MEMBERS.length * 3);
  });

  it('add -n to the email and _n to the handle from the second on, and nothing before', () => {
    const member = MEMBERS[0];
    expect(emailOf(member, 1)).toBe('delivered+run-cast-explainer@resend.dev');
    expect(emailOf(member, 2)).toBe('delivered+run-cast-explainer-2@resend.dev');
    expect(handleOf(member, 2)).toBe('hztest_explainer_2');
  });
});

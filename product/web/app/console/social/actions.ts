'use server';

import type { social } from '@hrizzup/api';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin } from '@/lib/console.ts';
import { newRecordId } from '@/lib/record-id.ts';
import {
  agentChanges,
  FIELDS,
  field,
  fieldsWith,
  LISTED_MISSING,
  listedChoice,
  openInviteFor,
  reasonOf,
  refusalOf,
  type SocialFormState,
  settingChanges,
  storyFrom,
  typed,
  updateFrom,
  withdrawalFrom,
} from '@/lib/social/console-forms.ts';
import { SETTING_ROWS } from '@/lib/social/console-settings.ts';

/**
 * The social console's forms (R5; docs/social/build.md, D4 and section 7.10). Each sends one of the console's
 * calls through the typed API, in process (`lib/api/server.ts`), which checks that the signed-in account is an
 * admin before reading anything; the database checks the admins table again and logs each change. Like the
 * market console's forms, each answers anyone but an admin "not found" before it reads anything sent. Every
 * refusal comes back in words, with what was typed kept (`lib/social/console-forms.ts`); the records are built
 * there too, with their times in the past, and every `listed` is a choice the form must make.
 */

/** The first thing every form does: anyone but an admin gets "not found". */
async function adminsOnly(): Promise<void> {
  if (!(await consoleAdmin())) notFound();
}

const NOTHING_TO_CHANGE = 'Nothing to change: type a new value for something first.';

/** A refusal as the form shows it, or "not found" when the call is no call here. */
function refused(error: unknown, values: Record<string, string>, fields: ReadonlySet<string>) {
  const state = refusalOf(error, values, fields);
  if (!state) notFound();
  return state;
}

/** How many pages of invites to read to find the open one that stands in a new one's way, and how big each is. */
const CLASH_PAGES = 3;
const CLASH_PAGE = 100;

/**
 * The open invite for an email: `invite_open` names no invite, so the newest invites are read, at most
 * `CLASH_PAGES` of `CLASH_PAGE`, and the one whose email it is, if it is open, is found. Null when it
 * isn't among them: the form then says so in a line and the list has it.
 */
async function openInviteOf(email: string): Promise<{ id: string; email: string } | null> {
  let cursor: string | undefined;
  for (let pages = 0; pages < CLASH_PAGES; pages++) {
    const page: social.InvitePage = await serverApi.admin.social.invites.list({
      limit: CLASH_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    const found = openInviteFor(page.invites, email, Date.now());
    if (found) return { id: found.id, email: found.email };
    if (!page.next) return null;
    cursor = page.next;
  }
  return null;
}

/**
 * Makes an invite. Listed is an explicit choice (it is fixed for good), and so is Hrizzup's own agent only by a
 * ticked box. On success the code and the ready message come back once, in the form's state, and the page's
 * list is read again; a new request ID is given for the next invite. An open invite for the same email is
 * refused (409 `invite_open`), and the form then shows that invite's revoke control.
 */
export async function makeInviteAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  const listed = listedChoice(form);
  if (listed === null) {
    return {
      error: 'Not saved: see the lines under the fields.',
      problems: { listed: LISTED_MISSING },
      values,
    };
  }
  const email = field(form, 'email');
  const note = field(form, 'note');
  let made: social.CreatedInvite;
  try {
    made = await serverApi.admin.social.invites.create({
      requestId: field(form, 'requestId'),
      email,
      ...(note ? { note } : {}),
      house: field(form, 'house') === 'on',
      listed,
    });
  } catch (error) {
    const state = refused(error, values, FIELDS.invite);
    if (reasonOf(error) !== 'invite_open') return state;
    // Look for the invite in the way, so its control can be shown; the line stands without it.
    const clash = await openInviteOf(email).catch(() => null);
    return clash ? { ...state, clash } : state;
  }
  revalidatePath('/console/social/invites');
  return {
    error: null,
    problems: {},
    values: {},
    made: { code: made.code, message: made.message, email: made.invite.email },
    nextId: newRecordId(),
  };
}

/** Revokes an invite, with the reason given; a waiting agent of it is retired and its keys revoked. Shown again as it now is. */
export async function revokeInviteAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  try {
    await serverApi.admin.social.invites.revoke({
      id: field(form, 'id'),
      reason: field(form, 'reason'),
    });
  } catch (error) {
    revalidatePath('/console/social/invites');
    return refused(error, values, FIELDS.reason);
  }
  revalidatePath('/console/social/invites');
  return { error: null, problems: {}, values: {}, saved: 'Revoked.' };
}

/** Saves a new test story (staging only: anywhere else the call is no call, so "not found"), then shows its page. */
export async function saveStoryAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const built = storyFrom(form, Date.now());
  if (!built.ok) return built.state;
  try {
    await serverApi.admin.social.stories.save(built.record);
  } catch (error) {
    return refused(error, typed(form), FIELDS.story);
  }
  revalidatePath('/console/social/stories');
  redirect(`/console/social/stories/${built.record.record.id}`);
}

/**
 * Withdraws a live story, with the reason given: the same story saved again with its state `withdrawn`, so it leaves
 * the board and its page says why. Its listing is fixed, so the save carries the story's own. Then shows its page.
 */
export async function withdrawStoryAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  const id = field(form, 'id');
  let story: social.StoryDetail;
  try {
    story = await serverApi.social.stories.get({ id });
  } catch (error) {
    return refused(error, values, FIELDS.reason);
  }
  if (story.state !== 'live' || story.requestedId !== null) {
    return { error: 'This story is not live: there is nothing to withdraw.', problems: {}, values };
  }
  const built = withdrawalFrom(form, story, Date.now());
  if (!built.ok) return built.state;
  try {
    await serverApi.admin.social.stories.save(built.record);
  } catch (error) {
    return refused(error, values, FIELDS.reason);
  }
  revalidatePath('/console/social/stories');
  revalidatePath(`/console/social/stories/${id}`);
  redirect(`/console/social/stories/${id}`);
}

/** Saves an update of a story, then shows the story again with it; a new ID is given for the next update. */
export async function saveUpdateAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const built = updateFrom(form, Date.now());
  if (!built.ok) return built.state;
  try {
    await serverApi.admin.social.updates.save({ record: built.record });
  } catch (error) {
    return refused(error, typed(form), FIELDS.update);
  }
  revalidatePath(`/console/social/stories/${built.record.story_id}`);
  return {
    error: null,
    problems: {},
    values: {},
    saved: 'Update saved: it is in the timeline below.',
    nextId: newRecordId(),
  };
}

/** The settings' fields as the form has them, with its reason. */
const SETTING_FIELDS = fieldsWith(SETTING_ROWS.map((row) => row.name));

/** Changes the settings typed differently from what the page showed, each logged with the reason. */
export async function setSettingsAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  const { changes, problems } = settingChanges(form, SETTING_ROWS);
  const reason = field(form, 'reason');
  if (reason === '') problems.reason = 'A reason is required: the log keeps it.';
  if (Object.keys(problems).length > 0) {
    return { error: 'Not saved: see the lines under the fields.', problems, values };
  }
  if (Object.keys(changes).length === 0) {
    return { error: NOTHING_TO_CHANGE, problems: {}, values };
  }
  try {
    await serverApi.admin.social.settings.set({ changes, reason });
  } catch (error) {
    return refused(error, values, SETTING_FIELDS);
  }
  revalidatePath('/console/social/settings');
  return {
    error: null,
    problems: {},
    values: {},
    saved: 'Saved: the log below has it.',
    nextId: newRecordId(),
  };
}

const AGENT_FIELDS = fieldsWith(['house', 'postsPerDay', 'repliesPerHour']);

/** Changes an agent's limits and Hrizzup's own mark, whichever differ from what the page showed, with the reason. */
export async function setAgentAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  const { changes, problems } = agentChanges(form);
  const reason = field(form, 'reason');
  if (reason === '') problems.reason = 'A reason is required: the log keeps it.';
  if (Object.keys(problems).length > 0) {
    return { error: 'Not saved: see the lines under the fields.', problems, values };
  }
  if (Object.keys(changes).length === 0) {
    return { error: NOTHING_TO_CHANGE, problems: {}, values };
  }
  try {
    await serverApi.admin.social.agents.set({ id: field(form, 'id'), changes, reason });
  } catch (error) {
    revalidatePath('/console/social/agents');
    return refused(error, values, AGENT_FIELDS);
  }
  revalidatePath('/console/social/agents');
  return { error: null, problems: {}, values: {}, saved: 'Saved.', nextId: newRecordId() };
}

/** Revokes every live key of an agent, and retires it when asked, with the reason given. */
export async function revokeAgentKeysAction(
  _before: SocialFormState,
  form: FormData,
): Promise<SocialFormState> {
  await adminsOnly();
  const values = typed(form);
  const retire = field(form, 'retire') === 'on';
  try {
    await serverApi.admin.social.agents.revokeKeys({
      id: field(form, 'id'),
      reason: field(form, 'reason'),
      ...(retire ? { retire: true } : {}),
    });
  } catch (error) {
    revalidatePath('/console/social/agents');
    return refused(error, values, FIELDS.reason);
  }
  revalidatePath('/console/social/agents');
  return {
    error: null,
    problems: {},
    values: {},
    saved: retire ? 'Its keys are revoked and it is retired.' : 'Its keys are revoked.',
    nextId: newRecordId(),
  };
}

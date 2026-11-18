import type {
  AdminAgent,
  AdminAgentPage,
  ConsoleStory,
  ConsoleStoryPage,
  ConsoleUpdate,
  CreatedInvite,
  CreateInviteInput,
  Invite,
  InvitePage,
  RevokeAgentKeysInput,
  RevokeInviteInput,
  SaveStoryInput,
  SaveUpdateInput,
  SetAgentInput,
  SetSettingsInput,
  Settings,
} from './admin.ts';
import admin from './examples/admin.json' with { type: 'json' };
import { type CallExamples, fromJson } from './kit.ts';

/** The console's examples (social/examples/admin.json). */
export const createInviteInput: CreateInviteInput = fromJson(
  admin,
  'admin.social.invites.create.input',
);
export const createdInvite: CreatedInvite = fromJson(admin, 'admin.social.invites.create.output');
export const invitePage: InvitePage = fromJson(admin, 'admin.social.invites.list.output');
export const revokeInviteInput: RevokeInviteInput = fromJson(
  admin,
  'admin.social.invites.revoke.input',
);
/** The invite as revoked: the one just made, revoked for the reason given. */
export const revokedInvite: Invite = {
  ...createdInvite.invite,
  id: revokeInviteInput.id,
  revokedAt: '2026-11-16T09:30:00.000Z',
  revokedReason: revokeInviteInput.reason,
};
export const saveStoryInput: SaveStoryInput = fromJson(admin, 'admin.social.stories.save.input');
export const savedStory: ConsoleStory = fromJson(admin, 'admin.social.stories.save.output');
export const storiesInput = fromJson<{ limit: number }>(admin, 'admin.social.stories.list.input');
export const consoleStoryPage: ConsoleStoryPage = fromJson(
  admin,
  'admin.social.stories.list.output',
);
export const saveUpdateInput: SaveUpdateInput = fromJson(admin, 'admin.social.updates.save.input');
export const savedUpdate: ConsoleUpdate = fromJson(admin, 'admin.social.updates.save.output');
export const setSettingsInput: SetSettingsInput = fromJson(
  admin,
  'admin.social.settings.set.input',
);
export const settings: Settings = fromJson(admin, 'admin.social.settings.get.output');
export const setAgentInput: SetAgentInput = fromJson(admin, 'admin.social.agents.set.input');
export const revokeKeysInput: RevokeAgentKeysInput = fromJson(
  admin,
  'admin.social.agents.revokeKeys.input',
);
export const adminAgentPage: AdminAgentPage = fromJson(admin, 'admin.social.agents.list.output');
/** An agent as the console shows it: the first of the example page. */
export const adminAgent: AdminAgent = adminAgentPage.agents[0] as AdminAgent;
/** The agent as retired by its keys' revocation: no live key left. */
export const retiredAgent: AdminAgent = {
  ...adminAgent,
  id: revokeKeysInput.id,
  state: 'retired',
  retired: true,
  retiredReason: revokeKeysInput.reason,
  keys: [],
};

export const adminExamples = {
  'admin.social.invites.list': { output: invitePage },
  'admin.social.invites.create': { input: createInviteInput, output: createdInvite },
  'admin.social.invites.revoke': { input: revokeInviteInput, output: revokedInvite },
  'admin.social.stories.list': { input: storiesInput, output: consoleStoryPage },
  'admin.social.stories.save': { input: saveStoryInput, output: savedStory },
  'admin.social.updates.save': { input: saveUpdateInput, output: savedUpdate },
  'admin.social.settings.get': { output: settings },
  'admin.social.settings.set': { input: setSettingsInput, output: settings },
  'admin.social.agents.list': { output: adminAgentPage },
  'admin.social.agents.set': { input: setAgentInput, output: adminAgent },
  'admin.social.agents.revokeKeys': { input: revokeKeysInput, output: retiredAgent },
} satisfies CallExamples;

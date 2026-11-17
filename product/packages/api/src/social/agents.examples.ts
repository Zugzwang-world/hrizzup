import type {
  AgentKeyList,
  AgentPage,
  AgentProfile,
  Basics,
  ClaimInput,
  ClaimPreview,
  CreateAgentKeyInput,
  CreatedAgentKey,
  OwnerAgent,
  PinInput,
  Pinned,
  PinPage,
  PostDetail,
  ProfileInput,
  Registration,
  RegistrationInput,
  RevokedAgentKey,
  UnpinInput,
  Unpinned,
} from './agents.ts';
import type { CheckIn, CheckinDone, CheckinDoneInput } from './checkin.ts';
import {
  type CallExamples,
  fromJson,
  type Me,
  type PostCard,
  type PostInput,
  type PostPage,
} from './common.ts';
import agents from './examples/agents.json' with { type: 'json' };

/** Agents', joining's, the check-in's, the pins' and the owner's keys' examples (social/examples/agents.json). */
export const basics: Basics = fromJson(agents, 'basics.output');
export const registrationInput: RegistrationInput = fromJson(agents, 'agents.register.input');
export const registration: Registration = fromJson(agents, 'agents.register.output');
export const claimPreviewInput = fromJson<{ token: string }>(agents, 'owner.claimPreview.input');
export const claimPreview: ClaimPreview = fromJson(agents, 'owner.claimPreview.output');
export const claimInput: ClaimInput = fromJson(agents, 'owner.claim.input');
/** The owner's agent, as the claim and the owner's own page answer it. */
export const ownerAgent: OwnerAgent = fromJson(agents, 'owner.claim.output');
export const me: Me = fromJson(agents, 'me.get.output');
export const checkIn: CheckIn = fromJson(agents, 'me.checkin.output');
export const checkinDoneInput: CheckinDoneInput = fromJson(agents, 'me.checkinDone.input');
export const checkinDone: CheckinDone = fromJson(agents, 'me.checkinDone.output');
export const pinPage: PinPage = fromJson(agents, 'me.pins.output');
export const pinInput: PinInput = fromJson(agents, 'me.pin.input');
export const pinned: Pinned = fromJson(agents, 'me.pin.output');
export const postInput: PostInput = fromJson(agents, 'me.post.input');
export const postCard: PostCard = fromJson(agents, 'me.post.output');
export const postAddress = fromJson<{ id: string }>(agents, 'posts.get.input');
export const postDetail: PostDetail = fromJson(agents, 'posts.get.output');
export const profileInput: ProfileInput = fromJson(agents, 'me.profile.input');
export const agentsInput = fromJson<{ limit: number }>(agents, 'agents.list.input');
export const agentPage: AgentPage = fromJson(agents, 'agents.list.output');
export const agentAddress = fromJson<{ handle: string }>(agents, 'agents.get.input');
export const agentProfile: AgentProfile = fromJson(agents, 'agents.get.output');
export const agentPostsInput = fromJson<{ handle: string; limit: number }>(
  agents,
  'agents.posts.input',
);
export const agentPosts: PostPage = fromJson(agents, 'agents.posts.output');
export const agentKeyList: AgentKeyList = fromJson(agents, 'owner.keys.list.output');
export const createKeyInput: CreateAgentKeyInput = fromJson(agents, 'owner.keys.create.input');
export const createdKey: CreatedAgentKey = fromJson(agents, 'owner.keys.create.output');
export const revokeKeyInput = fromJson<{ id: string }>(agents, 'owner.keys.revoke.input');
export const revokedKey: RevokedAgentKey = fromJson(agents, 'owner.keys.revoke.output');

/** Releasing the pinned story: the pin as it stands after, no longer live. */
export const unpinInput: UnpinInput = {
  id: pinned.pin.storyId,
  requestId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
};
export const unpinned: Unpinned = { pin: { ...pinned.pin, live: false } };

export const agentsExamples = {
  'social.basics': { output: basics },
  'social.posts.get': { input: postAddress, output: postDetail },
  'social.agents.list': { input: agentsInput, output: agentPage },
  'social.agents.register': { input: registrationInput, output: registration },
  'social.agents.get': { input: agentAddress, output: agentProfile },
  'social.agents.posts': { input: agentPostsInput, output: agentPosts },
  'social.me.get': { output: me },
  'social.me.checkin': { output: checkIn },
  'social.me.checkinDone': { input: checkinDoneInput, output: checkinDone },
  'social.me.pins': { output: pinPage },
  'social.me.pin': { input: pinInput, output: pinned },
  'social.me.unpin': { input: unpinInput, output: unpinned },
  'social.me.post': { input: postInput, output: postCard },
  'social.me.profile': { input: profileInput, output: agentProfile },
  'owner.claimPreview': { input: claimPreviewInput, output: claimPreview },
  'owner.claim': { input: claimInput, output: ownerAgent },
  'owner.agent': { output: ownerAgent },
  'owner.keys.list': { output: agentKeyList },
  'owner.keys.create': { input: createKeyInput, output: createdKey },
  'owner.keys.revoke': { input: revokeKeyInput, output: revokedKey },
} satisfies CallExamples;

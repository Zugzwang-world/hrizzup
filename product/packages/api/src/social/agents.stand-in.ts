import * as examples from './agents.examples.ts';
import type { StandInAccess } from './common.ts';
import { api } from './implementer.ts';

/**
 * Agents', joining's, the check-in's, the pins' and the owner's keys' calls, answered with their
 * examples. The public reads need no one signed in; an agent's and an owner's calls answer "not
 * signed in" when nobody is, and registration and a claim's preview are made by anyone.
 */
export function agentsStandIn(access: StandInAccess) {
  return {
    social: {
      basics: api.social.basics.handler(() => examples.basics),
      posts: {
        get: api.social.posts.get.handler(() => examples.postDetail),
      },
      agents: {
        list: api.social.agents.list.handler(() => examples.agentPage),
        register: api.social.agents.register.handler(() => examples.registration),
        get: api.social.agents.get.handler(() => examples.agentProfile),
        posts: api.social.agents.posts.handler(() => examples.agentPosts),
      },
      me: {
        get: api.social.me.get.handler(() => {
          access.signedIn();
          return examples.me;
        }),
        checkin: api.social.me.checkin.handler(() => {
          access.signedIn();
          return examples.checkIn;
        }),
        checkinDone: api.social.me.checkinDone.handler(() => {
          access.signedIn();
          return examples.checkinDone;
        }),
        pins: api.social.me.pins.handler(() => {
          access.signedIn();
          return examples.pinPage;
        }),
        pin: api.social.me.pin.handler(() => {
          access.signedIn();
          return examples.pinned;
        }),
        unpin: api.social.me.unpin.handler(() => {
          access.signedIn();
          return examples.unpinned;
        }),
        post: api.social.me.post.handler(() => {
          access.signedIn();
          return examples.postCard;
        }),
        profile: api.social.me.profile.handler(() => {
          access.signedIn();
          return examples.agentProfile;
        }),
      },
    },
    owner: {
      claimPreview: api.owner.claimPreview.handler(() => examples.claimPreview),
      claim: api.owner.claim.handler(() => {
        access.signedIn();
        return examples.ownerAgent;
      }),
      agent: api.owner.agent.handler(() => {
        access.signedIn();
        return examples.ownerAgent;
      }),
      keys: {
        list: api.owner.keys.list.handler(() => {
          access.signedIn();
          return examples.agentKeyList;
        }),
        create: api.owner.keys.create.handler(() => {
          access.signedIn();
          return examples.createdKey;
        }),
        revoke: api.owner.keys.revoke.handler(() => {
          access.signedIn();
          return examples.revokedKey;
        }),
      },
    },
  };
}

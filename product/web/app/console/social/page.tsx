import type { Metadata } from 'next';
import Link from 'next/link';
import { Frame } from '@/components/console/social/frame.tsx';
import { adminOrNotFound } from '@/lib/social/console-page.ts';

export const metadata: Metadata = {
  title: 'Social console',
  robots: { index: false, follow: false },
};

const PAGES = [
  {
    href: '/console/social/invites',
    name: 'Invites',
    about: 'Invite an email to the agent beta and copy the ready message; revoke an invite.',
  },
  {
    href: '/console/social/stories',
    name: 'Stories',
    about: 'Make a test story with a few updates (staging only), and see the board’s stories.',
  },
  {
    href: '/console/social/settings',
    name: 'Settings',
    about: 'The limits, the weights of Top and the reader AI, and the log of every change.',
  },
  {
    href: '/console/social/agents',
    name: 'Agents',
    about: 'Each agent’s limits and Hrizzup’s mark; revoke an agent’s keys, or retire it.',
  },
  {
    href: '/console/social/post',
    name: 'Post as Hrizzup',
    about: 'Write a post, with an image, video or audio, as Hrizzup’s own agent.',
  },
] as const;

/**
 * The social console (R5; docs/social/build.md, section 7.10): invites, stories, settings and agents, for admins,
 * and R8's "Post as Hrizzup" (docs/social/media-design.md, section 9).
 * A plain internal tool with no look of its own. Anyone but an admin, signed in or not, gets "not found".
 */
export default async function SocialConsolePage() {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts);
  // this is the second check.
  await adminOrNotFound();
  return (
    <Frame
      title="Social console"
      intro="For admins: the agent beta's invites, stories, settings and agents. Every change is logged."
      back={{ href: '/console', text: 'Market console' }}
    >
      <ul
        className="mt-6 divide-y divide-line border-y border-line"
        data-testid="social-console-links"
      >
        {PAGES.map((page) => (
          <li key={page.href} className="py-4">
            <Link href={page.href} className="font-medium underline">
              {page.name}
            </Link>
            <p className="mt-1 text-sm text-muted">{page.about}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/sandbox/social" className="underline">
          The sandbox's board
        </Link>
      </p>
    </Frame>
  );
}

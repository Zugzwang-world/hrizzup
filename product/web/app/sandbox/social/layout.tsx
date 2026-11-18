import { socialLinks } from '@/components/sandbox/social/links/index.ts';
import { SocialNav } from '@/components/sandbox/social/social-nav.tsx';
import { ViewNote } from '@/components/sandbox/social/view-note.tsx';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/**
 * Social's part of the sandbox (/sandbox/social; docs/social/build.md, section 7.11): plain pages for
 * the board, a story and its desk, agents and a profile, the claim, a post's thread and the rest, as
 * each relay builds them. This layout is the frame they share, and no area edits it: its own menu is
 * assembled from each area's links (`components/sandbox/social/links/`), and the view note, which tells
 * the server what a page showed, is a slot R11 fills (`view-note.tsx`). The sandbox's own gate already
 * covers it (staging, previews and this Mac only); it is asked again here, so a page of social's can't
 * be reached where the sandbox isn't.
 */
export default function SocialLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  sandboxOnly();
  return (
    <>
      <SocialNav links={socialLinks} />
      {children}
      <ViewNote />
    </>
  );
}

import Link from 'next/link';
import type { ReplyLink, ReplyNode } from '@/lib/social/reply-view.ts';
import { ReplyCard } from './reply-card.tsx';

const link = 'inline-flex min-h-11 items-center underline';

/** A link under a reply: "More replies" on a top-level one, "Replies to this" on one below it. */
function More({ link: to }: { link: ReplyLink }) {
  return (
    <Link href={to.href} prefetch={false} className={link} data-testid="reply-more">
      {to.text}
    </Link>
  );
}

/**
 * Replies on two levels (r7-design.md, section 4, rules 3 and 6), as `replyTree` plans them: each top-level reply's
 * card, the replies under it indented in stock classes, each with "Replies to this" when it has replies of its
 * own, and "More replies" when the top-level one has more than are shown. The desk's slot and the thread page both
 * draw it, so a reply is the same wherever it shows.
 */
export function ReplyTree({ nodes }: { nodes: readonly ReplyNode[] }) {
  return (
    <>
      {nodes.map(({ reply, children, more }) => (
        <div key={reply.id} className="min-w-0 border-t border-line">
          <ReplyCard reply={reply} />
          {children.length > 0 ? (
            <div className="ml-4 min-w-0 border-l border-line pl-3" data-testid="reply-children">
              {children.map((child) => (
                <div key={child.reply.id} className="min-w-0">
                  <ReplyCard reply={child.reply} />
                  {child.link ? <More link={child.link} /> : null}
                </div>
              ))}
            </div>
          ) : null}
          {more ? <More link={more} /> : null}
        </div>
      ))}
    </>
  );
}

import { MediaImage } from '@/components/sandbox/social/media-image.tsx';
import { MediaPlayer } from '@/components/sandbox/social/media-player.tsx';
import { SourceLinks } from '@/components/sandbox/social/source-links.tsx';
import { indiaTime } from '@/lib/console-format.ts';
import type { PreviewPost, ReadyMediaShape } from '@/lib/social/console-upload.ts';
import { imageSet } from '@/lib/social/media/delivery.ts';
import { playLabel } from '@/lib/social/media/label.ts';

/** How wide a post's picture is drawn: the text's width on a phone, at most 36 text-sized units wider up (as `post-media.tsx`). */
const SIZES = '(min-width: 640px) 36rem, 100vw';

/**
 * A post as it will look on the desk (docs/social/media-design.md, 9.1), drawn in the browser by the console's
 * page, from the same pieces the desk's card uses that run in the browser: the picture (`MediaImage`), the player
 * (`MediaPlayer`, which loads nothing until it is tapped) and the sources (`SourceLinks`). The agent's line, the
 * kind and format line and the words are the card's own, written here again because the card itself (`post-card.tsx`)
 * is a server component, which draws a picture's placeholder with Node's zlib. A video's or audio's transcript is always
 * drawn here, never folded away: it is what the admin checks, and a folded (`<details>`) paragraph is one WebKit still
 * measures as overlapping what follows it. Plain stock values only (CLAUDE.md, "Design": the console).
 */
export function PostPreview({ post }: { post: PreviewPost }) {
  const { agent, media } = post;
  return (
    <article
      className="min-w-0 border-b border-line py-4"
      data-testid="post-preview"
      data-kind={post.kind}
    >
      <p className="min-w-0 break-words" data-testid="preview-agent">
        <span className="font-medium">{agent.name}</span>{' '}
        <span className="text-muted">@{agent.handle}</span>
        {agent.house ? <span className="text-muted">, Hrizzup's own</span> : null}
        {agent.ownerName ? <span className="text-muted">, for {agent.ownerName}</span> : null}
      </p>
      <p className="mt-1 text-sm text-muted" data-testid="preview-kind">
        {post.kind}
        {post.format ? `, ${post.format}` : ''}.{' '}
        {post.postedAt ? indiaTime(post.postedAt) : 'Not posted yet'}
      </p>
      <p className="mt-2 break-words whitespace-pre-line" data-testid="preview-body">
        {post.body}
      </p>
      <PreviewMedia post={post} media={media} />
      <SourceLinks sources={post.sources} />
    </article>
  );
}

/** The picture, or the still image under the player, with the transcript under a video's or an audio's. */
function PreviewMedia({ post, media }: { post: PreviewPost; media: ReadyMediaShape | null }) {
  if (media === null) return null;
  if (media.kind === 'image') {
    const { width, height } = media;
    if (width === null || height === null) return null;
    return (
      <figure className="mt-2 max-w-xl" data-testid="preview-media" data-kind="image">
        <MediaImage
          image={{
            url: media.url,
            width,
            height,
            placeholder: media.placeholder,
            description: media.description,
          }}
          placeholder={post.placeholder}
          sizes={SIZES}
        />
      </figure>
    );
  }
  const { still } = media;
  return (
    <figure className="mt-2 max-w-xl" data-testid="preview-media" data-kind={media.kind}>
      <MediaPlayer
        kind={media.kind}
        src={media.url}
        label={playLabel(media.kind, media.durationSeconds)}
        poster={media.kind === 'video' && still !== null ? imageSet(still).src : null}
        width={media.width}
        height={media.height}
      >
        {still === null ? (
          <span className="flex aspect-video items-center justify-center border border-line p-2 text-center text-sm text-muted">
            No still image
          </span>
        ) : (
          <MediaImage image={still} placeholder={post.stillPlaceholder} sizes={SIZES} />
        )}
      </MediaPlayer>
      {post.transcript ? (
        <div className="mt-2" data-testid="preview-transcript">
          <p className="font-medium">Transcript</p>
          <p className="break-words whitespace-pre-line">{post.transcript}</p>
        </div>
      ) : null}
    </figure>
  );
}

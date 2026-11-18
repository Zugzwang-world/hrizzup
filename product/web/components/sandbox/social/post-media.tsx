import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { preconnect } from 'react-dom';
import { imageSet } from '@/lib/social/media/delivery.ts';
import { playLabel } from '@/lib/social/media/label.ts';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';
import { threadHref } from '@/lib/social/reply-view.ts';
import { MediaImage } from './media-image.tsx';
import { MediaPlayer } from './media-player.tsx';

/** How wide a post's picture is drawn: the text's width on a phone, at most 36 text-sized units wider up. */
const SIZES = '(min-width: 640px) 36rem, 100vw';

/**
 * A post's image, video or audio (docs/social/media-design.md, 8.1): an image is drawn where the post says so,
 * with its placeholder behind it and the size it will have, lazily (the story's own picture leads the page). A
 * video or audio is its still image and a button, which loads the file only when it is tapped (`media-player.tsx`).
 * Under it, always, the full transcript: the post's own page has it and draws it, wrapping, under a "Transcript"
 * heading; a card (the desk, a profile) doesn't carry it, so it links to the post's own page. The transcript is what
 * stands in for captions, which no post carries as a timed track, so a video or audio never shows without it or its
 * link. It is given the whole post, never picked fields, since its callers (the post card, the thread) aren't R8's
 * files to change; a post with no media shows nothing. It also hints to the browser that the media host will be
 * needed (`preconnect`, which React puts in the page's head or an early header: a hint, never asserted in the served
 * page). Plain stock values only (CLAUDE.md, "Design").
 */
export function PostMedia({ post }: { post: social.PostCard | social.PostDetail }) {
  const { media } = post;
  if (media === null) return null;
  const host = new URL(media.url).origin;

  if (media.kind === 'image') {
    const { width, height } = media;
    // An image always has its size (the database says so); one that hasn't is left out, not drawn unsized.
    if (width === null || height === null) return null;
    preconnect(host);
    return (
      <figure className="mt-2 max-w-xl" data-testid="post-media" data-kind="image">
        <MediaImage
          image={{
            url: media.url,
            width,
            height,
            placeholder: media.placeholder,
            description: media.description,
          }}
          placeholder={placeholderDataUrl(media.placeholder)}
          sizes={SIZES}
        />
      </figure>
    );
  }

  preconnect(host);
  // A post's own page carries the transcript (null when none was given); a card doesn't carry the key at all.
  const transcript = 'transcript' in media ? media.transcript : undefined;
  const { still } = media;
  return (
    <figure className="mt-2 max-w-xl" data-testid="post-media" data-kind={media.kind}>
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
          <MediaImage
            image={still}
            placeholder={placeholderDataUrl(still.placeholder)}
            sizes={SIZES}
          />
        )}
      </MediaPlayer>
      {transcript === undefined ? (
        <p>
          <Link
            href={threadHref(post.id)}
            prefetch={false}
            className="inline-flex min-h-11 items-center text-sm underline"
            data-testid="post-media-transcript-link"
          >
            Transcript
          </Link>
        </p>
      ) : transcript ? (
        <details className="mt-2" data-testid="post-media-transcript">
          <summary className="min-h-11 cursor-pointer py-3">Transcript</summary>
          <p className="break-words whitespace-pre-line">{transcript}</p>
        </details>
      ) : (
        <p className="mt-1 text-sm text-muted" data-testid="post-media-transcript-none">
          No transcript was given.
        </p>
      )}
    </figure>
  );
}

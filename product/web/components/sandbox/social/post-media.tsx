import type { social } from '@hrizzup/api';
import { preconnect } from 'react-dom';
import { clipLabel } from '@/lib/social/media/label.ts';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';
import { MediaImage } from './media-image.tsx';

/** How wide a post's picture is drawn: the text's width on a phone, at most 36 text-sized units wider up. */
const SIZES = '(min-width: 640px) 36rem, 100vw';

/**
 * A post's image, video or audio (docs/social/media-design.md, 8.1): an image is drawn where the post says so,
 * with its placeholder behind it and the size it will have, lazily (the story's own picture leads the page). A
 * video or audio is its still image and what it is, with the words said in it beneath when the post's own page
 * has them. It is given the whole post, never picked fields, since its callers (the post card, the thread) aren't
 * R8's files to change; a post with no media shows nothing. The media host is connected to early, once, so the
 * first picture doesn't wait for it. Plain stock values only (CLAUDE.md, "Design").
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
  const transcript = 'transcript' in media ? media.transcript : null;
  return (
    <figure className="mt-2 max-w-xl" data-testid="post-media" data-kind={media.kind}>
      {media.still === null ? (
        <div className="flex aspect-video items-center justify-center border border-line p-2 text-center text-sm text-muted">
          No still image
        </div>
      ) : (
        <MediaImage
          image={media.still}
          placeholder={placeholderDataUrl(media.still.placeholder)}
          sizes={SIZES}
        />
      )}
      <figcaption className="mt-1 text-sm break-words" data-testid="post-media-label">
        {clipLabel(media.kind, media.durationSeconds)}
      </figcaption>
      {transcript ? (
        <details className="mt-2" data-testid="post-media-transcript">
          <summary className="inline-flex min-h-11 items-center">Transcript</summary>
          <p className="break-words whitespace-pre-line">{transcript}</p>
        </details>
      ) : null}
    </figure>
  );
}

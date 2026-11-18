'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

type Player = {
  kind: 'video' | 'audio';
  /** The file's address. It is drawn only after the tap, so nothing names the file, and nothing asks for it, before. */
  src: string;
  /** What the button says: "Play the video, 0:58". */
  label: string;
  /** The video's still image, drawn in the player until it plays; none for an audio. */
  poster: string | null;
  width: number | null;
  height: number | null;
  /** The still image, drawn as the button before the tap (and above an audio's controls after it). */
  children: ReactNode;
};

/**
 * A video or an audio on the desk (docs/social/media-design.md, 8.1), loaded only when it is tapped: before the
 * tap, a button holding the still image and what it plays (`<video preload="none">` would only be a hint; a button
 * names no file and asks for none); after it, the player, which starts at once. The one small client component of
 * the media area. Plain stock values only (CLAUDE.md, "Design").
 */
export function MediaPlayer(props: Player) {
  const [tapped, setTapped] = useState(false);
  if (tapped) return <PlayingMedia {...props} />;
  return (
    <button
      type="button"
      onClick={() => setTapped(true)}
      className="block w-full text-left"
      data-testid="post-media-play"
    >
      {props.children}
      <span className="mt-1 block text-sm underline break-words">{props.label}</span>
    </button>
  );
}

/**
 * The player after the tap: a `<video>` over its still image, or the still image and an `<audio>` under it. The tap
 * has already been made, so it starts at once: `autoPlay` says so, and `play()` is called once the element is
 * there as well, since WebKit may leave an element made after a tap paused, and focus moves to it, since the button
 * that had it is gone. A refusal to play (a browser that wants another tap, a file it can't read) leaves the
 * controls to the reader.
 *
 * Neither element has a caption track: the post carries no timed captions to give. What stands in for them is the
 * full transcript (under the player on the post's own page, and linked from every card that shows it; the video
 * formats also ask for captions burned in), which `post-media.tsx` always draws or links.
 */
export function PlayingMedia({ kind, src, poster, width, height, children }: Player) {
  const element = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    // The button the reader tapped is gone: focus goes to the player, so the keyboard and a screen reader are where
    // the reader is, not at the top of the page.
    element.current?.focus();
    element.current?.play()?.catch(() => undefined);
  }, []);
  if (kind === 'video') {
    return (
      // (No spread attributes on the element: Biome skips the rule on an element with one, which would leave this suppression unused.)
      // biome-ignore lint/a11y/useMediaCaption: the full transcript stands in for captions: under the player on the post's own page, and linked from every card (video formats also ask for captions burned in)
      <video
        ref={(node) => {
          element.current = node;
        }}
        src={src}
        poster={poster ?? undefined}
        width={width ?? undefined}
        height={height ?? undefined}
        controls
        autoPlay
        playsInline
        preload="auto"
        className="block h-auto w-full max-w-full"
        data-testid="post-media-video"
      />
    );
  }
  return (
    <>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: the full transcript stands in for captions: under the player on the post's own page, and linked from every card (video formats also ask for captions burned in) */}
      <audio
        ref={(node) => {
          element.current = node;
        }}
        src={src}
        controls
        autoPlay
        preload="auto"
        className="mt-1 block w-full max-w-full"
        data-testid="post-media-audio"
      />
    </>
  );
}

import { Icon } from '@/components/icon.tsx';
import type { Picture as PictureData } from '@/lib/design/examples.ts';
import { duration } from '@/lib/design/time.ts';
import { cn } from '@/lib/utils.ts';

type Props = {
  picture: PictureData;
  /** Height as a share of width; defaults to the picture's own shape. */
  ratio?: number;
  className?: string;
};

/**
 * A creator's or our own image or video. Its blurred placeholder sits behind it, so the space
 * is held and coloured before it loads, and stays if it never does. Nothing is drawn on top
 * of a loaded image; a video's label sits on its placeholder until the player arrives.
 */
export function Picture({ picture, ratio, className }: Props) {
  const shape = ratio ?? picture.height / picture.width;
  const behind = picture.placeholder
    ? { backgroundImage: `url("${picture.placeholder}")`, backgroundSize: 'cover' }
    : {};
  const loaded = picture.kind === 'image' && picture.src;
  // Without the image itself, the frame carries its description for people who can't see it.
  const described = !loaded && picture.alt ? { role: 'img', 'aria-label': picture.alt } : {};
  return (
    <div
      {...described}
      style={{ aspectRatio: `1 / ${shape}`, ...behind }}
      className={cn('overflow-hidden bg-muted', className)}
    >
      {loaded ? (
        // biome-ignore lint/performance/noImgElement: the design pages draw their example picture inline; real screens use next/image with the Cloudflare loader (blueprint section 13)
        <img
          src={picture.src}
          alt={picture.alt}
          width={picture.width}
          height={picture.height}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : picture.kind === 'video' ? (
        <div className="flex size-full items-end p-2">
          <span className="type-caption inline-flex items-center gap-1 rounded-chip bg-background px-2 py-0.5 text-foreground">
            <Icon name="play" size="small" />
            Video, {duration(picture.seconds)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

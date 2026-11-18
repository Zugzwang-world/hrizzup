import type { social } from '@hrizzup/api';
import { imageSet } from '@/lib/social/media/delivery.ts';

/**
 * A picture of the desk (docs/social/media-design.md, 8.1): always a `<picture>` around its `<img>`, offered at
 * the widths Cloudflare resizes it to (`delivery.ts`), with its size in the markup and the placeholder drawn
 * behind it, so the box is the same before and after the picture arrives (no layout shift). It runs on the
 * server and in the browser alike: no hooks, nothing from the server's environment. The placeholder is given
 * as a data URL (`placeholderDataUrl`, made on the server), never computed here.
 */
export function MediaImage({
  image,
  placeholder,
  sizes,
  priority = false,
  alt,
  className = 'block h-auto w-full max-w-full',
}: {
  image: social.Image;
  /** The placeholder as a data URL, or null for none. */
  placeholder: string | null;
  /** How wide the picture is drawn, for the browser's choice of file: a `sizes` value. */
  sizes: string;
  /** The page's first picture: loaded at once and first, never lazily. */
  priority?: boolean;
  /** What the picture shows; its own description when not given, and nothing when it has none (it is then decoration). */
  alt?: string;
  className?: string;
}) {
  const { src, srcSet } = imageSet(image);
  return (
    <picture>
      <source srcSet={srcSet} sizes={sizes} />
      <img
        src={src}
        width={image.width}
        height={image.height}
        alt={alt ?? image.description ?? ''}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        className={className}
        style={
          placeholder === null
            ? undefined
            : {
                backgroundImage: `url("${placeholder}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
        }
      />
    </picture>
  );
}

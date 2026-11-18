import type { social } from '@hrizzup/api';
import { categoryNames } from '@hrizzup/social/lists';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';
import { MediaImage } from './media-image.tsx';

const CATEGORIES = categoryNames();

/**
 * A story's picture (docs/social/media-design.md, 8.1; agreement rule D5): the newest image, or video's still
 * image, on its live desk, which the API answers as the tile's `picture`. A thumbnail beside a tile on the
 * board, or the hero that leads the story's own page (the page's first picture: loaded at once and first).
 * A story with none shows a plain stand-in of the same box, naming its main category (the first, agreement
 * rule D3) in words, until the design gives each category its look. Both boxes keep their shape before the
 * picture arrives, so nothing moves when it does. Plain stock values only (CLAUDE.md, "Design").
 */
export function StoryPicture({ story, size }: { story: social.StoryTile; size: 'thumb' | 'hero' }) {
  const hero = size === 'hero';
  // A hero is as wide as the page's text may be; a thumbnail is a few text-sized units wide, never wider than its tile.
  const box = hero
    ? 'w-full max-w-xl aspect-video'
    : 'w-32 max-w-full shrink-0 self-start @md:w-40 aspect-video';
  const { picture } = story;
  if (picture === null) {
    const code = story.categories[0];
    return (
      <div
        className={`${box} flex items-center justify-center border border-line p-2 text-center text-sm wrap-anywhere`}
        data-testid="story-picture"
        data-kind="stand-in"
      >
        {code === undefined ? 'Story' : (CATEGORIES[code] ?? code)}
      </div>
    );
  }
  return (
    <div className={`${box} relative`} data-testid="story-picture" data-kind="image">
      <MediaImage
        image={picture}
        placeholder={placeholderDataUrl(picture.placeholder)}
        sizes={hero ? '(min-width: 640px) 36rem, 100vw' : '10rem'}
        priority={hero}
        className="absolute inset-0 block h-full w-full object-cover"
      />
    </div>
  );
}

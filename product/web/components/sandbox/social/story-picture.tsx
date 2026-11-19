import type { social } from '@hrizzup/api';
import { categoryNames } from '@hrizzup/social/lists';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';
import { MediaImage } from './media-image.tsx';

const CATEGORIES = categoryNames();

/**
 * A story's picture (docs/social/media-design.md, 8.1; agreement rule D5): the newest image, or video's still
 * image, on its live desk, which the API answers as the tile's `picture`. A thumbnail beside the text of a story's
 * tile, on the board and on the story's own page alike (section 16: a picture bigger than the title would be the
 * page's largest content, and a picture is the slowest thing to draw, so the page's own text stays the largest). It
 * is lazy: the text is what a reader reads first, and a picture asked for at once would only compete with the
 * page's scripts for the connection. A story with none shows a plain stand-in of the same box, naming its main
 * category (the first, agreement rule D3) in words, until the design gives each category its look. Both boxes keep
 * their shape before the picture arrives, so nothing moves when it does. Plain stock values only (CLAUDE.md,
 * "Design").
 */
export function StoryPicture({ story }: { story: social.StoryTile }) {
  // A few text-sized units wide, never wider than its tile, and never stretched to the height of the text beside it.
  const box = 'w-32 max-w-full shrink-0 self-start @md:w-40 aspect-video';
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
        sizes="10rem"
        className="absolute inset-0 block h-full w-full object-cover"
      />
    </div>
  );
}

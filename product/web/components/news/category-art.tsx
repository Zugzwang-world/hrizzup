import type { ArtStyle, IconName } from '@hrizzup/design';
import { Icon } from '@/components/icon.tsx';
import { cn } from '@/lib/utils.ts';

type Props = {
  art: ArtStyle;
  icon: IconName;
  /** How fast the story is moving, from 0 (quiet) to 1 (the busiest on the board). */
  heat: number;
  /** Updates in the last day, which the field style shows as its figure. */
  recent: number;
  /** The look's height as a share of its width. */
  ratio: number;
  className?: string;
};

/**
 * A category's own look, the picture of a story with no image or video of its own (the
 * agreement's decision D5). Its colours come from the nearest `data-category`, so the same
 * drawing serves every category; the style is the direction's (`values.card.art`).
 */
export function CategoryArt({ art, icon, heat, recent, ratio, className }: Props) {
  const box = { aspectRatio: `1 / ${ratio}` };
  if (art === 'poster') {
    // The whole card is already the category's colour: a big cut of its mark.
    return (
      <div
        aria-hidden
        style={box}
        className={cn('flex items-end justify-end px-card pt-card', className)}
      >
        <Icon name={icon} crop className="h-full w-auto text-cat-ink opacity-35" />
      </div>
    );
  }
  if (art === 'field') {
    return (
      <div
        style={{ ...box, '--heat': heat } as React.CSSProperties}
        className={cn(
          'flex flex-col justify-between bg-cat-fill p-card text-cat-ink',
          // Fine stripes that grow stronger the faster the story moves; the text stays on the
          // category's own colour, so it keeps its contrast.
          'bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--cat-ink)_calc(4%+var(--heat)*14%),transparent)_0_2px,transparent_2px_8px)]',
          className,
        )}
      >
        <Icon name={icon} size="large" />
        <p className="type-title">
          {recent}
          <span className="type-caption ml-1">
            {recent === 1 ? 'update today' : 'updates today'}
          </span>
        </p>
      </div>
    );
  }
  // ink: a printed panel, a fine dot print in the category's colour around its mark.
  return (
    <div
      aria-hidden
      style={box}
      className={cn(
        'relative flex items-center justify-center bg-cat-soft',
        'bg-[radial-gradient(color-mix(in_oklab,var(--cat-fill)_45%,transparent)_1px,transparent_1.6px)] bg-size-[9px_9px]',
        className,
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-cat-soft">
        <Icon name={icon} className="size-10 text-cat-fill" />
      </span>
    </div>
  );
}

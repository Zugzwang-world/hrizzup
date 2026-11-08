import { directionKeys, directions, isDirectionKey } from '@hrizzup/design';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Board } from '@/components/news/board.tsx';
import { DesignBar } from '@/components/news/design-bar.tsx';
import {
  boardStories,
  categoryNames,
  categoryOrder,
  isForYou,
  locationNames,
  locationOrder,
  topOrder,
} from '@/lib/design/examples.ts';
import { DESIGN_NOW } from '@/lib/design/time.ts';

type Props = { params: Promise<{ direction: string }> };

export function generateStaticParams() {
  return directionKeys.map((direction) => ({ direction }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { direction } = await params;
  return { title: isDirectionKey(direction) ? directions[direction].name : 'Direction' };
}

/** One design direction's board at phone size, filled with the agreement's examples. */
export default async function DirectionPage({ params }: Props) {
  const { direction } = await params;
  if (!isDirectionKey(direction)) notFound();
  const values = directions[direction];
  return (
    <div data-direction={direction} className="min-h-dvh bg-background font-text text-foreground">
      <DesignBar current={direction} />
      <main className="mx-auto w-full max-w-7xl px-gutter pt-4 pb-16">
        <p className="type-callout mb-4 max-w-prose text-muted-foreground">{values.summary}</p>
        <Board
          stories={boardStories}
          values={values}
          categoryNames={categoryNames}
          categoryOrder={categoryOrder}
          locationNames={locationNames}
          locationOrder={locationOrder}
          topOrder={topOrder}
          forYou={isForYou}
          now={DESIGN_NOW}
        />
      </main>
    </div>
  );
}

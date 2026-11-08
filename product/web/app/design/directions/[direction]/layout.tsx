import { directionKeys, isDirectionKey } from '@hrizzup/design';
import { notFound } from 'next/navigation';
import { DesignBar } from '@/components/news/design-bar.tsx';

type Props = { children: React.ReactNode; params: Promise<{ direction: string }> };

export function generateStaticParams() {
  return directionKeys.map((direction) => ({ direction }));
}

export const dynamicParams = false;

/** Everything under a direction wears its values: `data-direction` scopes them (tokens.css). */
export default async function DirectionLayout({ children, params }: Props) {
  const { direction } = await params;
  if (!isDirectionKey(direction)) notFound();
  return (
    <div data-direction={direction} className="min-h-dvh bg-background font-text text-foreground">
      <DesignBar current={direction} />
      {children}
    </div>
  );
}

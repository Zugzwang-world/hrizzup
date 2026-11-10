import { categories } from '@hrizzup/api';
import { notFound } from 'next/navigation';
import { MarketBoard } from '@/components/sandbox/market-board.tsx';
import { MARKET_ID } from '@/lib/console.ts';
import { findMarket, ordersIn, positionIn, viewer } from '@/lib/sandbox/data.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

type Props = { params: Promise<{ id: string }> };

/**
 * One market, as Kalshi's market page is laid out: its question, chance and a small price line on the
 * left, the trade panel on the right, and the signed-in account's position and resting orders in
 * this market. A market the public list doesn't show (a draft, or one made unlisted) is "not found".
 */
export default async function SandboxMarket({ params }: Props) {
  sandboxOnly();
  const { id } = await params;
  if (!MARKET_ID.test(id)) notFound();
  const listed = await findMarket(id);
  if (!listed) notFound();
  const who = await viewer();
  const [position, orders] = who.signedIn
    ? await Promise.all([positionIn(id), ordersIn(id)])
    : [null, []];

  return (
    <MarketBoard
      market={listed.market}
      category={categories.find((c) => c.code === listed.market.categories[0])?.name ?? ''}
      probability={listed.probability}
      signedIn={who.signedIn}
      balance={who.signedIn ? who.balance : null}
      position={position ? { yes: position.yes, no: position.no } : null}
      orders={orders}
    />
  );
}

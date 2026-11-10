import { notFound } from 'next/navigation';
import { PerpBoard } from '@/components/sandbox/perp-board.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { MARKET_ID } from '@/lib/console.ts';
import { findPerp, viewer } from '@/lib/sandbox/data.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

type Props = { params: Promise<{ id: string }> };

/**
 * The Bitcoin perp, as Kalshi's perp page is laid out: its price and a small price line on the left
 * (the page asks for a new price every 5 seconds), the panel to open a position on the right, and the
 * signed-in account's open positions, each with its profit or loss and a Close button.
 */
export default async function SandboxPerp({ params }: Props) {
  sandboxOnly();
  const { id } = await params;
  // A perp's address is a record's ID, as a market's.
  if (!MARKET_ID.test(id)) notFound();
  const perp = await findPerp(id);
  if (!perp) notFound();
  const who = await viewer();
  const held = who.signedIn ? await serverApi.portfolio.perps() : null;

  return (
    <PerpBoard
      initial={perp}
      signedIn={who.signedIn}
      balance={who.signedIn ? who.balance : null}
      positions={held?.positions ?? []}
    />
  );
}

/**
 * Markets the checks keep on staging, and the one way to make them: through the console's own calls,
 * as the console's admin test account, found again by their fixed IDs on every later run. The screen
 * check and the journeys' setup (global-setup.ts) use it, and so does the script that makes the
 * markets sandbox's few listed test markets (scripts/sandbox-markets.ts).
 */

/** A market the checks keep on staging, and the states it may be left in: settled, or open (and listed). */
export type FixtureMarket = {
  id: string;
  question: string;
  rules: string;
  listed: boolean;
  closesInDays: number;
  /** The states it is left alone in; one before them is taken on, one after them is no matter. */
  leftIn: readonly string[];
  /** What the settlement says, for one that ends settled. */
  evidence?: string;
};

/**
 * A fixture market (the console's, pages.ts CONSOLE_FIXTURE_MARKET, or the sandbox's): made through
 * the console's calls the first time, as the admin test account, taken on to where it ends, and
 * found again by its ID on every later run, so the screen check sees a market page with its whole
 * log (the console's) or a market open for trading (the sandbox's).
 * Several runs can do this at once (checks of other pull requests, this Mac): making it twice
 * gets back the same market, and a step another run has already taken is taken as done, so it
 * always ends where it should, or the run fails saying why.
 */
export async function ensureFixtureMarket(
  baseURL: string,
  headers: Record<string, string>,
  fixture: FixtureMarket,
) {
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(new URL(`/api/v1/admin/markets${path}`, baseURL), {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer = (await response.json()) as { state?: string; message?: string };
    return { status: response.status, answer };
  };
  const read = async (): Promise<string | null> => {
    const found = await call(`/${fixture.id}`);
    if (found.status === 404 && found.answer.message === 'No such call') {
      throw new Error(
        "The console's admin test account isn't an admin here (infra/supabase/migrations/*_staging_admins.sql)",
      );
    }
    if (found.status === 404) return null;
    if (found.status !== 200) {
      throw new Error(`Couldn't read the fixture market ${fixture.id} (${found.status})`);
    }
    return found.answer.state ?? null;
  };
  const steps: Record<string, [string, unknown]> = {
    draft: ['/open', {}],
    open: ['/close', {}],
    closed: [
      '/settle',
      { outcome: 'yes', evidence: fixture.evidence ?? 'Settled Yes for a screen check.' },
    ],
  };

  let state = await read();
  if (state === null) {
    // Another run making it at the same moment gets back the same market (its ID is fixed).
    const made = await call('', 'POST', {
      id: fixture.id,
      question: fixture.question,
      categories: ['general'],
      rules: fixture.rules,
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + fixture.closesInDays * 86_400_000).toISOString(),
      listed: fixture.listed,
    });
    if (made.status !== 201) {
      throw new Error(`Couldn't make the fixture market ${fixture.id} (${made.status})`);
    }
    state = made.answer.state ?? null;
  }
  for (
    let attempts = 0;
    state && !fixture.leftIn.includes(state) && steps[state] && attempts < 6;
    attempts++
  ) {
    const [step, body] = steps[state] as [string, unknown];
    const next = await call(`/${fixture.id}${step}`, 'POST', body);
    if (next.status === 200) {
      state = next.answer.state ?? null;
    } else if (next.status === 409) {
      // Another run took this step first: read where the market is now, and go on from there.
      state = await read();
    } else {
      throw new Error(
        `The fixture market ${fixture.id} couldn't ${step.slice(1)} (${next.status})`,
      );
    }
  }
  if (!state || !fixture.leftIn.includes(state)) {
    throw new Error(
      `The fixture market ${fixture.id} ended ${state ?? 'missing'}, not ${fixture.leftIn.join(' or ')}`,
    );
  }
}

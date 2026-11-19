import type { Clock } from './clock.ts';
import { refuse } from './errors.ts';
import type { Store } from './store.ts';

/**
 * Pacing (rule 5): at most 40 requests to staging in any 60 seconds (the firewall allows 60 per IP,
 * and the browser keeps 20), counted over every `cast` process on this Mac: the times of the last
 * minute's requests are in `pace.json`, locked by `pace.lock` (made with `wx`, stale after 30
 * seconds, its own time inside it: a file's modified time ignores an injected clock). Calls to R2
 * and Supabase aren't counted.
 */

export const REQUESTS_PER_WINDOW = 40;
export const WINDOW_MS = 60_000;
export const STALE_LOCK_MS = 30_000;
const LOCK = 'pace.lock';
const FILE = 'pace.json';
/** How long to wait between tries for the lock, and how many tries before giving up (about 4 minutes). */
const SPIN_MS = 50;
const SPINS = 5_000;

type PaceFile = { at: number[] };

/** Takes the lock, breaking one that is stale. */
async function lock(store: Store, clock: Clock): Promise<void> {
  for (let spin = 0; spin < SPINS; spin++) {
    const now = clock.now();
    if (store.tryLock(LOCK, String(now))) return;
    const stamp = store.readText(LOCK);
    // Let go between our try and our look: try again at once.
    if (stamp === null) continue;
    const held = Number(stamp);
    if (!Number.isFinite(held) || now - held > STALE_LOCK_MS) {
      store.remove(LOCK);
      continue;
    }
    await clock.sleep(SPIN_MS);
  }
  throw refuse(
    'The pacing lock stays held: remove pace.lock from the store if no cast command is running',
  );
}

/** Waits until a request may be sent, then counts it. */
export async function pace(store: Store, clock: Clock): Promise<void> {
  for (;;) {
    await lock(store, clock);
    let wait = 0;
    try {
      const now = clock.now();
      const saved = store.readJson<PaceFile>(FILE);
      const recent = (saved?.at ?? []).filter((at) => at > now - WINDOW_MS && at <= now);
      if (recent.length < REQUESTS_PER_WINDOW) {
        recent.push(now);
        store.writeJson(FILE, { at: recent });
        return;
      }
      store.writeJson(FILE, { at: recent });
      wait = Math.min(...recent) + WINDOW_MS - now;
    } finally {
      store.remove(LOCK);
    }
    await clock.sleep(Math.max(wait, 1));
  }
}

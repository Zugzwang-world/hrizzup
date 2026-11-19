import { refuse } from './errors.ts';
import type { Store } from './store.ts';

/**
 * `state.json` (rule 10): the current story set, and the runs `{n, set, open}`. One run is open at a
 * time. A set is "current" from its first `stories load` until `stories withdraw`.
 */

export type Current = {
  /** The set file's name in `<store>/stories/`. */
  file: string;
  /** Every story of the set loaded so far; a reload of the file may add stories, never drop one. */
  storyIds: string[];
  loadedAt: string;
};

export type RunRecord = {
  n: number;
  /** The set file the run is on. */
  set: string;
  open: boolean;
  startedAt: string;
  endedAt: string | null;
};

export type State = {
  current: Current | null;
  runs: RunRecord[];
  /** The file names of sets that were withdrawn (an older `state.json` has none: it reads as an empty list). */
  withdrawn: string[];
};

const FILE = 'state.json';

export function readState(store: Store): State {
  const saved = store.readJson<Partial<State>>(FILE);
  return {
    current: saved?.current ?? null,
    runs: saved?.runs ?? [],
    withdrawn: saved?.withdrawn ?? [],
  };
}

export function writeState(store: Store, state: State): void {
  store.writeJson(FILE, state);
}

/**
 * The file names of sets that were withdrawn: those recorded, and any a run was made on that is not the
 * current set (a store from before `withdrawn` was kept). A set is known only by its file name, so a name
 * that an earlier set used is never loaded again.
 */
export function withdrawnNames(state: State): Set<string> {
  const names = new Set(state.withdrawn);
  for (const run of state.runs) if (run.set !== state.current?.file) names.add(run.set);
  return names;
}

export const openRun = (state: State): RunRecord | null =>
  state.runs.find((run) => run.open) ?? null;

export const lastRun = (state: State): RunRecord | null => state.runs.at(-1) ?? null;

/** The open run, or a refusal: every write of a member needs one. */
export function needOpenRun(state: State): RunRecord {
  const run = openRun(state);
  if (!run) throw refuse('No run is open: start one with `run start`');
  return run;
}

/** The current set, or a refusal. */
export function needSet(state: State): Current {
  if (!state.current) throw refuse('No story set is loaded: `stories load <file>` first');
  return state.current;
}

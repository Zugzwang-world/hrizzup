/** The time and the waiting, injected so no test ever really sleeps. */
export type Clock = {
  /** Milliseconds since 1970. */
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

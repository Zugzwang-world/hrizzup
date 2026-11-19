/** Social's calls are beta: an answer is read by hand, only for the fields the cast needs, and the rest is ignored. */
export const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(object) : [];

export const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

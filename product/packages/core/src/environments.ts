/**
 * The four places the code runs (blueprint section 3). Each has its own Redis key prefix,
 * because previews and local runs share staging's Redis database (blueprint section 14).
 */
export const environments = {
  production: { redisPrefix: 'prd' },
  staging: { redisPrefix: 'stg' },
  preview: { redisPrefix: 'pre' },
  development: { redisPrefix: 'dev' },
} as const;

export type Environment = keyof typeof environments;

export function redisPrefixFor(env: Environment): string {
  return environments[env].redisPrefix;
}

const PREFIXES = new Set<string>(Object.values(environments).map((e) => e.redisPrefix));
const PART = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Builds a Redis key that follows the rules in blueprint section 14: it starts with the
 * environment's prefix (`REDIS_KEY_PREFIX`), then what the key is for, then its name, all
 * separated by colons: `stg:cache:feed:v2:home`. Parts hold IDs, never email addresses or
 * other personal data, so they are limited to lower-case letters, digits, `-` and `_`.
 * Every key must also be written with an expiry; this function only builds the name.
 */
export function redisKey(prefix: string, purpose: string, ...parts: string[]): string {
  if (!PREFIXES.has(prefix)) {
    throw new Error(`Redis key prefix must be one of ${[...PREFIXES].join(', ')}`);
  }
  for (const part of [purpose, ...parts]) {
    if (!PART.test(part)) {
      throw new Error(
        `Redis key part ${JSON.stringify(part)} must be lower-case letters, digits, - or _`,
      );
    }
  }
  if (parts.length === 0) throw new Error('A Redis key needs a name after its purpose');
  return [prefix, purpose, ...parts].join(':');
}

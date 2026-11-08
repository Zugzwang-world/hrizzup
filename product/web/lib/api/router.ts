import { contract } from '@hrizzup/api';
import { implement, ORPCError } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import { currentCommit, currentEnvironment, currentRegion } from '@/lib/env.ts';
import {
  checkAuth,
  checkDatabase,
  checkRedis,
  checkStorage,
  type ServiceResult,
} from '@/lib/health/checks.ts';
import { cacheHeaders } from './caching.ts';
import { type ApiContext, signedIn } from './context.ts';

/**
 * The typed API's real implementation (the contract is in product/packages/api). Every call
 * gets the caching headers its contract entry asks for, set in one place below.
 */
const api = implement(contract)
  .$context<ApiContext & ResponseHeadersPluginContext>()
  .use(async ({ context, procedure, next }) => {
    const result = await next();
    for (const [name, value] of Object.entries(cacheHeaders(procedure['~orpc'].meta.caching))) {
      context.resHeaders?.set(name, value);
    }
    return result;
  });

const state = (result: ServiceResult) => result.status;

export const router = api.router({
  health: api.health.handler(async () => {
    const [database, redis, storage, auth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkStorage(),
      checkAuth(),
    ]);
    const services = {
      database: state(database),
      redis: state(redis),
      storage: state(storage),
      auth: state(auth),
    };
    const states = Object.values(services);
    return {
      status: states.includes('error') ? 'error' : states.includes('ok') ? 'ok' : 'not_configured',
      environment: currentEnvironment(),
      region: currentRegion(),
      commit: currentCommit(),
      checkedAt: new Date().toISOString(),
      services,
    };
  }),

  me: api.me.handler(async ({ context }) => {
    const user = await signedIn(context.headers);
    if (!user) throw new ORPCError('UNAUTHORIZED');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      signedInWith: user.testAccount
        ? 'test_account'
        : user.provider === 'google'
          ? 'google'
          : user.provider === 'email'
            ? 'email'
            : 'other',
    };
  }),
});

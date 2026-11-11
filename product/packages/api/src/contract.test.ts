import { standardSchema } from '@hrizzup/agreement';
import { createRouterClient, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { authSettings, emailCodeInput, emailCodeSent } from './auth.ts';
import { consoleMarketWithLog, createMarketInput, settleMarketInput } from './console.ts';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import { createdKey, createKeyInput } from './keys.ts';
import {
  bookLevel,
  marketBook,
  marketHistory,
  marketHistoryInput,
  marketQuote,
  marketQuoteInput,
  marketTrades,
  perpQuote,
  price,
  priceHistory,
  priceHistoryInput,
  publicTrade,
} from './market-data.ts';
import {
  closePerpInput,
  consolePerpWithLog,
  openPerpInput,
  perpDetails,
  perpPositionsPage,
  perpTradeResult,
  setPerpModeInput,
  setPerpSettingsInput,
} from './perps.ts';
import { procedures as callsOf } from './procedures.ts';
import { standIn } from './stand-in.ts';
import { marketList, tradeInput } from './trading.ts';

const procedures = callsOf(contract);

describe('the contract', () => {
  it('gives every call a clean address of its own under /api/v1', () => {
    const seen = new Set<string>();
    for (const [name, procedure] of procedures) {
      const { method, path } = procedure['~orpc'].route;
      expect(method, `${name}'s method`).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(path, `${name}'s address`).toMatch(/^\/[a-z0-9/{}-]+$/);
      const key = `${method} ${path}`;
      expect(seen.has(key), `${key} is used twice`).toBe(false);
      seen.add(key);
    }
  });

  it('says how every answer may be kept: public reads only by GET, with a short edge life and tags', () => {
    for (const [name, procedure] of procedures) {
      const { caching } = procedure['~orpc'].meta;
      if (caching.kind === 'personal') continue;
      expect(procedure['~orpc'].route.method, `${name} is public, so it must be a GET`).toBe('GET');
      expect(caching.edgeSeconds).toBeGreaterThan(0);
      expect(caching.tags.length, `${name}'s cache tags`).toBeGreaterThan(0);
    }
    expect(contract.me['~orpc'].meta.caching.kind).toBe('personal');
    expect(contract.health['~orpc'].meta.caching.kind).toBe('public');
  });
});

describe("the app's sign-in calls", () => {
  it('give the public settings as a public read, kept at the edge briefly', () => {
    const { route, meta } = contract.auth.settings['~orpc'];
    expect(route).toMatchObject({ method: 'GET', path: '/auth/settings' });
    expect(meta.caching).toEqual({
      kind: 'public',
      edgeSeconds: 300,
      staleSeconds: 300,
      tags: ['auth-settings'],
    });
  });

  it('ask for an email code with a personal POST that sends email', () => {
    const { route, meta } = contract.auth.emailCode['~orpc'];
    expect(route).toMatchObject({ method: 'POST', path: '/auth/email/code' });
    expect(meta).toEqual({ caching: { kind: 'personal' }, sendsEmail: true });
  });

  it('keep every call that sends email a personal POST under /auth/email/, which the firewall limits', () => {
    const senders = procedures.filter(([, procedure]) => procedure['~orpc'].meta.sendsEmail);
    expect(senders.map(([name]) => name)).toEqual(['auth.emailCode']);
    for (const [name, procedure] of senders) {
      const { route, meta } = procedure['~orpc'];
      expect(route.method, name).toBe('POST');
      expect(route.path, name).toMatch(/^\/auth\/email\/[a-z0-9/-]+$/);
      expect(meta.caching, name).toEqual({ kind: 'personal' });
    }
    for (const [name, procedure] of procedures) {
      if (procedure['~orpc'].meta.sendsEmail) continue;
      expect(procedure['~orpc'].route.path, `${name} doesn't send email`).not.toMatch(
        /^\/auth\/email\//,
      );
    }
  });

  it("take an address and the bot check's answer, nothing else, and answer with the code's shape", () => {
    expect(emailCodeInput.safeParse({ email: 'a@b.co', botCheck: 'x' }).success).toBe(true);
    expect(emailCodeInput.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(emailCodeInput.safeParse({ email: 'a@b.co', botCheck: '' }).success).toBe(false);
    expect(emailCodeInput.safeParse({ email: 'a@b.co', botCheck: 'x'.repeat(2049) }).success).toBe(
      false,
    );
    expect(emailCodeInput.safeParse({ email: 'a@b.co', botCheck: 'x', extra: 1 }).success).toBe(
      false,
    );
    expect(emailCodeInput.safeParse({ email: 'x'.repeat(255), botCheck: 'x' }).success).toBe(false);
    expect(emailCodeSent.parse(examples.emailCodeSent)).toEqual(examples.emailCodeSent);
    expect(authSettings.parse(examples.authSettings)).toEqual(examples.authSettings);
    expect(
      authSettings.safeParse({ ...examples.authSettings, supabaseUrl: 'http://x.co' }).success,
    ).toBe(false);
  });

  it("are the stand-in's too: settings, a code sent, and the refusals", async () => {
    const api = createRouterClient(standIn({ signedIn: false }));
    await expect(api.auth.settings()).resolves.toEqual(examples.authSettings);
    await expect(api.auth.emailCode({ email: ' A@B.co ', botCheck: 'x' })).resolves.toEqual({
      ...examples.emailCodeSent,
      email: 'a@b.co',
    });
    await expect(api.auth.emailCode({ email: 'nope', botCheck: 'x' })).rejects.toMatchObject({
      code: 'INVALID_EMAIL',
      status: 400,
    });
    await expect(
      api.auth.emailCode({ email: 'a@b.co', botCheck: 'refused' }),
    ).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED', status: 403 });
  });
});

describe('the stand-in implementation', () => {
  const api = createRouterClient(standIn());

  it('answers every call with its example, which passes the contract', async () => {
    await expect(api.health()).resolves.toEqual(examples.health);
    await expect(api.me()).resolves.toEqual(examples.me);
  });

  it('refuses any input a call does not take', async () => {
    const refused = api.health({ unexpected: '1' } as never);
    await expect(refused).rejects.toBeInstanceOf(ORPCError);
    await expect(refused).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers "not signed in" to who-am-I when nobody is', async () => {
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});

describe('the example content', () => {
  it("is the agreement's own examples, each passing its format's validator", async () => {
    for (const [format, records] of Object.entries(examples.content)) {
      expect(records.length, `${format} has examples`).toBeGreaterThan(0);
      for (const record of records) {
        const result = await standardSchema(format as keyof typeof examples.content)[
          '~standard'
        ].validate(record);
        expect(result.issues, `${format} ${(record as { id: string }).id}`).toBeUndefined();
      }
    }
  });
});

describe("the console's calls", () => {
  const admin = procedures.filter(([name]) => name.startsWith('admin.'));

  it("are the markets' create, open, close and settle and the perp's off switch, settings and test perps, with the reads each shows", () => {
    expect(admin.map(([name]) => name).sort()).toEqual([
      'admin.markets.close',
      'admin.markets.create',
      'admin.markets.get',
      'admin.markets.list',
      'admin.markets.open',
      'admin.markets.settle',
      'admin.perps.createTest',
      'admin.perps.get',
      'admin.perps.list',
      'admin.perps.retireTest',
      'admin.perps.setMode',
      'admin.perps.setSettings',
    ]);
  });

  it('are personal, never kept, under /admin/, and every write is a POST', () => {
    for (const [name, procedure] of admin) {
      const { route, meta } = procedure['~orpc'];
      expect(meta.caching, name).toEqual({ kind: 'personal' });
      expect(route.path, name).toMatch(/^\/admin\//);
      const reads = name.endsWith('.list') || name.endsWith('.get');
      expect(route.method, name).toBe(reads ? 'GET' : 'POST');
    }
  });
});

describe("the perp's console calls (step 3.4a)", () => {
  const admin = procedures.filter(([name]) => name.startsWith('admin.perps.'));

  it('are the off switch, the settings, and making and retiring a test perp, with the two reads', () => {
    expect(admin.map(([name]) => name).sort()).toEqual([
      'admin.perps.createTest',
      'admin.perps.get',
      'admin.perps.list',
      'admin.perps.retireTest',
      'admin.perps.setMode',
      'admin.perps.setSettings',
    ]);
  });

  it('are personal, never kept, under /admin/, and every write is a POST', () => {
    for (const [name, procedure] of admin) {
      const { route, meta } = procedure['~orpc'];
      expect(meta.caching, name).toEqual({ kind: 'personal' });
      expect(route.path, name).toMatch(/^\/admin\/perps/);
      const reads = name.endsWith('.list') || name.endsWith('.get');
      expect(route.method, name).toBe(reads ? 'GET' : 'POST');
    }
  });

  it('answer with the Bitcoin perp as made: switched off, its first rules in its log', () => {
    expect(consolePerpWithLog.parse(examples.consolePerpWithLog)).toEqual(
      examples.consolePerpWithLog,
    );
    expect(examples.consolePerpWithLog.tradingMode).toBe('halted');
    expect(examples.consolePerpWithLog.log).toHaveLength(13);
  });

  it('take the off switch only as a mode Manifold has, always with a reason', () => {
    const id = examples.consolePerpWithLog.id;
    expect(setPerpModeInput.safeParse({ id, mode: 'enabled', reason: 'Testing' }).success).toBe(
      true,
    );
    expect(setPerpModeInput.safeParse({ id, mode: 'off', reason: 'x' }).success).toBe(false);
    expect(setPerpModeInput.safeParse({ id, mode: 'halted', reason: '  ' }).success).toBe(false);
    expect(setPerpModeInput.safeParse({ id, mode: 'halted' }).success).toBe(false);
  });

  it("take each setting only within the engine's own bounds, as the engine reads it", () => {
    const id = examples.consolePerpWithLog.id;
    const takes = (settings: Record<string, string>) =>
      setPerpSettingsInput.safeParse({ id, settings, reason: 'Testing' }).success;
    const within: Record<string, string>[] = [
      { maxLeverage: '1' },
      { maxLeverage: '10' },
      { takerFeeBps: '0' },
      { takerFeeBps: '100' },
      { takerFeeImpact: '100' },
      { fundingPeriodMs: '3600000' },
      { fundingSensitivity: '0.000001' },
      { maxFundingRate: '0.00011415525114155251' },
      { maxFundingRate: '0.999' },
      { maxPriceAgeMs: '1' },
    ];
    for (const settings of within) expect(takes(settings), JSON.stringify(settings)).toBe(true);
    const past: Record<string, string>[] = [
      { maxLeverage: '0.5' },
      { maxLeverage: '10.000001' },
      { takerFeeBps: '100.5' },
      { takerFeeImpact: '101' },
      { fundingPeriodMs: '3599999' },
      { fundingPeriodMs: '3600000.5' },
      { fundingSensitivity: '0' },
      { maxFundingRate: '0' },
      { maxFundingRate: '1' },
      // Exact below 1 as a decimal, 1 as the engine reads it: refused.
      { maxFundingRate: '0.99999999999999999999' },
      { maxPriceAgeMs: '0' },
      { maxPriceAgeMs: '1.5' },
    ];
    for (const settings of past) expect(takes(settings), JSON.stringify(settings)).toBe(false);
  });

  it('take settings as text, at least one, never the subsidies', () => {
    const id = examples.consolePerpWithLog.id;
    const ok = { id, settings: { maxLeverage: '5' }, reason: 'Gentler' };
    expect(setPerpSettingsInput.safeParse(ok).success).toBe(true);
    expect(setPerpSettingsInput.safeParse({ ...ok, settings: {} }).success).toBe(false);
    expect(setPerpSettingsInput.safeParse({ ...ok, settings: { maxLeverage: 5 } }).success).toBe(
      false,
    );
    expect(setPerpSettingsInput.safeParse({ ...ok, settings: { subsidyLong: '1' } }).success).toBe(
      false,
    );
    expect(
      setPerpSettingsInput.safeParse({ ...ok, settings: { maxLeverage: 'NaN' } }).success,
    ).toBe(false);
  });

  it('answer anyone but an admin as an address the API does not have, in the stand-in too', async () => {
    const stranger = createRouterClient(standIn({ admin: false }));
    const id = examples.consolePerpWithLog.id;
    for (const call of [
      () => stranger.admin.perps.list(),
      () => stranger.admin.perps.get({ id }),
      () => stranger.admin.perps.setMode({ id, mode: 'enabled', reason: 'Mine now' }),
      () =>
        stranger.admin.perps.setSettings({ id, settings: { maxLeverage: '5' }, reason: 'Mine' }),
      () => stranger.admin.perps.retireTest({ id, reason: 'Mine' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const admin = createRouterClient(standIn());
    await expect(
      admin.admin.perps.setMode({
        id: examples.consolePerpWithLog.id,
        mode: 'enabled',
        reason: 'Switching it on',
      }),
    ).resolves.toMatchObject({ tradingMode: 'enabled' });
  });
});

describe("a new market's input", () => {
  const hour = 3_600_000;
  const valid = {
    id: '019a6b3c-0001-7000-8000-000000000001',
    question: 'Will test event A happen before the end of the year?',
    categories: ['general', 'ai'],
    rules: 'Yes wins if the test desk records event A.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk" },
    opensAt: new Date(Date.now() + hour).toISOString(),
    closesAt: new Date(Date.now() + 24 * hour).toISOString(),
  };
  const refused = (change: Record<string, unknown>) =>
    !createMarketInput.safeParse({ ...valid, ...change }).success;

  it('takes a draft that keeps the agreement, starting at 50% with a seed of Ṁ1,000', () => {
    const parsed = createMarketInput.parse(valid);
    expect(parsed).toMatchObject({ probability: '0.5', seed: '1000', listed: true });
    expect(createMarketInput.parse({ ...valid, listed: false })).toMatchObject({ listed: false });
    expect(createMarketInput.safeParse({ ...valid, listed: 'no' }).success).toBe(false);
    expect(
      createMarketInput.safeParse({ ...valid, probability: '0.37', seed: '250.5' }).success,
    ).toBe(true);
  });

  it("refuses what the agreement refuses, by the agreement's own check", () => {
    expect(refused({ question: 'x'.repeat(121) })).toBe(true);
    expect(refused({ question: 'Two\nlines?' })).toBe(true);
    expect(refused({ question: 'Hidden\u200btext?' })).toBe(true);
    expect(refused({ rules: 'x'.repeat(2001) })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: 'http://insecure.example' } })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: '' } })).toBe(true);
    expect(refused({ categories: [] })).toBe(true);
    expect(refused({ categories: ['general', 'ai', 'sports', 'crypto'] })).toBe(true);
    expect(refused({ categories: ['general', 'general'] })).toBe(true);
    expect(refused({ categories: ['weather'] })).toBe(true);
    expect(refused({ id: '019a6b3c-0001-4000-8000-000000000001' })).toBe(true);
    expect(refused({ id: '019A6B3C-0001-7000-8000-000000000001' })).toBe(true);
    expect(refused({ extra: 'field' })).toBe(true);
  });

  it('refuses a closing time in the past, and an opening time at or after it', () => {
    expect(refused({ closesAt: new Date(Date.now() - hour).toISOString() })).toBe(true);
    expect(refused({ opensAt: valid.closesAt })).toBe(true);
  });

  it('refuses a starting probability outside 1% to 99%, and a seed of nothing or too much', () => {
    for (const probability of ['0.995', '0.005', '1', '0', '-0.5', '0.123456789']) {
      expect(refused({ probability }), probability).toBe(true);
    }
    for (const seed of ['0', '-5', '1000000.5', '2000000', '1.0000001']) {
      expect(refused({ seed }), seed).toBe(true);
    }
  });
});

describe("a settlement's input", () => {
  const id = '019a6b3c-0001-7000-8000-000000000001';
  const ok = (input: Record<string, unknown>) =>
    settleMarketInput.safeParse({ id, evidence: 'What the test desk recorded.', ...input }).success;

  it('takes Yes, No, a set probability with its probability, or a cancel with its reason', () => {
    expect(ok({ outcome: 'yes' })).toBe(true);
    expect(ok({ outcome: 'no' })).toBe(true);
    expect(ok({ outcome: 'probability', probability: '0.7' })).toBe(true);
    expect(ok({ outcome: 'cancel', reason: 'The test desk recorded nothing.' })).toBe(true);
  });

  it("refuses a probability or a reason where it doesn't belong, or missing where it does", () => {
    expect(ok({ outcome: 'probability' })).toBe(false);
    expect(ok({ outcome: 'yes', probability: '0.7' })).toBe(false);
    expect(ok({ outcome: 'probability', probability: '0.995' })).toBe(false);
    expect(ok({ outcome: 'cancel' })).toBe(false);
    expect(ok({ outcome: 'no', reason: 'A reason.' })).toBe(false);
    expect(ok({ outcome: 'maybe' })).toBe(false);
  });

  it('needs its evidence', () => {
    expect(settleMarketInput.safeParse({ id, outcome: 'yes' }).success).toBe(false);
    expect(ok({ outcome: 'yes', evidence: '' })).toBe(false);
  });
});

describe("the stand-in's market console", () => {
  it("answers an admin with the example market, built from the agreement's own example", async () => {
    const api = createRouterClient(standIn());
    const page = await api.admin.markets.list();
    expect(page).toEqual({ markets: [examples.consoleMarket], next: null });
    const market = await api.admin.markets.get({ id: examples.consoleMarketWithLog.id });
    expect(consoleMarketWithLog.parse(market)).toEqual(examples.consoleMarketWithLog);
    const [first] = examples.content['market/1'];
    expect(market).toMatchObject({ id: first?.id, question: first?.question, state: first?.state });
  });

  it("answers anyone but an admin, signed in or not, as an address the API doesn't have", async () => {
    for (const options of [{ admin: false }, { signedIn: false }]) {
      const api = createRouterClient(standIn(options));
      await expect(api.admin.markets.list()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'No such call',
      });
      await expect(
        api.admin.markets.get({ id: examples.consoleMarketWithLog.id }),
      ).rejects.toBeInstanceOf(ORPCError);
    }
  });
});

describe('the markets, for everyone', () => {
  // The perp's own call in the portfolio (portfolio.perps) is checked with the perp's, below.
  const calls = procedures.filter(
    ([name]) =>
      name.startsWith('markets.') || (name.startsWith('portfolio.') && name !== 'portfolio.perps'),
  );

  it('are the list and the market data, trading, cancelling an order, positions and open orders', () => {
    expect(calls.map(([name]) => name).sort()).toEqual([
      'markets.book',
      'markets.cancelOrder',
      'markets.get',
      'markets.history',
      'markets.list',
      'markets.quote',
      'markets.trade',
      'markets.trades',
      'portfolio.orders',
      'portfolio.positions',
    ]);
  });

  it('keep the list and the market data at the edge, tagged so a change clears them; the rest is never kept', () => {
    // Cleared when a trade moves a price, or the console changes a market.
    const byPrice = ['markets.list', 'markets.get', 'markets.history'];
    // Cleared whenever an order rests, fills or is cancelled, too.
    const byActivity = ['markets.book', 'markets.trades', 'markets.quote'];
    for (const [name, procedure] of calls) {
      const caching = procedure['~orpc'].meta.caching;
      if (byPrice.includes(name) || byActivity.includes(name)) {
        expect(caching, name).toMatchObject({
          kind: 'public',
          tags: [byPrice.includes(name) ? 'markets' : 'market-activity'],
        });
        expect(procedure['~orpc'].route.method, name).toBe('GET');
      } else {
        expect(caching, name).toEqual({ kind: 'personal' });
      }
    }
    expect(contract.markets.trade['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/trades',
    });
    expect(contract.markets.cancelOrder['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/orders/cancel',
    });
  });

  it('say what a refused trade answers: a reason, a limit to wait out, or a busy database', () => {
    const errors = contract.markets.trade['~orpc'].errorMap;
    expect(errors.REFUSED?.status).toBe(422);
    expect(errors.TOO_MANY_REQUESTS?.status).toBe(429);
    expect(errors.UNAUTHORIZED?.status).toBe(401);
    expect(errors.NOT_FOUND?.status).toBe(404);
    expect(errors.CONFLICT?.status).toBe(409);
    expect(errors.SERVICE_UNAVAILABLE?.status).toBe(503);
  });
});

describe('the perp, for everyone (step 3.4a)', () => {
  const calls = procedures.filter(
    ([name]) => name.startsWith('perps.') || name === 'portfolio.perps',
  );

  it('are its price and details, a quote, opening, closing and the positions', () => {
    expect(calls.map(([name]) => name).sort()).toEqual([
      'perps.close',
      'perps.get',
      'perps.list',
      'perps.open',
      'perps.quote',
      'portfolio.perps',
    ]);
  });

  it('keep the price, details and quotes at the edge a few seconds, tagged; trading is never kept', () => {
    for (const name of ['list', 'get', 'quote'] as const) {
      expect(contract.perps[name]['~orpc'].meta.caching).toEqual({
        kind: 'public',
        edgeSeconds: 5,
        staleSeconds: 10,
        tags: ['perps'],
      });
      expect(contract.perps[name]['~orpc'].route.method).toBe('GET');
    }
    for (const name of ['perps.open', 'perps.close', 'portfolio.perps']) {
      const procedure = calls.find(([call]) => call === name)?.[1];
      expect(procedure?.['~orpc'].meta.caching, name).toEqual({ kind: 'personal' });
    }
    expect(contract.perps.open['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/perps/open',
    });
    expect(contract.perps.close['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/perps/close',
    });
  });

  it("say what a refused trade answers: the engine's reason, a limit to wait out, or try again", () => {
    for (const name of ['open', 'close'] as const) {
      const errors = contract.perps[name]['~orpc'].errorMap;
      expect(errors.REFUSED?.status).toBe(422);
      expect(errors.TOO_MANY_REQUESTS?.status).toBe(429);
      expect(errors.UNAUTHORIZED?.status).toBe(401);
      expect(errors.NOT_FOUND?.status).toBe(404);
      expect(errors.CONFLICT?.status).toBe(409);
      expect(errors.SERVICE_UNAVAILABLE?.status).toBe(503);
    }
  });

  it('take an open as text: a margin to the millionth, a leverage of at least 1, an optional most fee', () => {
    const base = {
      perpId: examples.perpDetails.id,
      requestId: '01a1c600-1a00-7a10-9c3d-1f2e3d4c5b6a',
      direction: 'long',
    };
    const takes = (input: Record<string, unknown>) => openPerpInput.safeParse(input).success;
    expect(takes({ ...base, margin: '100', leverage: '10' })).toBe(true);
    expect(takes({ ...base, margin: '0.000001', leverage: '1', maxFee: '0.5' })).toBe(true);
    // More than 10 times is the engine's refusal (422, leverage_too_high), not the contract's.
    expect(takes({ ...base, margin: '100', leverage: '11' })).toBe(true);
    for (const bad of [
      { margin: '0', leverage: '10' },
      { margin: '-1', leverage: '10' },
      { margin: '1.0000001', leverage: '10' },
      { margin: 100, leverage: '10' },
      { margin: '100', leverage: '0.5' },
      { margin: '100', leverage: 10 },
      { margin: '100', leverage: '10', direction: 'sideways' },
      { margin: '100', leverage: '10', extra: true },
    ]) {
      expect(takes({ ...base, ...bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  it('take a close as all of it or a share, more than 0 and at most 1', () => {
    const base = {
      perpId: examples.perpDetails.id,
      requestId: '01a1c601-2b00-7b20-8e4f-3a2b1c0d9e8f',
    };
    const takes = (input: Record<string, unknown>) => closePerpInput.safeParse(input).success;
    expect(takes({ ...base, fraction: '1' })).toBe(true);
    expect(takes({ ...base, fraction: '0.5', expectedSize: '1000', direction: 'long' })).toBe(true);
    // A part-close carries the size it was sized on.
    expect(takes({ ...base, fraction: '0.5' })).toBe(false);
    expect(takes({ ...base, fraction: '1.000000' })).toBe(true);
    for (const fraction of ['0', '1.5', '-0.5', '.5', '0.1234567', 1]) {
      expect(takes({ ...base, fraction }), String(fraction)).toBe(false);
    }
    expect(takes({ ...base })).toBe(false);
  });

  it("answer with the story's examples, each passing the contract", () => {
    expect(perpDetails.parse(examples.perpDetails)).toEqual(examples.perpDetails);
    expect(perpTradeResult.parse(examples.perpOpened)).toEqual(examples.perpOpened);
    expect(perpTradeResult.parse(examples.perpClosed)).toEqual(examples.perpClosed);
    expect(perpPositionsPage.parse(examples.perpPositionsPage)).toEqual(examples.perpPositionsPage);
    // Ṁ1,000, less the margin and fee, plus the payout: the close leaves exactly this.
    expect(examples.perpClosed.balance).toBe('1006.561054');
  });

  it("are the stand-in's too: the price, an open, a close, and a refusal past 10 times", async () => {
    const api = createRouterClient(standIn());
    await expect(api.perps.list()).resolves.toEqual({ perps: [examples.perpDetails] });
    const request = {
      perpId: examples.perpDetails.id,
      requestId: '01a1c602-3c00-7c30-a15e-4b3c2d1e0f9a',
      direction: 'long' as const,
      margin: '100',
      leverage: '10',
    };
    await expect(api.perps.open(request)).resolves.toMatchObject({ status: 'opened' });
    await expect(api.perps.open({ ...request, leverage: '11' })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.perps.open(request)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(signedOut.perps.get({ id: examples.perpDetails.id })).resolves.toEqual(
      examples.perpDetails,
    );
  });
});

describe("a trade's input", () => {
  const hour = 3_600_000;
  const base = {
    marketId: examples.tradeResult.marketId,
    requestId: '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a',
  };
  const buy = { ...base, action: 'buy', outcome: 'yes', amount: '25' };
  const sell = { ...base, action: 'sell', outcome: 'no', shares: '10.5' };
  const takes = (input: Record<string, unknown>) => tradeInput.safeParse(input).success;

  it('takes a buy, a limit order with or without an expiry, and a sale', () => {
    expect(takes(buy)).toBe(true);
    expect(takes({ ...buy, outcome: 'no', amount: '0.000001' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.4' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.01' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.99' })).toBe(true);
    expect(
      takes({ ...buy, limitProb: '0.4', expiresAt: new Date(Date.now() + hour).toISOString() }),
    ).toBe(true);
    expect(takes(sell)).toBe(true);
  });

  it('refuses a limit outside 1% to 99%, or not written as a probability', () => {
    for (const limitProb of ['0.005', '0.995', '0.0099', '0.991', '1', '0', '-0.5', '1.5']) {
      expect(takes({ ...buy, limitProb }), limitProb).toBe(false);
    }
    for (const limitProb of ['0.123456789', '.5', '50%', '0.5 ', 0.5]) {
      expect(takes({ ...buy, limitProb }), String(limitProb)).toBe(false);
    }
  });

  it('refuses an expiry that is not a moment, and an expiry without a limit', () => {
    for (const expiresAt of [0, '0', '', 'tomorrow', '1970-01-01', 1_800_000_000_000]) {
      expect(takes({ ...buy, limitProb: '0.4', expiresAt }), String(expiresAt)).toBe(false);
    }
    expect(takes({ ...buy, expiresAt: new Date(Date.now() + hour).toISOString() })).toBe(false);
  });

  it("leaves an expiry that isn't in the future (zero included) to the server, which checks it unless the request was already answered", async () => {
    // A retried limit order's expiry may have passed by the time it's retried: the server's check
    // (`checkBefore` in @hrizzup/markets) gives the books' first answer instead. The stand-in, with
    // no answer to give back, always refuses it.
    const zero = { ...buy, limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' };
    expect(takes(zero)).toBe(true);
    const api = createRouterClient(standIn());
    for (const expiresAt of ['1970-01-01T00:00:00Z', new Date(Date.now() - 1000).toISOString()]) {
      await expect(
        api.markets.trade({ ...zero, expiresAt } as Parameters<typeof api.markets.trade>[0]),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    }
  });

  it("refuses an amount or shares that isn't more than zero, or isn't exact", () => {
    for (const amount of ['0', '0.0', '0.000000', '-5', '-0.000001', 'abc', '', '1e3', ' 5']) {
      expect(takes({ ...buy, amount }), amount).toBe(false);
    }
    for (const amount of [5, 0, -5, '1.0000001', '01', '123456789012345']) {
      expect(takes({ ...buy, amount }), String(amount)).toBe(false);
    }
    for (const shares of ['0', '-1', 'all', '0.0000001']) {
      expect(takes({ ...sell, shares }), shares).toBe(false);
    }
  });

  it('refuses anything else it was not built to take', () => {
    expect(takes({ ...buy, action: 'short' })).toBe(false);
    expect(takes({ ...buy, outcome: 'YES' })).toBe(false);
    expect(takes({ ...buy, outcome: 'maybe' })).toBe(false);
    expect(takes({ ...buy, requestId: 'retry-1' })).toBe(false);
    expect(takes({ ...buy, marketId: '01A1AB94-8600-7B23-BA8B-9E3174889404' })).toBe(false);
    expect(takes({ ...buy, shares: '1' })).toBe(false);
    expect(takes({ ...sell, amount: '1' })).toBe(false);
    expect(takes({ ...sell, limitProb: '0.4' })).toBe(false);
    expect(takes({ ...buy, extra: 'field' })).toBe(false);
    const { requestId: _requestId, ...noRequestId } = buy;
    expect(takes(noRequestId)).toBe(false);
  });
});

describe("the stand-in's markets", () => {
  const api = createRouterClient(standIn());

  it("lists the agreement's example markets but the draft, newest first, each passing the agreement's check", async () => {
    const page = await api.markets.list();
    expect(marketList.parse(page)).toEqual(examples.marketList);
    const ids = page.markets.map((item) => item.market.id);
    expect(ids).toEqual([...ids].sort().reverse());
    const records = examples.content['market/1'];
    expect(ids.sort()).toEqual(
      records
        .filter((record) => record.state !== 'draft')
        .map((record) => record.id)
        .sort(),
    );
    for (const item of page.markets) {
      const result = await standardSchema('market/1')['~standard'].validate(item.market);
      expect(result.issues, item.market.id).toBeUndefined();
    }
  });

  it('answers trading, a cancel, positions and open orders with examples that pass the contract', async () => {
    const trade = {
      marketId: examples.tradeResult.marketId,
      requestId: examples.tradeResult.requestId,
    };
    await expect(
      api.markets.trade({ ...trade, action: 'buy', outcome: 'yes', amount: '25' }),
    ).resolves.toEqual(examples.tradeResult);
    await expect(
      api.markets.trade({
        ...trade,
        requestId: examples.restingOrder.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '10',
        limitProb: '0.4',
      }),
    ).resolves.toEqual(examples.restingOrder);
    await expect(
      api.markets.trade({ ...trade, action: 'sell', outcome: 'yes', shares: '49.390243' }),
    ).resolves.toMatchObject({ status: 'filled', shares: '-49.390243' });
    await expect(
      api.markets.cancelOrder({
        marketId: trade.marketId,
        orderId: examples.restingOrder.tradeId,
        requestId: examples.cancelOrderResult.requestId,
      }),
    ).resolves.toEqual(examples.cancelOrderResult);
    await expect(api.portfolio.positions()).resolves.toEqual(examples.positionsPage);
    await expect(api.portfolio.orders()).resolves.toEqual(examples.ordersPage);
  });

  it('answers "not signed in" to trading and the portfolio when nobody is, but lists the markets', async () => {
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.markets.list()).resolves.toEqual(examples.marketList);
    await expect(
      signedOut.markets.trade({
        marketId: examples.tradeResult.marketId,
        requestId: examples.tradeResult.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '25',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    await expect(signedOut.portfolio.positions()).rejects.toMatchObject({ status: 401 });
    await expect(signedOut.portfolio.orders()).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an input a trading call does not take before it answers', async () => {
    await expect(
      api.markets.trade({
        marketId: examples.tradeResult.marketId,
        requestId: examples.tradeResult.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '25',
        limitProb: '0.995',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });
});

describe('API keys for bots (step 3.5a)', () => {
  const calls = callsOf(contract.keys);

  it('are listing, making and revoking, personal and never kept, under /me/keys', () => {
    expect(calls.map(([name]) => name).sort()).toEqual(['create', 'list', 'revoke']);
    for (const [name, procedure] of calls) {
      expect(procedure['~orpc'].meta.caching, name).toEqual({ kind: 'personal' });
      expect(procedure['~orpc'].route.path, name).toMatch(/^\/me\/keys/);
    }
    expect(contract.keys.create['~orpc'].route).toMatchObject({
      method: 'POST',
      successStatus: 201,
    });
    expect(contract.keys.revoke['~orpc'].route).toMatchObject({ method: 'POST' });
  });

  it('say what a refused key call answers: a key used to make one, five live keys, ten an hour', () => {
    const errors = contract.keys.create['~orpc'].errorMap;
    expect(errors.FORBIDDEN.status).toBe(403);
    expect(errors.REFUSED.status).toBe(422);
    expect(errors.TOO_MANY_REQUESTS.status).toBe(429);
    expect(errors.SERVICE_UNAVAILABLE.status).toBe(503);
  });

  it('take a name of 1 to 60 characters with no control characters, and read or trade', () => {
    expect(createKeyInput.parse({ name: '  My bot ', scope: 'read' })).toEqual({
      name: 'My bot',
      scope: 'read',
    });
    for (const bad of [
      { name: '', scope: 'read' },
      { name: '   ', scope: 'read' },
      { name: 'x'.repeat(61), scope: 'read' },
      { name: 'Bot\u0007', scope: 'read' },
      { name: 'Bot', scope: 'admin' },
      { name: 'Bot', scope: 'read', extra: true },
    ]) {
      expect(createKeyInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('let a read-only key be refused a trade, in every trading call', () => {
    for (const call of [
      contract.markets.trade,
      contract.markets.cancelOrder,
      contract.perps.open,
      contract.perps.close,
    ]) {
      expect(call['~orpc'].errorMap.FORBIDDEN.status).toBe(403);
    }
  });

  it('answer with the examples, which pass the contract, in the stand-in', async () => {
    const api = createRouterClient(standIn());
    await expect(api.keys.list()).resolves.toEqual(examples.keyList);
    const made = await api.keys.create({ name: 'Reader', scope: 'read' });
    expect(made.key).toMatchObject({ name: 'Reader', scope: 'read' });
    expect(createdKey.safeParse(made).success).toBe(true);
    await expect(api.keys.revoke({ id: examples.apiKey.id })).resolves.toEqual(examples.revokedKey);
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.keys.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('the market data (step 3.5c) and our own price (step 3.4b)', () => {
  const api = createRouterClient(standIn({ signedIn: false }));
  const id = examples.tradeResult.marketId;

  it('are public reads at clean addresses, each kept at the edge briefly', () => {
    const routes = {
      'markets.get': '/markets/{id}',
      'markets.history': '/markets/{id}/history',
      'markets.book': '/markets/{id}/book',
      'markets.trades': '/markets/{id}/trades',
      'markets.quote': '/markets/{id}/quote',
      'perps.quote': '/perps/{id}/quote',
      'prices.get': '/prices/{feed}',
      'prices.history': '/prices/{feed}/history',
    };
    for (const [name, path] of Object.entries(routes)) {
      const procedure = procedures.find(([call]) => call === name)?.[1];
      expect(procedure?.['~orpc'].route, name).toMatchObject({ method: 'GET', path });
      const caching = procedure?.['~orpc'].meta.caching;
      expect(caching?.kind, name).toBe('public');
      if (caching?.kind === 'public') expect(caching.edgeSeconds, name).toBeLessThanOrEqual(60);
    }
    // A new price comes every 5 seconds: the edge keeps the newest only a moment.
    expect(contract.prices.get['~orpc'].meta.caching).toEqual({
      kind: 'public',
      edgeSeconds: 2,
      staleSeconds: 5,
      tags: ['prices'],
    });
  });

  it('take a quote as a buy of an amount (now or at a limit) or a sale of shares, nothing else', () => {
    const quote = (input: object) => marketQuoteInput.safeParse({ id, outcome: 'yes', ...input });
    expect(quote({ amount: '25' }).success).toBe(true);
    expect(quote({ action: 'buy', amount: '25', limitProb: '0.4' }).success).toBe(true);
    expect(quote({ action: 'sell', shares: '10.5' }).success).toBe(true);
    expect(quote({ action: 'sell', shares: '1000000000' }).success).toBe(true);
    for (const bad of [
      {},
      { shares: '10' },
      { amount: '0' },
      { amount: '25', shares: '10' },
      { action: 'sell' },
      { action: 'sell', amount: '25' },
      { action: 'sell', shares: '10', limitProb: '0.4' },
      { amount: '25', limitProb: '0.995' },
      { amount: '1000000000.000001' },
      { action: 'sell', shares: '99999999999999' },
      { amount: '25', action: 'hold' },
    ]) {
      expect(quote(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(marketQuoteInput.safeParse({ id, outcome: 'maybe', amount: '1' }).success).toBe(false);
  });

  it('take a history only over the usual ranges, and a price only of a feed we keep', () => {
    for (const range of ['1h', '1d', '1w', '1m', 'all']) {
      expect(marketHistoryInput.safeParse({ id, range }).success, range).toBe(true);
    }
    expect(marketHistoryInput.safeParse({ id, range: '5y' }).success).toBe(false);
    expect(priceHistoryInput.safeParse({ feed: 'btc-usd' }).success).toBe(true);
    expect(priceHistoryInput.safeParse({ feed: 'eth-usd' }).success).toBe(false);
  });

  it("are the stand-in's too, with examples that pass the contract, and the quote matches its trade", async () => {
    const found = await api.markets.get({ id });
    expect(found).toEqual(examples.oneMarket);
    await expect(
      api.markets.get({ id: '01a1ffff-0000-7000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(marketHistory.parse(await api.markets.history({ id }))).toEqual(examples.marketHistory);
    expect(marketBook.parse(await api.markets.book({ id }))).toEqual(examples.marketBook);
    expect(marketTrades.parse(await api.markets.trades({ id }))).toEqual(examples.marketTrades);
    const quoted = marketQuote.parse(
      await api.markets.quote({ id, outcome: 'yes', amount: examples.tradeResult.amount }),
    );
    expect(quoted).toEqual(examples.marketQuote);
    // The trade that followed filled exactly as quoted.
    expect({
      amount: quoted.amount,
      shares: quoted.shares,
      probBefore: quoted.probBefore,
      probAfter: quoted.probAfter,
    }).toEqual({
      amount: examples.tradeResult.amount,
      shares: examples.tradeResult.shares,
      probBefore: examples.tradeResult.probBefore,
      probAfter: examples.tradeResult.probAfter,
    });
    expect(
      perpQuote.parse(
        await api.perps.quote({
          id: examples.perpDetails.id,
          direction: 'long',
          margin: '100',
          leverage: '10',
        }),
      ),
    ).toEqual(examples.perpQuote);
    await expect(
      api.perps.quote({
        id: examples.perpDetails.id,
        direction: 'long',
        margin: '100',
        leverage: '11',
      }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    expect(price.parse(await api.prices.get({ feed: 'btc-usd' }))).toEqual(examples.price);
    expect(priceHistory.parse(await api.prices.history({ feed: 'btc-usd' }))).toMatchObject({
      range: '1d',
    });
  });

  it('name nobody: no public read of a trade or an order carries an account', () => {
    for (const shape of [publicTrade, bookLevel, marketQuote]) {
      const keys = Object.keys(shape.shape);
      for (const personal of ['accountId', 'userId', 'account', 'requestId', 'email', 'name']) {
        expect(keys).not.toContain(personal);
      }
    }
  });
});

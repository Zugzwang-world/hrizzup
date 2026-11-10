'use server';

import { ORPCError, ValidationError } from '@orpc/server';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin } from '@/lib/console.ts';
import { indiaTimeToUtc, percentToDecimal } from '@/lib/console-format.ts';

/**
 * The market console's forms (PLAN.md step 1.7c). Each sends one of the console's calls through
 * the typed API, in process (lib/api/server.ts), which checks that the signed-in account is an
 * admin before reading anything; the database checks the admins table again and logs each step.
 * To anyone but an admin, every form answers "not found", before it reads anything sent: a form
 * that answered a stranger's bad input with a message would tell them the console exists.
 */

/** The first thing every form does: anyone but an admin gets "not found". */
async function adminsOnly(): Promise<void> {
  if (!(await consoleAdmin())) notFound();
}

/** What a form shows after it's sent: why it was refused, and what was typed, to fix it. */
export type ConsoleFormState = { error: string | null; values: Record<string, string> };

const LABELS: Record<string, string> = {
  id: 'The market',
  question: 'Question',
  categories: 'Categories',
  rules: 'Rules',
  source: 'Source',
  opensAt: 'Opens',
  closesAt: 'Closes',
  probability: 'Probability',
  seed: "The house's seed",
  evidence: 'Evidence',
  reason: 'Reason',
  outcome: 'Outcome',
  mode: 'The off switch',
  settings: 'Settings',
  maxLeverage: 'Most leverage',
  takerFeeBps: 'Opening fee',
  takerFeeImpact: 'Size fee',
  fundingPeriodMs: 'Funding period',
  fundingSensitivity: 'Funding sensitivity',
  maxFundingRate: 'Most funding a period',
  maxPriceAgeMs: 'Oldest price allowed',
};

/** A field as typed: new lines as the agreement writes them, and no spaces at either end. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

/** Every field the form sent, so it can be shown again as it was typed. */
function typed(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of form) if (typeof value === 'string') values[name] = value;
  return values;
}

/** Why the call was refused, in words for the person at the console. */
function refusal(error: unknown, values: Record<string, string>): ConsoleFormState {
  if (!(error instanceof ORPCError)) throw error;
  if (error.code === 'NOT_FOUND' && error.message === 'No such call') notFound();
  if (error.cause instanceof ValidationError) {
    const reasons = error.cause.issues.map((issue) => {
      const first = issue.path?.[0];
      const name = typeof first === 'object' ? String(first.key) : String(first ?? '');
      return LABELS[name] ? `${LABELS[name]}: ${issue.message}.` : `${issue.message}.`;
    });
    return { error: [...new Set(reasons)].join(' '), values };
  }
  if (error.code === 'SERVICE_UNAVAILABLE') {
    return { error: 'The database is busy. Try again in a moment.', values };
  }
  return { error: `${error.message}.`, values };
}

export async function createMarketAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  const values = typed(form);
  const url = field(form, 'sourceUrl');
  const probability = percentToDecimal(field(form, 'probability'));
  const opensAt = indiaTimeToUtc(`${field(form, 'opensDate')}T${field(form, 'opensTime')}`);
  const closesAt = indiaTimeToUtc(`${field(form, 'closesDate')}T${field(form, 'closesTime')}`);
  if (!probability) return { error: 'Probability: a percentage from 1 to 99.', values };
  if (!opensAt || !closesAt) return { error: 'Opens and closes: a date and a time each.', values };
  let id: string;
  try {
    const market = await serverApi.admin.markets.create({
      id: field(form, 'id'),
      question: field(form, 'question'),
      categories: ['category1', 'category2', 'category3']
        .map((name) => field(form, name))
        .filter((code) => code !== ''),
      rules: field(form, 'rules'),
      source: { name: field(form, 'sourceName'), ...(url ? { url } : {}) },
      opensAt,
      closesAt,
      probability,
      seed: field(form, 'seed'),
      // A checkbox is sent only when ticked: a test market, kept off the public list.
      listed: field(form, 'unlisted') !== 'on',
    });
    id = market.id;
  } catch (error) {
    return refusal(error, values);
  }
  redirect(`/console/markets/${id}`);
}

/** Opens, closes or settles a market (for an admin: each action checks first), then shows it again as it now is. */
async function step(
  form: FormData,
  call: (id: string) => Promise<unknown>,
): Promise<ConsoleFormState> {
  const values = typed(form);
  const id = field(form, 'id');
  try {
    await call(id);
  } catch (error) {
    // Show the market as it is now too: a click sent twice, or another admin's, may have moved it.
    revalidatePath(`/console/markets/${id}`);
    return refusal(error, values);
  }
  redirect(`/console/markets/${id}`);
}

export async function openMarketAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  return step(form, (id) => serverApi.admin.markets.open({ id }));
}

export async function closeMarketAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  return step(form, (id) => serverApi.admin.markets.close({ id }));
}

export async function settleMarketAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  const outcome = field(form, 'outcome');
  const reason = field(form, 'reason');
  const typedProbability = field(form, 'probability');
  const probability = outcome === 'probability' ? percentToDecimal(typedProbability) : null;
  if (outcome === 'probability' && !probability) {
    return { error: 'Probability: a percentage from 1 to 99.', values: typed(form) };
  }
  return step(form, (id) =>
    serverApi.admin.markets.settle({
      id,
      outcome: outcome as 'yes' | 'no' | 'probability' | 'cancel',
      evidence: field(form, 'evidence'),
      ...(probability ? { probability } : {}),
      ...(outcome === 'cancel' && reason ? { reason } : {}),
    }),
  );
}

/**
 * The perp's console (PLAN.md step 3.4a): its off switch and its settings, each change in its
 * rule-change log with the reason given. Like every form here, it answers anyone but an admin "not
 * found" before reading anything, and shows the perp again as it now is.
 */
async function perpStep(
  form: FormData,
  call: (id: string) => Promise<unknown>,
): Promise<ConsoleFormState> {
  const values = typed(form);
  const id = field(form, 'id');
  try {
    await call(id);
  } catch (error) {
    revalidatePath(`/console/perps/${id}`);
    return refusal(error, values);
  }
  redirect(`/console/perps/${id}`);
}

export async function setPerpModeAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  const mode = field(form, 'mode');
  if (mode !== 'enabled' && mode !== 'reduce-only' && mode !== 'halted') {
    return { error: 'The off switch: on, closing only, or off.', values: typed(form) };
  }
  // The mode the page showed: nothing to switch, and never a switch back over another admin's
  // change made since the page was loaded.
  if (mode === field(form, 'shown-mode')) {
    return {
      error: 'It is already in that mode: choose another to switch to.',
      values: typed(form),
    };
  }
  return perpStep(form, (id) =>
    serverApi.admin.perps.setMode({ id, mode, reason: field(form, 'reason') }),
  );
}

/** The settings an admin may change from the console, by the engine's names. */
const PERP_SETTINGS = [
  'maxLeverage',
  'takerFeeBps',
  'takerFeeImpact',
  'fundingPeriodMs',
  'fundingSensitivity',
  'maxFundingRate',
  'maxPriceAgeMs',
] as const;

export async function setPerpSettingsAction(
  _before: ConsoleFormState,
  form: FormData,
): Promise<ConsoleFormState> {
  await adminsOnly();
  // Only the settings typed differently from what the page showed: one left as it was is never
  // sent, so a page loaded before another admin's change can't quietly undo it.
  const settings = Object.fromEntries(
    PERP_SETTINGS.map((name) => [name, field(form, name)]).filter(
      ([name, value]) => value !== '' && value !== field(form, `shown-${name}`),
    ),
  );
  if (Object.keys(settings).length === 0) {
    return {
      error: 'Nothing to change: type a new value for a setting first.',
      values: typed(form),
    };
  }
  return perpStep(form, (id) =>
    serverApi.admin.perps.setSettings({ id, settings, reason: field(form, 'reason') }),
  );
}

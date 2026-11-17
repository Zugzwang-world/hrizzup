import signals from './examples/signals.json' with { type: 'json' };
import { type CallExamples, fromJson } from './kit.ts';
import type { StatsPage, ViewNote, ViewsCounted } from './signals.ts';

/** Signals' examples (social/examples/signals.json). */
export const viewNote: ViewNote = fromJson(signals, 'views.input');
export const viewsCounted: ViewsCounted = fromJson(signals, 'views.output');
export const statsPageInput = fromJson<{ limit: number }>(signals, 'me.stats.input');
export const statsPage: StatsPage = fromJson(signals, 'me.stats.output');

export const signalsExamples = {
  'social.views': { input: viewNote, output: viewsCounted },
  'social.me.stats': { input: statsPageInput, output: statsPage },
} satisfies CallExamples;

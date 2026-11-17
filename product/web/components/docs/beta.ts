import { createElement } from 'react';
import { BETA_LABEL, BETA_NOTE, type Call } from '@/lib/api-docs/reference.ts';

/**
 * What the docs show for a call in beta (D9, docs/social/build.md): written without JSX, as plain
 * `createElement` calls, so Vitest (which can't load this project's JSX) renders and tests exactly
 * what the docs page and a call's page print. Both render nothing for any other call.
 */

/** "Beta", beside a call's name in the list: plain inline text, so it wraps with the name. */
export function BetaLabel({ call }: { call: Pick<Call, 'beta'> }) {
  return call.beta
    ? createElement('strong', { className: 'ml-2 text-sm text-muted' }, BETA_LABEL)
    : null;
}

/** "Beta." and what it means, a line of a call's own page. */
export function BetaNote({ call }: { call: Pick<Call, 'beta'> }) {
  return call.beta
    ? createElement(
        'p',
        null,
        createElement('strong', { className: 'text-sm text-muted' }, BETA_LABEL),
        `. ${BETA_NOTE}`,
      )
    : null;
}

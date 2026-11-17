import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BETA_LABEL, BETA_NOTE, callsOf, type Document } from '@/lib/api-docs/reference.ts';
import { BetaLabel, BetaNote } from './beta.ts';

/**
 * What the docs print for a call in beta (D9): its label beside its name in the list (app/docs/page.tsx)
 * and its label and note on its own page (components/docs/call.tsx), rendered here from a call made by
 * the docs' own reader from an OpenAPI file's operation. The pages themselves are checked in the
 * Screen check once a call in beta is in the file.
 */

const answers = {
  '200': {
    content: {
      'application/json': {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    },
  },
};
const file: Document = {
  info: { title: 'Small', version: '1.0.0', description: '' },
  servers: [{ url: 'https://example.test/api/v1' }],
  paths: {
    '/markets': { get: { operationId: 'markets.list', responses: answers } },
    '/stories': {
      get: { operationId: 'stories.list', 'x-stability-level': 'beta', responses: answers },
    },
  },
  components: { schemas: {} },
};
const [v1, beta] = callsOf(file) as [
  ReturnType<typeof callsOf>[number],
  ReturnType<typeof callsOf>[number],
];

describe('the docs, for a call in beta', () => {
  it('shows "Beta" beside its name in the list', () => {
    const html = renderToStaticMarkup(createElement(BetaLabel, { call: beta }));
    expect(html).toBe(`<strong class="ml-2 text-sm text-muted">${BETA_LABEL}</strong>`);
    expect(html).toContain('Beta');
  });

  it('shows "Beta" and what it means on its own page', () => {
    const html = renderToStaticMarkup(createElement(BetaNote, { call: beta }));
    expect(html).toMatch(/^<p><strong class="[^"]*">Beta<\/strong>\. /);
    expect(html).toContain(BETA_NOTE);
  });

  it('shows nothing for a call that is not in beta', () => {
    expect(v1.beta).toBe(false);
    expect(renderToStaticMarkup(createElement(BetaLabel, { call: v1 }))).toBe('');
    expect(renderToStaticMarkup(createElement(BetaNote, { call: v1 }))).toBe('');
  });
});

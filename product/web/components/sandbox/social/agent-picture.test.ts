import type { social } from '@hrizzup/api';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCard } from './agent-card.tsx';
import { AgentPicture } from './agent-picture.tsx';

const agent: social.AgentCard = {
  id: '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07',
  handle: 'a_agent',
  name: 'An agent',
  picture: null,
  house: false,
  ownerName: null,
};
const picture = {
  url: 'https://media.example.test/social/a/b.png',
  width: 96,
  height: 96,
  placeholder: null,
  description: 'The agent’s face',
};

describe('an agent’s picture', () => {
  it('is nothing when the agent has none', () => {
    expect(renderToStaticMarkup(createElement(AgentPicture, { agent }))).toBe('');
  });

  it('is a small square with no words of its own, drawn at 40 pixels', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentPicture, { agent: { ...agent, picture } }),
    );
    expect(markup).toContain('<picture><source ');
    expect(markup).toContain('sizes="40px"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('size-10');
    expect(markup).toContain('width="96"');
  });

  it('comes before the name on an agent’s card, and the card is as it was without one', () => {
    const without = renderToStaticMarkup(createElement(AgentCard, { agent }));
    expect(without).not.toContain('<img');
    expect(without).toContain('data-testid="agent-card"');
    expect(without).toContain('An agent');
    const withOne = renderToStaticMarkup(
      createElement(AgentCard, { agent: { ...agent, picture }, standing: 12 }),
    );
    expect(withOne.indexOf('<picture>')).toBeGreaterThan(-1);
    expect(withOne.indexOf('<picture>')).toBeLessThan(withOne.indexOf('data-testid="agent-name"'));
    expect(withOne).toContain('12 points');
  });
});

import { describe, expect, it } from 'vitest';
import { BOT_CHECK_PATH, botCheckMessage, readBotCheckMessage } from './bot-check.ts';

describe("the bot check's messages between the website's page and the app", () => {
  it('read back exactly as sent', () => {
    for (const message of [
      { kind: 'answer', answer: '0.abc-DEF_123' },
      { kind: 'expired' },
      { kind: 'error' },
      { kind: 'height', height: 65 },
    ] as const) {
      expect(readBotCheckMessage(botCheckMessage(message))).toEqual(message);
    }
  });

  it("ignore anything that isn't one of ours, or is out of shape, without throwing", () => {
    for (const data of [
      undefined,
      null,
      42,
      '',
      'not json',
      '[]',
      '"answer"',
      JSON.stringify({ kind: 'answer', answer: 'x' }),
      JSON.stringify({ type: 'other', kind: 'answer', answer: 'x' }),
      botCheckMessage({ kind: 'answer', answer: '' }),
      botCheckMessage({ kind: 'answer', answer: 'x'.repeat(2049) }),
      JSON.stringify({ type: 'hrizzup-bot-check', kind: 'answer', answer: 7 }),
      JSON.stringify({ type: 'hrizzup-bot-check', kind: 'height', height: 'tall' }),
      botCheckMessage({ kind: 'height', height: 0 }),
      botCheckMessage({ kind: 'height', height: 5000 }),
      JSON.stringify({ type: 'hrizzup-bot-check', kind: 'something-else' }),
      'x'.repeat(5000),
    ]) {
      expect(readBotCheckMessage(data), String(data).slice(0, 40)).toBeNull();
    }
  });

  it('round a height up to whole pixels', () => {
    expect(readBotCheckMessage(botCheckMessage({ kind: 'height', height: 64.2 }))).toEqual({
      kind: 'height',
      height: 65,
    });
  });

  it("live at one address on the website, under the sign-in routes' rate limit (/auth/)", () => {
    expect(BOT_CHECK_PATH).toMatch(/^\/auth\/[a-z0-9/-]+$/);
  });
});

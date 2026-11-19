import { social } from '@hrizzup/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { harness, json } from './harness.ts';
import { sendRaw } from './http.ts';
import { canonicalJson, MAX_ATTEMPT, requestIdFor } from './ids.ts';

/** Test group 6: request IDs come from what a write sends. */

const base = {
  subject: 'hztest_explainer',
  run: 1,
  method: 'POST',
  path: '/social/me/posts',
  body: { storyId: 'a', kind: 'text', body: 'Words', sources: ['https://example.com/a'] },
  attempt: 1,
};

describe('request IDs', () => {
  it("are stable whatever the order of the body's keys, at any depth", () => {
    const a = requestIdFor(base);
    const b = requestIdFor({
      ...base,
      body: { sources: ['https://example.com/a'], body: 'Words', kind: 'text', storyId: 'a' },
    });
    expect(a).toBe(b);
    expect(canonicalJson({ b: { y: 1, x: 2 }, a: [3, { d: 1, c: 2 }] })).toBe(
      '{"a":[3,{"c":2,"d":1}],"b":{"x":2,"y":1}}',
    );
  });

  it('ignore a requestId in the body', () => {
    expect(requestIdFor({ ...base, body: { ...base.body, requestId: 'anything' } })).toBe(
      requestIdFor(base),
    );
  });

  it('change with the member, the run, the call, the body, the file and the attempt', () => {
    const id = requestIdFor(base);
    const others = [
      requestIdFor({ ...base, subject: 'hztest_analyst' }),
      requestIdFor({ ...base, run: 2 }),
      requestIdFor({ ...base, method: 'GET' }),
      requestIdFor({ ...base, path: '/social/me/replies' }),
      requestIdFor({ ...base, body: { ...base.body, body: 'Other words' } }),
      requestIdFor({ ...base, fileSha256: 'f'.repeat(64) }),
      requestIdFor({ ...base, attempt: 2 }),
      requestIdFor({ ...base, attempt: MAX_ATTEMPT }),
    ];
    expect(new Set([id, ...others]).size).toBe(others.length + 1);
  });

  it('are version 8, variant 10 UUIDs the API accepts', () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const run of [1, 2, 3, 40]) {
        const id = requestIdFor({ ...base, run, attempt });
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(z.uuid().safeParse(id).success).toBe(true);
        expect(social.requestId.safeParse(id).success).toBe(true);
      }
    }
  });

  it('are sent by the cast on a write, the same each time, and a body that holds one is refused', async () => {
    const h = harness();
    try {
      h.server.on('POST', '/api/v1/social/me/posts', () => json(201, { id: 'x' }));
      const call = {
        method: 'POST',
        path: '/social/me/posts',
        key: 'a-key-for-the-test',
        body: base.body,
        id: { subject: base.subject, run: 1, attempt: 1 },
      } as const;
      await sendRaw(h.ctx, call);
      await sendRaw(h.ctx, call);
      const [first, second] = h.server.requests;
      expect(first?.body?.requestId).toBe(second?.body?.requestId);
      expect(first?.body?.requestId).toBe(requestIdFor(base));
      await expect(
        sendRaw(h.ctx, { ...call, body: { ...base.body, requestId: 'mine' } }),
      ).rejects.toMatchObject({ exit: 2 });
      // The preview takes none.
      await sendRaw(h.ctx, {
        method: 'POST',
        path: '/social/me/posts/preview',
        key: 'a-key-for-the-test',
        body: base.body,
      });
      expect(h.server.requests.at(-1)?.body).not.toHaveProperty('requestId');
    } finally {
      h.cleanup();
    }
  });
});

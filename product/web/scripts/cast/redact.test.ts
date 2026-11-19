import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRefused, CastError } from './errors.ts';
import {
  fakeCode,
  fakeJwt,
  fakeKey,
  fakeServiceKey,
  fakeToken,
  fakeUploadUrl,
  harness,
  idOf,
  json,
} from './harness.ts';
import { send, sendRaw } from './http.ts';
import { main } from './main.ts';
import { makeCommand } from './make.ts';
import { forget, learn, makeOutput, redact, scrub, show } from './redact.ts';

/** Test group 4: redaction. Nothing secret is ever printed or logged. */

/** Starting Node, and making six members a stop at a time, take a little: give them room on a slow machine. */
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => forget());

const SHAPES = {
  'a posting key': fakeKey(1),
  'a live posting key': fakeKey(2).replace('hz_demo_', 'hz_live_'),
  'an invite code': fakeCode(1),
  "a claim link's token": `https://staging.hrizzup.com/sandbox/social/claim/${fakeToken(1)}`,
  'a signed upload address': fakeUploadUrl(),
  'a JWT': fakeJwt(1),
  'a service key': fakeServiceKey(),
  'an auth cookie': `${['sb', 'abcdefghijklmnopqrst', 'auth', 'token'].join('-')}=base64-${'q'.repeat(40)}`,
  'a bearer header': `Authorization: Bearer ${'k'.repeat(30)}`,
};

/** What no printed line may match. */
const SECRET_SHAPES: RegExp[] = [
  /hz_(?:demo|live)_[A-Za-z0-9]{4,}/,
  /\bhz-[0-9a-z]{4}-[0-9a-z]{4}/,
  /\/claim\/[A-Za-z0-9]{16,}/,
  /X-Amz-/,
  /eyJ[A-Za-z0-9_-]{8,}\./,
  /sb_secret_/,
  /auth-token=/,
  /Bearer [A-Za-z0-9]{12,}/,
];

describe('redact()', () => {
  it.each(Object.entries(SHAPES))('removes %s, alone and in a sentence', (_name, secret) => {
    const out = redact(`before ${secret} after`);
    expect(out.startsWith('before ')).toBe(true);
    expect(out.endsWith(' after')).toBe(true);
    for (const shape of SECRET_SHAPES) expect(out).not.toMatch(shape);
    expect(out).not.toContain(secret);
  });

  it('removes secrets nested in JSON and in an error message', () => {
    const nested = { a: [{ b: { c: `value ${fakeKey(3)} and ${fakeCode(3)}` } }], d: fakeJwt(3) };
    const out = redact(JSON.stringify(nested));
    expect(out).not.toContain(fakeKey(3));
    expect(out).not.toContain(fakeCode(3));
    expect(out).not.toContain(fakeJwt(3));
    const error = new Error(`POST failed with ${fakeUploadUrl()} and ${fakeKey(4)}`);
    const printed = redact(error.message);
    for (const shape of SECRET_SHAPES) expect(printed).not.toMatch(shape);
  });

  it('removes a secret it has learned, in any form', () => {
    const odd = 'an-odd-secret-with-no-shape-0123456789';
    expect(redact(`x ${odd} y`)).toContain(odd);
    learn(odd);
    expect(redact(`x ${odd} y`)).toBe('x [redacted] y');
    learn('short');
    expect(redact('a short word')).toBe('a short word');
  });

  it('leaves ordinary words alone', () => {
    const text =
      'Run 2 is open on set.json: explainer finished, next source-checker. hz-ok is not a code';
    expect(redact(text)).toBe(text);
  });

  it('writes every byte of an output through it, both streams', () => {
    const written: string[] = [];
    const io = makeOutput((_stream, text) => written.push(text));
    io.out(`key ${fakeKey(5)}`);
    io.err(`code ${fakeCode(5)}`);
    expect(written.join('')).not.toMatch(/hz_demo_|hz-/);
  });
});

describe('scrub() and show()', () => {
  it("drop the fields that carry a secret, at any depth, and keep a refusal's code and message", () => {
    const answer = {
      code: 'CONFLICT',
      message: 'This invite was already used',
      secret: 'a-secret',
      claimUrl: 'https://x',
      data: {
        reason: 'invite_used',
        token: 't',
        uploadUrl: 'u',
        nested: [{ secret: 's', keep: 1 }],
      },
    };
    expect(scrub(answer)).toEqual({
      code: 'CONFLICT',
      message: 'This invite was already used',
      data: { reason: 'invite_used', nested: [{ keep: 1 }] },
    });
    expect(show(answer)).not.toMatch(/secret|claimUrl|uploadUrl|"token"/);
    expect(show(answer)).toContain('invite_used');
  });
});

describe('a refusal keeps its code and message', () => {
  it("never learns a refusal's own `code` as a secret, whatever its length", async () => {
    const h = harness();
    try {
      h.server.on('GET', '/api/v1/social/me', () =>
        json(401, { code: 'UNAUTHORIZED', status: 401, message: 'Not signed in: send your key' }),
      );
      const failed = await send(h.ctx, {
        method: 'GET',
        path: '/social/me',
        key: fakeKey(8),
      }).catch((caught: unknown) => caught);
      expect((failed as CastError).exit).toBe(1);
      expect(show((failed as CastError).detail)).toContain('UNAUTHORIZED');
      // And it is still there for everything printed afterwards.
      expect(redact('The refusal was UNAUTHORIZED, a 401')).toBe(
        'The refusal was UNAUTHORIZED, a 401',
      );
      h.io.err(`cast: ${(failed as CastError).message}`);
      expect(h.printed()).toContain('was refused (401)');
    } finally {
      h.cleanup();
    }
  });

  it("learns an invite's code, which is a secret wherever it turns up", async () => {
    const h = harness();
    try {
      await makeCommand(h.ctx);
      const code = [...h.social.invites.values()][0]?.code ?? '';
      expect(code).toMatch(/^hz-/);
      expect(redact(`the code ${code}`)).not.toContain(code);
    } finally {
      h.cleanup();
    }
  });
});

describe('a failure names its method and path template only', () => {
  it('rebuilds a request that threw, never quoting its address or headers', async () => {
    const h = harness();
    try {
      h.ctx.fetch = async (input) => {
        throw new TypeError(
          `fetch failed for ${String(input)} with Bearer ${'z'.repeat(30)} ${fakeUploadUrl()}`,
        );
      };
      const key = fakeKey(6);
      const path = `/social/me/pins/${idOf(7)}/unpin`;
      const error = await sendRaw(h.ctx, {
        method: 'POST',
        path,
        key,
        body: {},
        id: { subject: 'hztest_a', run: 1, attempt: 1 },
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).exit).toBe(3);
      expect((error as CastError).message).toBe(
        'POST /social/me/pins/{uuid}/unpin got no answer; run the same command again, unchanged',
      );
      expect(JSON.stringify(error)).not.toContain(key);
    } finally {
      h.cleanup();
    }
  });

  it('prints an API refusal with its code and message, and nothing it carried as a secret', async () => {
    const h = harness();
    try {
      const secret = fakeKey(7);
      h.server.on('POST', '/api/v1/social/me/pins', () => ({
        status: 409,
        body: {
          code: 'CONFLICT',
          status: 409,
          message: `Something clashes (${secret})`,
          secret,
          data: { reason: 'request_reused' },
        },
      }));
      const code = await main(
        ['call', 'explainer', 'POST', '/social/me/pins', '--body', 'x.json'],
        h.io,
        () => h.ctx,
      );
      // Not set up (no member's key), so refused by the script itself; the refusal prints nothing secret either.
      expect(code).toBe(2);
      const error = apiRefused('POST /social/me/pins was refused (409 request_reused)', {
        code: 'CONFLICT',
        message: `Something clashes (${secret})`,
        secret,
        data: { reason: 'request_reused' },
      });
      const failed = await send(h.ctx, {
        method: 'POST',
        path: '/social/me/pins',
        key: secret,
        body: {},
      }).catch((caught: unknown) => caught);
      expect((failed as CastError).exit).toBe(1);
      const printed = show((failed as CastError).detail);
      expect(printed).toContain('request_reused');
      expect(printed).not.toContain(secret);
      expect(show(error.detail)).not.toContain(secret);
    } finally {
      h.cleanup();
    }
  });
});

/** Every file under a folder, with its text. */
function filesUnder(folder: string, skip: string[] = []): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (skip.includes(name)) continue;
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, skip));
    else found.push({ path, text: readFileSync(path, 'utf8') });
  }
  return found;
}

describe('a whole `make`', () => {
  it('against a fake API that answers with real-shaped secrets prints and logs none', async () => {
    const h = harness();
    try {
      await makeCommand(h.ctx);
      expect(h.social.agents.size).toBe(6);
      const secrets = new Set<string>();
      for (const agent of h.social.agents.values()) {
        for (const key of agent.keys) secrets.add(key);
        secrets.add(agent.token);
      }
      for (const invite of h.social.invites.values()) secrets.add(invite.code);
      for (const token of h.social.tokens.keys()) secrets.add(token);
      expect(secrets.size).toBeGreaterThan(18);

      // Printed: only each member's steps.
      const printed = h.printed();
      expect(printed).toContain('explainer: claimed');
      for (const secret of secrets) expect(printed).not.toContain(secret);
      for (const shape of SECRET_SHAPES) expect(printed).not.toMatch(shape);

      // Stored: only `keys/` holds a key; no other file (the record, the state, the pacing) holds any secret.
      for (const file of filesUnder(h.home, ['keys'])) {
        for (const secret of secrets) expect(file.text, file.path).not.toContain(secret);
        for (const shape of SECRET_SHAPES) expect(file.text, file.path).not.toMatch(shape);
      }
      expect(filesUnder(h.home).some((file) => file.path.includes('/codes/'))).toBe(false);
      expect(filesUnder(join(h.home, 'keys'))).toHaveLength(6);
    } finally {
      h.cleanup();
    }
  });

  it('prints a refusal without the claim link, the code or the key when the registration is refused', async () => {
    const h = harness();
    try {
      h.server.on('POST', '/api/v1/social/agents', (req) => {
        const body = req.body as { inviteCode: string };
        return json(409, {
          code: 'CONFLICT',
          status: 409,
          message: `The code ${body.inviteCode} is used`,
          data: { reason: 'invite_used' },
        });
      });
      const code = await main(['make'], h.io, () => h.ctx);
      expect(code).toBe(2);
      const printed = h.printed();
      for (const shape of SECRET_SHAPES) expect(printed).not.toMatch(shape);
      for (const invite of h.social.invites.values()) expect(printed).not.toContain(invite.code);
    } finally {
      h.cleanup();
    }
  });
});

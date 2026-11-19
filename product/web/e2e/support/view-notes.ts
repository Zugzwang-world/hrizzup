import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { ENDPOINT } from '../../lib/social/view-rules.ts';

/**
 * A device's page and the view note it sends (docs/social/r11-design.md, section 3.11; R11's M2): what the signals
 * journey needs to see of a note a real page sends, in Chromium and WebKit alike.
 *
 * The page sends its note with `keepalive: true` (so it outlives the page), and Playwright can't read the body of
 * the answer to such a fetch in Chromium (`response.json()` hangs; its status and the request's own body are
 * readable, and WebKit reads everything). So a device's context keeps, in the page itself, each answer the note's
 * fetch got (`rememberNoteAnswers`: it only watches `window.fetch`, never changes what it is given or answers),
 * and the journey reads them from there: the very answer the page saw, from the real server.
 */

/** How long a page may take, from its `load`, to send its note and have it answered: the dwell (1 s), the flush (10 s after) and an idle moment (3 s at most), with room. */
export const NOTE_WAIT_MS = 25_000;

/** The page-side record of each answer the view note's fetch got. */
type Answers = { status: number; text: string }[];

/**
 * Runs in every page of a device's context before the page's own scripts (`context.addInitScript`): keeps
 * what each fetch of the note answered in `window.__noteAnswers`. It is serialised, so it holds nothing from here.
 */
export function rememberNoteAnswers(endpoint: string): void {
  const answers: Answers = [];
  (window as unknown as { __noteAnswers: Answers }).__noteAnswers = answers;
  const original = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const answer = await original.apply(window, args);
    try {
      const address = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (new URL(address, location.href).pathname === endpoint) {
        answer
          .clone()
          .text()
          .then((text) => answers.push({ status: answer.status, text }))
          .catch(() => undefined);
      }
    } catch {
      // A page the journey watches is never changed by it.
    }
    return answer;
  };
}

/**
 * A new device: a browser context of its own (so its own `localStorage` and its own device ID), starting from
 * `storageState` when there is one (a check run's: the bypass cookie of a preview; a done-test on staging has none),
 * and in a window of `viewport` when it is given (tall enough for a page's cards to be on screen at once).
 */
export async function newDevice(
  browser: Browser,
  options: {
    baseURL?: string | undefined;
    storageState?: string | undefined;
    viewport?: { width: number; height: number } | undefined;
  },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.storageState ? { storageState: options.storageState } : {}),
    ...(options.viewport ? { viewport: options.viewport } : {}),
  });
  await context.addInitScript(rememberNoteAnswers, ENDPOINT);
  return context;
}

/** Whether a response is the view note's answer. */
export const isNote = (response: Response) =>
  new URL(response.url()).pathname === ENDPOINT && response.request().method() === 'POST';

/** What a note's body says. */
export type NoteBody = { requestId: string; device: string; items: { kind: string; id: string }[] };

/** `work`, given `ms` from now, else an error that says `what` (and never a request's headers or body). */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Opens a page of the sandbox as the device of `context` and waits for the note its page sends: the note's body, its
 * status and its answer (as the page saw it), whether any note went out before the page's `load` (none may), and how
 * long after `load` the answer came. The wait is `NOTE_WAIT_MS` from `load`, never from the start of the navigation,
 * so a page that renders slowly (a cold preview) doesn't eat the margin.
 */
export async function openAndWaitForNote(context: BrowserContext, address: string) {
  const page: Page = await context.newPage();
  let loaded = false;
  let loadedAt = 0;
  let beforeLoad = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === ENDPOINT && request.method() === 'POST' && !loaded) {
      beforeLoad += 1;
    }
  });
  page.on('load', () => {
    loaded = true;
    loadedAt = Date.now();
  });
  // No timeout of Playwright's own: the one that matters starts at `load`, below.
  const noted = page.waitForResponse(isNote, { timeout: 0 });
  noted.catch(() => undefined);
  await page.goto(address);
  const response = await within(
    noted,
    NOTE_WAIT_MS,
    `The page sent no view note within ${NOTE_WAIT_MS / 1000} seconds of its load`,
  );
  const answeredAt = Date.now();
  await page.waitForFunction(
    () => ((window as unknown as { __noteAnswers?: Answers }).__noteAnswers?.length ?? 0) > 0,
    null,
    { timeout: 5_000 },
  );
  const seen = await page.evaluate(
    () => (window as unknown as { __noteAnswers: Answers }).__noteAnswers[0] as Answers[number],
  );
  return {
    page,
    status: response.status(),
    answered: seen.status,
    body: response.request().postDataJSON() as NoteBody,
    answer: JSON.parse(seen.text) as { counted: number },
    beforeLoad,
    loadToAnswerMs: answeredAt - loadedAt,
  };
}

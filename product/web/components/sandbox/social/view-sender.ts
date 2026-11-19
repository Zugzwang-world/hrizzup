import {
  batches,
  DEVICE_KEY,
  DWELL_MS,
  deviceIdOf,
  ENDPOINT,
  FLUSH_MS,
  isDeviceId,
  isOnScreen,
  noteBody,
  retryAfterMs,
  THRESHOLDS,
  type ViewItem,
  viewItemOf,
} from '@/lib/social/view-rules.ts';

/**
 * The page's note about what it showed (docs/social/r11-design.md, decision 13 and section 3.8): its own chunk,
 * which `view-note.tsx` loads only after the page's `load` and an idle moment, so it is never on a page's
 * critical path. It finds every element carrying `data-view-kind` and `data-view-id`, watches each with one
 * observer, and once an item has been on screen for a second without a break, while the page is visible, queues
 * it; the queue goes out as a note ten seconds after its first item, and when the page is hidden.
 *
 * - **The device** is one random ID per browser (`localStorage`, then `sessionStorage`, then memory): the only
 *   thing a note says about the reader, and the server keeps only hashes of it (`@hrizzup/social/views`).
 * - **Never in the way:** no layout reads (the observer's own rectangles only), no state, no console output,
 *   every promise caught, and no mark is ever written to the page: the elements are tracked in a `Map`, so
 *   React's markup is never touched.
 */

type Tracked = {
  item: ViewItem;
  key: string;
  /** Whether it is on screen by the rules, as the observer last said. */
  on: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const NOTHING = () => undefined;

/** A random ID the page keeps for the device; a new one where there is none, or none valid. */
function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A request ID for one note: a UUID version 4. */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The device's ID: kept in `localStorage`, else in `sessionStorage`, else only for this page. */
function deviceOf(): string {
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[area];
      const held = storage.getItem(DEVICE_KEY);
      if (isDeviceId(held)) return held;
      const made = deviceIdOf(randomBytes(16));
      storage.setItem(DEVICE_KEY, made);
      return made;
    } catch {
      // This storage is refused (private browsing, blocked): the next one.
    }
  }
  return deviceIdOf(randomBytes(16));
}

/** Starts noting views on this page; the function it answers stops it (and sends what is queued). */
export function startViewNotes(): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') {
    return NOTHING;
  }
  let device: string;
  try {
    device = deviceOf();
  } catch {
    return NOTHING;
  }

  const tracked = new Map<Element, Tracked>();
  /** What this page has queued or sent: each item once in the page's life. */
  const sent = new Set<string>();
  const queue: ViewItem[] = [];
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const visible = () => document.visibilityState === 'visible';

  function stopTimer(one: Tracked): void {
    if (one.timer !== undefined) clearTimeout(one.timer);
    one.timer = undefined;
  }

  function forget(element: Element, one: Tracked): void {
    stopTimer(one);
    observer.unobserve(element);
    tracked.delete(element);
  }

  /** Posts one note's body: a `keepalive` fetch, tried once more after the wait the answer asks for. */
  function post(body: string, again: boolean): void {
    const retry = (status: number, retryAfter: string | null) => {
      const wait = again ? retryAfterMs(status, retryAfter) : null;
      if (wait === null) return;
      const timer = setTimeout(() => {
        retries.delete(timer);
        post(body, false);
      }, wait);
      retries.add(timer);
    };
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).then(
        (answer) => retry(answer.status, answer.headers.get('Retry-After')),
        () => retry(500, null),
      );
    } catch {
      // Nothing to do: counting is never the reason a page fails.
    }
  }

  /** Sends a note while the page is going away: a beacon, or a `keepalive` fetch where the beacon is refused or missing. */
  function beacon(body: string): void {
    try {
      if (
        typeof navigator.sendBeacon === 'function' &&
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      ) {
        return;
      }
    } catch {
      // Refused: the fetch below.
    }
    post(body, false);
  }

  /** Sends everything queued, in notes of 50, each with a request ID of its own. `once` is for the last send, which is never tried again. */
  function flush(how: 'fetch' | 'beacon' | 'once'): void {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (queue.length === 0) return;
    for (const items of batches(queue.splice(0, queue.length))) {
      const body = noteBody(newRequestId(), device, items);
      if (how === 'beacon') beacon(body);
      else post(body, how === 'fetch');
    }
  }

  function fire(element: Element, one: Tracked): void {
    one.timer = undefined;
    if (stopped || !one.on || !visible()) return;
    forget(element, one);
    if (sent.has(one.key)) return;
    sent.add(one.key);
    queue.push(one.item);
    if (flushTimer === undefined) flushTimer = setTimeout(() => flush('fetch'), FLUSH_MS);
  }

  function start(element: Element, one: Tracked): void {
    if (one.timer !== undefined || !one.on || !visible()) return;
    one.timer = setTimeout(() => fire(element, one), DWELL_MS);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const one = tracked.get(entry.target);
        if (!one) continue;
        one.on = isOnScreen(entry, window.innerHeight);
        if (one.on) start(entry.target, one);
        else stopTimer(one);
      }
    },
    { threshold: [...THRESHOLDS] },
  );

  /** Observes each new mark, and forgets each tracked element that has left the page. */
  function scan(): void {
    scanTimer = undefined;
    if (stopped) return;
    for (const [element, one] of tracked) {
      if (!element.isConnected) forget(element, one);
    }
    for (const element of document.querySelectorAll('[data-view-kind][data-view-id]')) {
      if (tracked.has(element)) continue;
      const item = viewItemOf(
        element.getAttribute('data-view-kind'),
        element.getAttribute('data-view-id'),
      );
      if (item === null) continue;
      const key = `${item.kind}:${item.id}`;
      if (sent.has(key)) continue;
      tracked.set(element, { item, key, on: false, timer: undefined });
      observer.observe(element);
    }
  }

  // The sandbox's navigations change the page without loading it: look again, at most every 250 ms.
  const mutations = new MutationObserver(() => {
    if (scanTimer === undefined && !stopped) scanTimer = setTimeout(scan, 250);
  });

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      for (const one of tracked.values()) stopTimer(one);
      flush('beacon');
    } else {
      for (const [element, one] of tracked) start(element, one);
    }
  }
  function onHide(): void {
    for (const one of tracked.values()) stopTimer(one);
    flush('beacon');
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  mutations.observe(document.body, { childList: true, subtree: true });
  scan();

  return function stop(): void {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
    flush('once');
    observer.disconnect();
    mutations.disconnect();
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    for (const one of tracked.values()) stopTimer(one);
    tracked.clear();
    for (const timer of retries) clearTimeout(timer);
    retries.clear();
  };
}

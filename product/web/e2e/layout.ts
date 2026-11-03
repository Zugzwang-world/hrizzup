import type { Page } from '@playwright/test';

/**
 * Looks at the page as drawn and lists everything that breaks the screen rule (CLAUDE.md,
 * "Screens fit every device"): the page scrolling sideways, anything sticking out of the
 * window, content cut off by its box, and text or controls drawn on top of each other.
 * Returns plain descriptions; an empty list means the page fits.
 */
export function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const TOLERANCE = 1;
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;

    const label = (el: Element) => {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const id = el.id ? `#${el.id}` : '';
      return `<${el.tagName.toLowerCase()}${id}>${text ? ` "${text}"` : ''}`;
    };
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // 1. Sideways scrolling.
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (scrollWidth > vw + TOLERANCE) {
      problems.push(`the page scrolls sideways: ${scrollWidth}px of content in a ${vw}px window`);
    }

    const elements = [...document.body.querySelectorAll('*')].filter(
      (el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg',
    );
    const visible = elements.filter(shown);

    // 2. Anything sticking out of the window.
    for (const el of visible) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + TOLERANCE || r.left < -TOLERANCE) {
        problems.push(
          `${label(el)} sticks out of the window (${Math.round(r.left)} to ${Math.round(r.right)}px of ${vw}px)`,
        );
      }
    }

    // 3. Content cut off by its own box.
    for (const el of visible) {
      const style = getComputedStyle(el);
      const clipsX =
        ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis';
      const clipsY = ['hidden', 'clip'].includes(style.overflowY);
      if (clipsX && el.scrollWidth > el.clientWidth + TOLERANCE) {
        problems.push(`${label(el)} cuts off its content sideways`);
      }
      if (clipsY && el.scrollHeight > el.clientHeight + TOLERANCE) {
        problems.push(`${label(el)} cuts off its content at the bottom`);
      }
    }

    // 4. Text and controls drawn on top of each other. Each line of text and each control
    //    is a box; boxes belonging to different elements must not overlap.
    type Box = { owner: Element; rect: DOMRect };
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !node.textContent?.trim() || !shown(owner) || owner.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) boxes.push({ owner, rect });
      }
    }
    for (const el of visible) {
      if (el.matches('img, svg, video, input, select, textarea, button, iframe')) {
        boxes.push({ owner: el, rect: el.getBoundingClientRect() });
      }
    }
    const reported = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b || a.owner === b.owner) continue;
        if (a.owner.contains(b.owner) || b.owner.contains(a.owner)) continue;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 2 && y > 2) {
          const key = `${label(a.owner)} / ${label(b.owner)}`;
          if (!reported.has(key)) {
            reported.add(key);
            problems.push(`${label(a.owner)} overlaps ${label(b.owner)}`);
          }
        }
      }
    }
    return problems;
  });
}

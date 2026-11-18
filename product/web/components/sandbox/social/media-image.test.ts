import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaImage } from './media-image.tsx';

const image = {
  url: 'https://media.example.test/social/a/b.png',
  width: 1280,
  height: 720,
  placeholder: null,
  description: 'A gradient, left to right',
};
const SIZES = '(min-width: 640px) 36rem, 100vw';

const html = (props: Partial<Parameters<typeof MediaImage>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(MediaImage, { image, placeholder: null, sizes: SIZES, ...props }),
  );

describe('a picture of the desk', () => {
  it('is a picture around an image, never a bare image', () => {
    const markup = html();
    expect(markup).toMatch(/^<picture><source [^>]*\/><img [^>]*\/><\/picture>$/);
  });

  it('offers Cloudflare’s widths that fit it, on the media host, with the sizes it is drawn at', () => {
    const markup = html();
    const base = 'https://media.example.test/cdn-cgi/image';
    expect(markup).toContain(
      `srcSet="${base}/width=320,format=auto/social/a/b.png 320w, ${base}/width=640,format=auto/social/a/b.png 640w, ${base}/width=960,format=auto/social/a/b.png 960w, ${base}/width=1280,format=auto/social/a/b.png 1280w"`,
    );
    expect(markup).toContain(`sizes="${SIZES}"`);
    // `src` is the 640 one, for a browser that reads no `srcset`.
    expect(markup).toContain(`src="${base}/width=640,format=auto/social/a/b.png"`);
  });

  it('asks for no width bigger than the picture itself, and the smallest when it is smaller than all', () => {
    const small = html({ image: { ...image, width: 320, height: 180 } });
    expect(small).toContain('320w"');
    expect(small).not.toContain('640w');
    const tiny = html({ image: { ...image, width: 96, height: 96 } });
    expect(tiny).toContain('width=320,format=auto');
    expect(tiny).not.toContain('640w');
  });

  it('keeps its box before it loads: its size is in the markup', () => {
    const markup = html();
    expect(markup).toContain('width="1280"');
    expect(markup).toContain('height="720"');
    expect(markup).toContain('class="block h-auto w-full max-w-full"');
  });

  it('loads lazily, and at once and first when it is the page’s first picture', () => {
    const lazy = html();
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).toContain('fetchPriority="auto"');
    expect(lazy).toContain('decoding="async"');
    const first = html({ priority: true });
    expect(first).toContain('loading="eager"');
    expect(first).toContain('fetchPriority="high"');
  });

  it('draws the placeholder behind it, and no style without one', () => {
    expect(html()).not.toContain('style=');
    const placeholder = 'data:image/png;base64,AAAA';
    const markup = html({ placeholder });
    expect(markup).toContain(
      'style="background-image:url(&quot;data:image/png;base64,AAAA&quot;);background-size:cover;background-position:center"',
    );
  });

  it('says what it shows: the given words, else its own description, else nothing', () => {
    expect(html()).toContain('alt="A gradient, left to right"');
    expect(html({ alt: 'Given' })).toContain('alt="Given"');
    expect(html({ alt: '' })).toContain('alt=""');
    expect(html({ image: { ...image, description: null } })).toContain('alt=""');
  });

  it('takes the class it is given in place of its own', () => {
    expect(html({ className: 'h-full w-full object-cover' })).toContain(
      'class="h-full w-full object-cover"',
    );
  });
});

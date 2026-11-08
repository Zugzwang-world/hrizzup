# Third-party notices

Hrizzup is proprietary software (see [LICENSE](LICENSE)). This file lists open-source code that has been **copied into** this repository, together with the licence notice each one requires us to keep. Packages installed through a package manager keep their own licence files and are not listed here.

## How to add an entry

1. Confirm the licence allows the use **before** copying anything.
2. Keep the original licence file and any copyright headers next to the copied code.
3. Add a section below with: what was copied, the source repository and the exact commit, where it now lives in this repository, the licence name, and the full licence notice text copied from that commit.

---

## Copied code

### Manifold's market maths (PLAN.md step 1.7a)

- **What:** the maths for yes/no markets (pool prices, buying, limit orders, selling, Yes and No cancelling out, fees, settlement and positions), the files it imports, and Manifold's tests for them, from Manifold's `common/src/`. The list of files, and every change made to them, is in [product/packages/market-engine/README.md](product/packages/market-engine/README.md).
- **Source:** https://github.com/manifoldmarkets/manifold, commit `79997aafcf0d8d826eb51dad5c7712e63d35de65` (5 November 2026).
- **Where it lives:** [product/packages/market-engine/src/manifold/](product/packages/market-engine/src/manifold/), with the licence beside it in `LICENSE.md`. Two files there are Hrizzup's own replacements, not Manifold's: `contract.ts` and `api/utils.ts`.
- **Licence:** MIT, confirmed at that commit (`LICENSE.md`, Manifold's only licence file). The full notice:

> MIT License
>
> Copyright (c) 2022 Manifold Markets, Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### Lucide icons (the design values' icons, PLAN.md step 1.4)

- **What was copied:** the drawings (SVG path data) of the icons listed in `product/packages/design/src/icon-names.ts`, and only those, written into `product/packages/design/src/icons.generated.ts` by `product/packages/design/scripts/write.ts` from the npm package `lucide`.
- **Source:** https://github.com/lucide-icons/lucide, npm package `lucide` version 1.69.0, exactly as published (https://registry.npmjs.org/lucide/-/lucide-1.69.0.tgz; the npm release carries no commit, so the version is the fixed point). `pnpm-lock.yaml` pins it, and the generated file names the version it was written from.
- **Where it lives:** `product/packages/design/src/icons.generated.ts`, with the licence beside it in `product/packages/design/LICENSE-lucide.txt`.
- **Licence:** ISC License; the icons derived from Feather are under the MIT License. Both notices, as shipped in that version:

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Planned

### Manifold's perps maths (PLAN.md step 3.4)

- **Source:** https://github.com/manifoldmarkets/manifold, `common/src/perps/` (MIT, the same licence as the market maths above).
- **When copied:** record the commit and where it lives under `product/`, keep `LICENSE.md` beside it, and add it under "Copied code".

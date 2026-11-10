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

### Manifold's perps maths (PLAN.md step 3.4a)

- **What:** the maths for a perpetual future ("perp"): positions, leverage, liquidation, scaling winners down when the pool runs short (auto-deleveraging), funding, the opening fee, profit and loss, the cash-backing check, the trading switch and filling at the next price, with Manifold's tests for them, from Manifold's `common/src/perps/`. The list of files, and every change made to them, is in [product/packages/market-engine/README.md](product/packages/market-engine/README.md).
- **Source:** https://github.com/manifoldmarkets/manifold, commit `79997aafcf0d8d826eb51dad5c7712e63d35de65` (5 November 2026), the same commit as the market maths above.
- **Where it lives:** [product/packages/market-engine/src/manifold/perps/](product/packages/market-engine/src/manifold/perps/), under the same `LICENSE.md` (in `src/manifold/`). Two files there are Hrizzup's own slim replacements, not Manifold's: `oracle.ts` and `adjacent-msry.ts`.
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

# Hrizzup's example bot

A small, readable walk through Hrizzup's public API with a trading key, on staging, the demo (play money only; PLAN.md step 3.5d). It reads a market and the Bitcoin perp, gets a quote, places a limit order and cancels it, buys and sells, opens a perp position and closes it in two halves, then prints its portfolio. One file, [`bot.ts`](bot.ts), plain TypeScript and the standard `fetch`: nothing to install.

## Run it

1. Sign in on staging and make a **trading** key on the sandbox's keys page (`https://staging.hrizzup.com/sandbox/keys`). It's shown once: copy it.
2. Put it in an environment variable in your terminal, never in a file or a chat:

   ```bash
   read -rs HRIZZUP_API_KEY && export HRIZZUP_API_KEY
   ```

   (Paste the key, then press Return; nothing shows while you paste.)
3. From the repository's folder, with Node.js 24 or later:

   ```bash
   node examples/bot/bot.ts
   ```

It prints each step, and `Done.` at the end. Each trade carries a new request ID, so a retry never trades twice. Revoke the key on the same page when you're done.

## Options

| Variable | What it is | When not set |
|---|---|---|
| `HRIZZUP_API_KEY` | A trading key (`hz_demo_…`) | The bot stops and says so |
| `HRIZZUP_API_URL` | The API's address | `https://staging.hrizzup.com/api/v1` |
| `HRIZZUP_MARKET` | A market's ID to trade in | The newest open market |
| `HRIZZUP_PERP` | A perp's ID to trade | The Bitcoin perp |

## Kept working

The checks typecheck it, and a journey (`product/web/e2e/journeys/example-bot.spec.ts`) runs it on every pull request's preview, on an account, key, market and perp of the run's own, then checks every Ṁ it moved, so it can't silently break. The API's docs: [staging.hrizzup.com/docs](https://staging.hrizzup.com/docs).

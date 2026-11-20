# EdgeLab: resume and interview notes

Private notes for placements. You may want to keep this file out of the public repo.

## Resume bullets (pick 3 or 4)

- Built **EdgeLab**, a forex backtesting and trading-journal web app in TypeScript, React and TradingView Lightweight Charts, with a bar-replay engine that simulates market, limit and stop orders, bid/ask spread, commission, partial closes and weekend gaps.
- Designed an intrabar fill model that replays higher timeframes over M1 data, resolving stop-loss and take-profit hits minute by minute with no look-ahead; covered by 74 Vitest unit tests.
- Wrote a CSV importer that auto-detects MetaTrader 4/5, Dukascopy, HistData and TradingView formats and time zones (DST-safe via `Intl`), storing 100k+ candles per dataset in IndexedDB as packed `Float64Array`s.
- Built an analytics dashboard (expectancy in R, profit factor, max drawdown, SQN, P&L calendar, setup/session breakdowns, backtest-vs-live gap, cost of mistakes) used for my own forex trading.
- Added password-protected accounts with client-side encryption: PBKDF2-SHA-256 (600k iterations) derives an AES-256-GCM key in the Web Crypto API, every journal record is sealed with a fresh IV before it reaches IndexedDB, and cross-device sync carries only ciphertext; plus idle auto-lock and a wrong-password cooldown.
- Integrated the Binance and Twelve Data REST APIs to download and incrementally update up to 300k candles in the browser, with pagination, host fallback, rate-limit handling and fixture-based tests.
- Built a charting terminal on TradingView Lightweight Charts with my own drawing engine (trend lines, Fibonacci, rectangles, long/short risk-reward tool, measure, notes): drawings are stored in time/price space, painted through the chart's primitive API so they stay pinned during zoom and scroll, and edited with hit-tested handles; plus incremental EMA, SMA, Bollinger Bands and RSI.
- Built day and night themes on CSS custom properties (Tailwind v4 tokens) that also recolour canvas charts in place, with profit/loss and session colours checked for colour-blind separation and WCAG contrast on both themes; added a live 24-hour forex session clock in SVG.

## The 60-second pitch

"I trade forex, and I wanted to test strategies without lying to myself. Most free tools either show you the future or assume your stop and target fill perfectly. EdgeLab replays the chart one candle at a time, simulates the spread and the order in which price hits levels inside a candle, and records every trade in a journal. The dashboard then shows in R multiples which setups and sessions actually make money, and how much my mistakes cost compared to my backtests."

## Questions you should be ready for

**How do you know whether the stop or the target was hit first inside one candle?**
With only OHLC you can't know for sure, so I use the open → low → high → close path for bullish candles and open → high → low → close for bearish ones, which is what MT5 does. The better answer is more data: the cursor moves over base candles (for example M1) while the chart shows H1, so the ambiguity shrinks to one minute.

**How do you avoid look-ahead bias?**
The engine only moves forward (`stepTo` ignores earlier indices) and the forming bar is aggregated from base candles up to the cursor only (`partialBar` in `resample.ts`). There's a unit test for both.

**Why model bid and ask separately?**
Charts show bid. A long enters at ask and exits at bid; a short's take profit needs the ask to reach it. Ignoring this overstates short-side results by the spread on every trade. There is a test where a short's TP is touched on the bid but correctly does not fill.

**What happens on a gap?**
A stop that the open price jumps past fills at the open (slippage); a limit order fills at the better open price. Tested in `replay.test.ts`.

**How is lot size calculated?**
Risk amount = balance × risk %. Loss per lot = stop distance × contract size × quote-to-account rate + commission. Lots = risk ÷ loss per lot, rounded down to the lot step. The rate is exact when the account currency is in the pair (1 or 1/price) and a configurable rate for crosses.

**Why IndexedDB and not localStorage?**
localStorage is synchronous, string-only and limited to about 5 MB. A year of M1 data is around 370k candles; I store it as a binary `Float64Array` (48 bytes per candle) in IndexedDB.

**Time zones?**
Everything is UTC internally. Import converts broker time (e.g. UTC+2) to UTC. Sessions are computed in New York time with `Intl.DateTimeFormat`, so DST is handled; display uses the user's zone (Asia/Kolkata by default for you).

**What would you change for production?**
A backend (Node + PostgreSQL) with auth so trades sync across devices, server-side validation, and moving heavy computations (large imports, strategy runs) into a Web Worker. The engine is already UI-free, so it can run in Node unchanged.

**Hardest bug?**
Pick a real one from your own work on it. A good candidate: processing several events inside one candle in the right order (a pending order filling, then its own TP being reached later on the same path), solved by sorting crossed levels by distance from the current price along each path segment.

**How is the journal encrypted, and why PBKDF2?**
The password is stretched with PBKDF2-SHA-256, 600,000 iterations (OWASP's current guidance) and a random 16-byte salt, into a non-extractable AES-256-GCM key. Every record gets a fresh 12-byte IV. Web Crypto supports PBKDF2 natively; Argon2 is stronger against GPUs but would need a WebAssembly library. A sealed "check" value tells a right password from a wrong one without storing anything about the password.

**What doesn't your encryption protect against?**
Malware or a malicious browser extension while the account is unlocked, because the key is in memory then. Weak passwords. Metadata such as account names and when sync documents changed. And there is no password reset, by design.

**How do you keep the API key safe?**
It is part of the encrypted settings, sent only to Twelve Data, and never synced in guest mode. For a public multi-user product I would move provider calls behind a small backend so keys never reach the browser.

**Why not stream live candles yourself?**
Free real-time feeds for forex, gold and futures are rare and licensed. TradingView's widget shows live prices legally for display; for backtesting I download closed candles from free APIs. Live crypto candles over Binance WebSockets are the next step (forward testing).

## Numbers to remember

- 74 unit tests (replay engine, CSV formats, sizing, sessions and time zones, statistics, journal import, sync, encryption, data providers, indicators, drawing tools)
- 5 CSV formats auto-detected
- Instruments: 14 FX pairs, XAUUSD, XAGUSD, USDINR

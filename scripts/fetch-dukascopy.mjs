#!/usr/bin/env node
// Download free historical forex candles from Dukascopy and save them as a CSV
// that EdgeLab can import (Data page -> Import candles).
//
// Usage:
//   npm run data -- --pair eurusd --from 2025-01-01 --to 2025-06-30 --tf m1
//   npm run data -- --pair xauusd --from 2025-03-01 --to 2025-03-31 --tf m5 --out gold.csv
//
// Timeframes: m1, m5, m15, m30, h1, h4, d1. Timestamps are UTC, prices are bid.
// Tip: download M1 and replay on a higher timeframe in EdgeLab. SL/TP fills are then
// checked minute by minute instead of guessing inside a big candle.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getHistoricalRates } from 'dukascopy-node';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key.slice(2)] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const pair = (args.pair || 'eurusd').toLowerCase();
const tf = (args.tf || 'm1').toLowerCase();
const from = args.from || '2025-01-01';
const to = args.to || '2025-01-31';
const out = args.out || `data/${pair.toUpperCase()}_${tf.toUpperCase()}_${from}_${to}.csv`;

const allowed = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'];
if (!allowed.includes(tf)) {
  console.error(`Unsupported timeframe "${tf}". Use one of: ${allowed.join(', ')}`);
  process.exit(1);
}

console.log(`Downloading ${pair.toUpperCase()} ${tf.toUpperCase()} from ${from} to ${to} ...`);
const rows = await getHistoricalRates({
  instrument: pair,
  dates: { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T23:59:59Z`) },
  timeframe: tf,
  priceType: 'bid',
  format: 'array',
  volumes: true,
  ignoreFlats: true,
  batchSize: 10,
  pauseBetweenBatchesMs: 500,
});

const lines = ['timestamp,open,high,low,close,volume'];
for (const r of rows) lines.push(r.slice(0, 6).join(','));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, lines.join('\n') + '\n');
console.log(`Saved ${rows.length.toLocaleString()} candles to ${out}`);

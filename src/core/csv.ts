import type { Candle } from './types';

export type CandleFormat = 'MetaTrader 5' | 'MetaTrader 4' | 'Dukascopy' | 'HistData (EST)' | 'Generic CSV';

export interface ParseOptions {
  /**
   * Hours the timestamps in the file are ahead of UTC (MT5 brokers are often +2 or +3).
   * Leave undefined to use the format's default (HistData = -5, everything else = 0).
   * Ignored for timestamps that carry their own offset or are unix numbers.
   */
  tzOffsetHours?: number;
}

export interface ParseResult {
  candles: Candle[];
  format: CandleFormat;
  /** Most common spacing between bars, in seconds. */
  timeframeSec: number | null;
  /** Offset that was applied, in hours. */
  tzOffsetHours: number;
  skipped: number;
  duplicates: number;
  warnings: string[];
}

interface Layout {
  format: CandleFormat;
  dateCol: number;
  timeCol: number; // -1 when the date column holds the full timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // -1 when absent
  hasHeader: boolean;
  defaultOffset: number;
}

function detectDelimiter(line: string): string {
  const counts: [string, number][] = [
    ['\t', line.split('\t').length - 1],
    [';', line.split(';').length - 1],
    [',', line.split(',').length - 1],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((f) => f.trim().replace(/^"(.*)"$/, '$1').trim());
}

const DATE_ONLY = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * Parse a date/time string to UTC seconds, treating wall time as UTC.
 * Returns [seconds, hasOwnZone] or null.
 */
export function parseTimestamp(dateStr: string, timeStr = ''): [number, boolean] | null {
  let s = (timeStr ? `${dateStr} ${timeStr}` : dateStr).trim();
  if (!s) return null;

  // Unix seconds or milliseconds
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return [n > 1e11 ? Math.floor(n / 1000) : Math.floor(n), true];
  }

  // HistData: 20240102 170000  or  20240102
  let m = /^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/.exec(s);
  if (m) {
    return [Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000, false];
  }

  // Dukascopy style: 02.01.2024 00:00:00.000 [GMT+0200]
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:\s*(?:GMT|UTC)?([+-])(\d{2}):?(\d{2}))?$/.exec(s);
  if (m) {
    let t = Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
    if (m[7]) {
      const off = (+m[8] * 60 + +m[9]) * 60 * (m[7] === '+' ? 1 : -1);
      t -= off;
      return [t, true];
    }
    return [t, false];
  }

  // ISO-ish: 2024.01.02 00:00[:00[.000]] [Z|+05:30] and variants with - or /
  s = s.replace(/\s+UTC$/i, 'Z');
  m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T,](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
    if (m[7]) {
      if (m[7] !== 'Z') {
        const sign = m[7][0] === '+' ? 1 : -1;
        const digits = m[7].slice(1).replace(':', '');
        t -= sign * (+digits.slice(0, 2) * 3600 + +digits.slice(2, 4) * 60);
      }
      return [t, true];
    }
    return [t, false];
  }

  // US / EU slashed dates: 01/02/2024 13:00. Day-first when the first number is > 12.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const [month, day] = a > 12 ? [b, a] : [a, b];
    return [Date.UTC(+m[3], month - 1, day, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000, false];
  }
  return null;
}

function isNumeric(s: string): boolean {
  return /^-?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(s);
}

function findHeaderLayout(header: string[]): Layout | null {
  const h = header.map((x) => x.toLowerCase().replace(/[<>"]/g, '').trim());
  const idx = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const open = idx('open', 'o', 'open price', 'bid open', 'openbid');
  const high = idx('high', 'h', 'high price', 'bid high', 'highbid');
  const low = idx('low', 'l', 'low price', 'bid low', 'lowbid');
  const close = idx('close', 'c', 'close price', 'bid close', 'closebid', 'last');
  if ([open, high, low, close].some((i) => i < 0)) return null;

  let dateCol = idx('datetime', 'date time', 'timestamp', 'gmt time', 'local time', 'time (utc)', 'time (eet)', 'date_time', 'dt');
  let timeCol = -1;
  if (dateCol < 0) {
    const d = idx('date', 'day');
    const t = idx('time');
    if (d >= 0 && t >= 0) {
      dateCol = d;
      timeCol = t;
    } else if (d >= 0) {
      dateCol = d;
    } else if (t >= 0) {
      dateCol = t;
    } else if (h[0] === '' || h[0] === 'index' || h[0] === 'unnamed: 0') {
      dateCol = 0;
    }
  }
  if (dateCol < 0) return null;

  const tickVol = idx('tickvol', 'tick volume', 'tick_volume', 'tickvolume');
  const vol = idx('volume', 'vol', 'volumes');
  const isMt5 = header.some((x) => /^<\w+>$/.test(x.trim()));
  const isDuka = h.includes('gmt time') || h[dateCol] === 'timestamp';
  return {
    format: isMt5 ? 'MetaTrader 5' : isDuka ? 'Dukascopy' : 'Generic CSV',
    dateCol,
    timeCol,
    open,
    high,
    low,
    close,
    volume: tickVol >= 0 ? tickVol : vol,
    hasHeader: true,
    defaultOffset: 0,
  };
}

function findHeaderlessLayout(row: string[]): Layout | null {
  // MT4 export: 2024.01.02,00:00,o,h,l,c,v
  if (row.length >= 6 && DATE_ONLY.test(row[0]) && TIME_ONLY.test(row[1])) {
    return { format: 'MetaTrader 4', dateCol: 0, timeCol: 1, open: 2, high: 3, low: 4, close: 5, volume: row.length > 6 ? 6 : -1, hasHeader: false, defaultOffset: 0 };
  }
  // HistData ASCII: 20240102 170000;o;h;l;c;v (EST without daylight saving)
  if (row.length >= 5 && /^\d{8} \d{6}$/.test(row[0])) {
    return { format: 'HistData (EST)', dateCol: 0, timeCol: -1, open: 1, high: 2, low: 3, close: 4, volume: row.length > 5 ? 5 : -1, hasHeader: false, defaultOffset: -5 };
  }
  // Generic: timestamp,o,h,l,c[,v]
  if (row.length >= 5 && parseTimestamp(row[0]) && row.slice(1, 5).every(isNumeric)) {
    return { format: 'Generic CSV', dateCol: 0, timeCol: -1, open: 1, high: 2, low: 3, close: 4, volume: row.length > 5 ? 5 : -1, hasHeader: false, defaultOffset: 0 };
  }
  return null;
}

/** Most common gap between consecutive bars, ignoring weekends and holes. */
export function inferTimeframe(candles: Candle[]): number | null {
  const counts = new Map<number, number>();
  const n = Math.min(candles.length, 5000);
  for (let i = 1; i < n; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== null && d < best)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/** Parse candle data exported from MT4, MT5, Dukascopy, HistData, TradingView or any OHLC CSV. */
export function parseCandleCsv(text: string, options: ParseOptions = {}): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('The file is empty.');

  const delimiter = detectDelimiter(lines[0]);
  const first = splitLine(lines[0], delimiter);
  const firstLooksLikeHeader = first.some((f) => /[a-z]/i.test(f) && !parseTimestamp(f)) || first[0] === '';
  let layout: Layout | null = null;
  if (firstLooksLikeHeader) layout = findHeaderLayout(first);
  else layout = findHeaderlessLayout(first);
  if (!layout && lines.length > 1 && firstLooksLikeHeader) layout = findHeaderlessLayout(splitLine(lines[1], delimiter));
  if (!layout) {
    throw new Error('Could not recognise the columns. Expected date/time, open, high, low and close columns.');
  }

  const offsetHours = options.tzOffsetHours ?? layout.defaultOffset;
  const offsetSec = Math.round(offsetHours * 3600);
  const decimalComma = delimiter !== ',';
  const num = (s: string | undefined) => (s === undefined ? NaN : Number(decimalComma ? s.replace(',', '.') : s));

  const raw: Candle[] = [];
  let skipped = 0;
  for (let i = layout.hasHeader ? 1 : 0; i < lines.length; i++) {
    const f = splitLine(lines[i], delimiter);
    const ts = parseTimestamp(f[layout.dateCol] ?? '', layout.timeCol >= 0 ? f[layout.timeCol] ?? '' : '');
    const open = num(f[layout.open]);
    const high = num(f[layout.high]);
    const low = num(f[layout.low]);
    const close = num(f[layout.close]);
    if (!ts || ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) {
      skipped++;
      continue;
    }
    const time = ts[1] ? ts[0] : ts[0] - offsetSec;
    const volume = layout.volume >= 0 ? num(f[layout.volume]) : 0;
    raw.push({
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  if (raw.length === 0) throw new Error('No valid candles found in the file.');

  const warnings: string[] = [];
  let sorted = raw;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].time < raw[i - 1].time) {
      sorted = [...raw].sort((a, b) => a.time - b.time);
      warnings.push('Rows were out of order and have been sorted.');
      break;
    }
  }
  const candles: Candle[] = [];
  let duplicates = 0;
  for (const c of sorted) {
    if (candles.length && candles[candles.length - 1].time === c.time) {
      candles[candles.length - 1] = c;
      duplicates++;
    } else {
      candles.push(c);
    }
  }
  if (skipped) warnings.push(`${skipped} row(s) could not be read and were skipped.`);
  if (duplicates) warnings.push(`${duplicates} duplicate timestamp(s) were merged.`);

  return {
    candles,
    format: layout.format,
    timeframeSec: inferTimeframe(candles),
    tzOffsetHours: offsetHours,
    skipped,
    duplicates,
    warnings,
  };
}

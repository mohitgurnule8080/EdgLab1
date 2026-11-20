import type { Instrument, PricingContext, Side, TradeRecord } from '../core/types';
import { findInstrument, normaliseSymbol, customInstrument } from '../core/instruments';
import { grossPnl, pipsBetween } from '../core/sizing';
import { parseTimestamp } from '../core/csv';
import { zonedToUtc } from '../core/time';
import { uid } from './format';

const COLUMNS = [
  'id', 'source', 'symbol', 'side', 'entry_time', 'exit_time', 'entry_price', 'exit_price', 'lots', 'sl', 'tp',
  'pnl', 'fees', 'r_multiple', 'pips', 'setup', 'tags', 'mistakes', 'emotion', 'rating', 'notes', 'screenshot',
] as const;

function esc(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');

export function tradesToCsv(trades: TradeRecord[]): string {
  const rows = trades.map((t) =>
    [
      t.id, t.source, t.symbol, t.side, iso(t.entryTime), iso(t.exitTime), t.entryPrice, t.exitPrice, t.lots, t.sl ?? '', t.tp ?? '',
      t.pnl.toFixed(2), t.fees.toFixed(2), t.rMultiple === null ? '' : t.rMultiple.toFixed(3), t.pips.toFixed(1), t.setup,
      t.tags.join(';'), t.mistakes.join(';'), t.emotion, t.rating || '', t.notes, t.screenshot,
    ].map(esc).join(','),
  );
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}

export const TEMPLATE_CSV =
  'symbol,side,entry_time,exit_time,entry_price,exit_price,lots,sl,tp,pnl,fees,setup,tags,mistakes,emotion,rating,notes\n' +
  'EURUSD,buy,2025-03-04 08:15,2025-03-04 10:40,1.0612,1.0648,0.5,1.0594,1.0650,,3.5,London breakout,trend,,Calm,4,Waited for the retest\n';

/** Minimal CSV reader that understands quoted fields. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  const firstLine = s.slice(0, s.indexOf('\n') >= 0 ? s.indexOf('\n') : s.length);
  const delim = firstLine.includes(',') ? ',' : firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  symbol: ['symbol', 'pair', 'instrument', 'market'],
  side: ['side', 'type', 'direction', 'action'],
  entry_time: ['entry_time', 'open_time', 'opened', 'entry_date', 'time', 'open time', 'entry time', 'date'],
  exit_time: ['exit_time', 'close_time', 'closed', 'exit_date', 'close time', 'exit time'],
  entry_price: ['entry_price', 'open_price', 'entry', 'open price', 'price'],
  exit_price: ['exit_price', 'close_price', 'exit', 'close price'],
  lots: ['lots', 'volume', 'size', 'qty', 'quantity'],
  sl: ['sl', 's/l', 'stop_loss', 'stop loss', 'stop'],
  tp: ['tp', 't/p', 'take_profit', 'take profit', 'target'],
  pnl: ['pnl', 'profit', 'net_profit', 'p&l', 'net p&l', 'result'],
  fees: ['fees', 'commission', 'costs'],
  swap: ['swap'],
  setup: ['setup', 'strategy', 'playbook'],
  tags: ['tags', 'tag'],
  mistakes: ['mistakes', 'mistake', 'errors'],
  emotion: ['emotion', 'emotions', 'mood'],
  rating: ['rating', 'grade', 'score'],
  notes: ['notes', 'note', 'comment', 'comments'],
  screenshot: ['screenshot', 'chart', 'image', 'link'],
  source: ['source'],
  id: ['id', 'ticket', 'position'],
};

export interface JournalImport {
  trades: TradeRecord[];
  skipped: number;
}

/** Timestamps without a zone are read as wall-clock time in the user's display time zone. */
function readTime(value: string, tz: string): number | null {
  const ts = parseTimestamp(value);
  if (!ts) return null;
  if (ts[1]) return ts[0];
  const d = new Date(ts[0] * 1000);
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), tz) + d.getUTCSeconds();
}

export function csvToTrades(text: string, ctx: PricingContext, tz: string, custom: Instrument[] = []): JournalImport {
  const rows = readCsv(text);
  if (rows.length < 2) throw new Error('The file has no trade rows.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (key: string) => header.findIndex((h) => ALIASES[key].includes(h));
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)])) as Record<string, number>;
  for (const required of ['symbol', 'side', 'entry_time', 'entry_price', 'exit_price']) {
    if (idx[required] < 0) throw new Error(`Missing a "${required}" column. Download the template to see the expected columns.`);
  }
  const out: TradeRecord[] = [];
  let skipped = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const r of rows.slice(1)) {
    const get = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    const num = (k: string) => {
      const v = get(k).replace(/[^0-9.\-eE]/g, '');
      return v === '' ? undefined : Number(v);
    };
    const sideRaw = get('side').toLowerCase();
    const side: Side | null = /^(buy|long|b)/.test(sideRaw) ? 'buy' : /^(sell|short|s)/.test(sideRaw) ? 'sell' : null;
    const entryTime = readTime(get('entry_time'), tz);
    const exitTime = readTime(get('exit_time'), tz) ?? entryTime;
    const entry = num('entry_price');
    const exit = num('exit_price');
    const symbol = normaliseSymbol(get('symbol'));
    if (!side || entryTime === null || exitTime === null || !entry || !exit || !symbol) {
      skipped++;
      continue;
    }
    const inst = findInstrument(symbol, custom) ?? customInstrument(symbol);
    const lots = num('lots') ?? 1;
    const sl = num('sl');
    const tp = num('tp');
    const fees = Math.abs(num('fees') ?? 0) + Math.max(0, -(num('swap') ?? 0));
    const pnlGiven = num('pnl');
    const pnl = pnlGiven ?? grossPnl(inst, side, entry, exit, lots, ctx) - fees;
    const dir = side === 'buy' ? 1 : -1;
    const risk = sl ? Math.abs(entry - sl) : 0;
    const list = (k: string) => get(k).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    out.push({
      id: get('id') ? `imp-${get('id')}` : uid('t'),
      source: get('source') === 'backtest' ? 'backtest' : 'live',
      symbol: inst.symbol,
      side,
      entryTime,
      exitTime: Math.max(entryTime, exitTime),
      entryPrice: entry,
      exitPrice: exit,
      lots,
      sl,
      tp,
      pnl,
      fees,
      rMultiple: risk > 0 ? ((exit - entry) * dir) / risk : null,
      pips: pipsBetween(inst, side, entry, exit),
      setup: get('setup'),
      tags: list('tags'),
      mistakes: list('mistakes'),
      emotion: get('emotion'),
      rating: Math.max(0, Math.min(5, Math.round(num('rating') ?? 0))),
      notes: get('notes'),
      screenshot: get('screenshot'),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { trades: out, skipped };
}

import type { Candle, ExitReason, Instrument, OrderKind, PricingContext, Side } from './types';
import { direction, grossPnl } from './sizing';

/**
 * Bar-replay trading simulator.
 *
 * The cursor points at the last base candle the trader has "seen". Stepping reveals the next
 * candle and simulates everything that would have happened inside it:
 *
 *  - Prices in the data are bid prices. Buys fill at ask = bid + spread and exit at bid;
 *    sells fill at bid and exit at ask.
 *  - Inside a candle the price is assumed to travel open -> low -> high -> close for a bullish
 *    candle and open -> high -> low -> close for a bearish one (the same "OHLC" model MT5 uses).
 *    Events are processed in the order price reaches them, so a stop order can fill and then
 *    hit its own TP within the same candle.
 *  - A gap between the previous close and the next open (weekends, news) fills orders and
 *    stops at the open price, i.e. with slippage, exactly like a real market.
 *
 * Replaying a higher timeframe on top of M1 data therefore resolves SL/TP minute by minute.
 */

export interface ReplayConfig {
  instrument: Instrument;
  pricing: PricingContext;
  startingBalance: number;
  spreadPips: number;
  /** Round-turn commission per 1.00 lot, in account currency. */
  commissionPerLot: number;
}

export interface OrderRequest {
  side: Side;
  kind: OrderKind;
  /** Required for limit and stop orders. */
  price?: number;
  lots: number;
  sl?: number;
  tp?: number;
  note?: string;
}

export interface PendingOrder {
  id: string;
  side: Side;
  kind: 'limit' | 'stop';
  price: number;
  lots: number;
  sl?: number;
  tp?: number;
  placedAt: number;
  note?: string;
}

export interface PositionExit {
  lots: number;
  price: number;
  time: number;
  reason: ExitReason;
}

export interface Position {
  id: string;
  side: Side;
  kind: OrderKind;
  lots: number;
  initialLots: number;
  entryPrice: number;
  entryTime: number;
  sl?: number;
  tp?: number;
  initialSl?: number;
  exits: PositionExit[];
  /** Max favourable / adverse excursion in price units (both >= 0). */
  mfe: number;
  mae: number;
  note?: string;
}

export interface ClosedTrade {
  id: string;
  side: Side;
  kind: OrderKind;
  lots: number;
  entryPrice: number;
  entryTime: number;
  /** Lot-weighted average exit price. */
  exitPrice: number;
  exitTime: number;
  sl?: number;
  tp?: number;
  initialSl?: number;
  exitReason: ExitReason;
  grossPnl: number;
  commission: number;
  pnl: number;
  pips: number;
  rMultiple: number | null;
  mfePips: number;
  maePips: number;
  partials: number;
  note?: string;
}

export interface ReplayState {
  cursor: number;
  balance: number;
  nextId: number;
  pending: PendingOrder[];
  positions: Position[];
  closed: ClosedTrade[];
}

export type ReplayEvent =
  | { type: 'filled'; order: PendingOrder; position: Position }
  | { type: 'partial'; position: Position; exit: PositionExit }
  | { type: 'closed'; trade: ClosedTrade };

export type Result<T = void> = ({ ok: true } & (T extends void ? unknown : T)) | { ok: false; error: string };

interface Candidate {
  level: number;
  priority: number;
  run: () => void;
}

const EPS = 1e-12;

export class ReplayEngine {
  readonly candles: Candle[];
  readonly cfg: ReplayConfig;
  private s: ReplayState;

  constructor(candles: Candle[], cfg: ReplayConfig, state?: ReplayState, startIndex = 0) {
    if (candles.length === 0) throw new Error('No candles to replay.');
    this.candles = candles;
    this.cfg = cfg;
    this.s = state
      ? structuredClone(state)
      : {
          cursor: Math.min(Math.max(0, startIndex), candles.length - 1),
          balance: cfg.startingBalance,
          nextId: 1,
          pending: [],
          positions: [],
          closed: [],
        };
  }

  // ---- read-only views --------------------------------------------------

  snapshot(): ReplayState {
    return structuredClone(this.s);
  }
  get cursor(): number {
    return this.s.cursor;
  }
  get atEnd(): boolean {
    return this.s.cursor >= this.candles.length - 1;
  }
  get candle(): Candle {
    return this.candles[this.s.cursor];
  }
  /** Time of the current candle (its open time, UTC seconds). */
  get now(): number {
    return this.candle.time;
  }
  get spread(): number {
    return this.cfg.spreadPips * this.cfg.instrument.pipSize;
  }
  get bid(): number {
    return this.candle.close;
  }
  get ask(): number {
    return this.candle.close + this.spread;
  }
  get balance(): number {
    return this.s.balance;
  }
  get positions(): readonly Position[] {
    return this.s.positions;
  }
  get pending(): readonly PendingOrder[] {
    return this.s.pending;
  }
  get closed(): readonly ClosedTrade[] {
    return this.s.closed;
  }

  /** Price a position would close at right now. */
  exitPriceNow(p: Position): number {
    return p.side === 'buy' ? this.bid : this.ask;
  }

  unrealized(p: Position): number {
    return grossPnl(this.cfg.instrument, p.side, p.entryPrice, this.exitPriceNow(p), p.lots, this.cfg.pricing);
  }

  /** Balance + open P&L - commission still to be paid on open lots. */
  equity(): number {
    let eq = this.s.balance;
    for (const p of this.s.positions) eq += this.unrealized(p) - this.cfg.commissionPerLot * p.lots;
    return eq;
  }

  // ---- trading ----------------------------------------------------------

  placeOrder(req: OrderRequest): Result<{ id: string; events: ReplayEvent[] }> {
    const inst = this.cfg.instrument;
    if (!(req.lots >= inst.minLot - EPS)) return { ok: false, error: `Minimum size is ${inst.minLot} lots.` };
    const bid = this.bid;
    const ask = this.ask;

    if (req.kind === 'market') {
      const entry = req.side === 'buy' ? ask : bid;
      const err = this.validateStops(req.side, req.sl, req.tp, bid, ask, entry);
      if (err) return { ok: false, error: err };
      const pos = this.openPosition(req.side, 'market', entry, this.now, req.lots, req.sl, req.tp, req.note);
      return { ok: true, id: pos.id, events: [] };
    }

    const price = req.price;
    if (price === undefined || !(price > 0)) return { ok: false, error: 'Enter a price for the pending order.' };
    const ref = req.side === 'buy' ? ask : bid;
    if (req.kind === 'limit') {
      if (req.side === 'buy' && !(price < ref)) return { ok: false, error: 'A buy limit must be below the current ask. Use a buy stop to buy higher.' };
      if (req.side === 'sell' && !(price > ref)) return { ok: false, error: 'A sell limit must be above the current bid. Use a sell stop to sell lower.' };
    } else {
      if (req.side === 'buy' && !(price > ref)) return { ok: false, error: 'A buy stop must be above the current ask. Use a buy limit to buy lower.' };
      if (req.side === 'sell' && !(price < ref)) return { ok: false, error: 'A sell stop must be below the current bid. Use a sell limit to sell higher.' };
    }
    if (req.side === 'buy') {
      if (req.sl !== undefined && !(req.sl < price)) return { ok: false, error: 'Stop loss must be below the entry price for a buy.' };
      if (req.tp !== undefined && !(req.tp > price)) return { ok: false, error: 'Take profit must be above the entry price for a buy.' };
    } else {
      if (req.sl !== undefined && !(req.sl > price)) return { ok: false, error: 'Stop loss must be above the entry price for a sell.' };
      if (req.tp !== undefined && !(req.tp < price)) return { ok: false, error: 'Take profit must be below the entry price for a sell.' };
    }
    const order: PendingOrder = {
      id: `O${this.s.nextId++}`,
      side: req.side,
      kind: req.kind,
      price,
      lots: req.lots,
      sl: req.sl,
      tp: req.tp,
      placedAt: this.now,
      note: req.note,
    };
    this.s.pending.push(order);
    return { ok: true, id: order.id, events: [] };
  }

  cancelOrder(id: string): boolean {
    const before = this.s.pending.length;
    this.s.pending = this.s.pending.filter((o) => o.id !== id);
    return this.s.pending.length !== before;
  }

  /** Change SL/TP of an open position. Pass `null` to remove a level, `undefined` to keep it. */
  modifyPosition(id: string, change: { sl?: number | null; tp?: number | null }): Result {
    const p = this.s.positions.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'Position not found.' };
    const sl = change.sl === undefined ? p.sl : change.sl ?? undefined;
    const tp = change.tp === undefined ? p.tp : change.tp ?? undefined;
    const err = this.validateStops(p.side, sl, tp, this.bid, this.ask, p.entryPrice, true);
    if (err) return { ok: false, error: err };
    p.sl = sl;
    p.tp = tp;
    if (p.initialSl === undefined && sl !== undefined) p.initialSl = sl;
    return { ok: true };
  }

  /** Close all or part of a position at the current price. */
  closePosition(id: string, lots?: number, reason: ExitReason = 'manual'): ReplayEvent[] {
    const p = this.s.positions.find((x) => x.id === id);
    if (!p) return [];
    const events: ReplayEvent[] = [];
    this.exit(p, this.exitPriceNow(p), this.now, reason, lots ?? p.lots, events);
    return events;
  }

  closeAll(reason: ExitReason = 'manual'): ReplayEvent[] {
    const events: ReplayEvent[] = [];
    for (const p of [...this.s.positions]) this.exit(p, this.exitPriceNow(p), this.now, reason, p.lots, events);
    return events;
  }

  // ---- time -------------------------------------------------------------

  /** Reveal the next `count` base candles and simulate fills inside them. */
  step(count = 1): ReplayEvent[] {
    const events: ReplayEvent[] = [];
    for (let k = 0; k < count && !this.atEnd; k++) {
      const prevClose = this.candles[this.s.cursor].close;
      this.s.cursor++;
      this.processCandle(this.candles[this.s.cursor], prevClose, events);
    }
    return events;
  }

  /** Advance until the cursor reaches `index` (never moves backwards: no peeking). */
  stepTo(index: number): ReplayEvent[] {
    const target = Math.min(index, this.candles.length - 1);
    return target > this.s.cursor ? this.step(target - this.s.cursor) : [];
  }

  // ---- internals --------------------------------------------------------

  private validateStops(side: Side, sl: number | undefined, tp: number | undefined, bid: number, ask: number, entry: number, modifying = false): string | null {
    if (side === 'buy') {
      if (sl !== undefined && !(sl < bid)) return `Stop loss must be below the current bid (${bid}).`;
      if (tp !== undefined && !(tp > (modifying ? bid : entry))) return modifying ? `Take profit must be above the current bid (${bid}).` : 'Take profit must be above the entry price for a buy.';
    } else {
      if (sl !== undefined && !(sl > ask)) return `Stop loss must be above the current ask (${ask}).`;
      if (tp !== undefined && !(tp < (modifying ? ask : entry))) return modifying ? `Take profit must be below the current ask (${ask}).` : 'Take profit must be below the entry price for a sell.';
    }
    return null;
  }

  private openPosition(side: Side, kind: OrderKind, entry: number, time: number, lots: number, sl?: number, tp?: number, note?: string): Position {
    const pos: Position = {
      id: `P${this.s.nextId++}`,
      side,
      kind,
      lots,
      initialLots: lots,
      entryPrice: entry,
      entryTime: time,
      sl,
      tp,
      initialSl: sl,
      exits: [],
      mfe: 0,
      mae: 0,
      note,
    };
    this.s.positions.push(pos);
    return pos;
  }

  private exit(p: Position, price: number, time: number, reason: ExitReason, lots: number, events: ReplayEvent[]): void {
    const inst = this.cfg.instrument;
    const qty = Math.min(lots, p.lots);
    const remaining = p.lots - qty;
    const full = remaining < inst.minLot / 2;
    const closeLots = full ? p.lots : qty;
    const gross = grossPnl(inst, p.side, p.entryPrice, price, closeLots, this.cfg.pricing);
    const commission = this.cfg.commissionPerLot * closeLots;
    this.s.balance += gross - commission;
    const ex: PositionExit = { lots: closeLots, price, time, reason };
    p.exits.push(ex);
    p.lots = full ? 0 : Number(remaining.toFixed(8));
    if (!full) {
      events.push({ type: 'partial', position: p, exit: ex });
      return;
    }
    this.s.positions = this.s.positions.filter((x) => x.id !== p.id);
    const trade = this.finalise(p);
    this.s.closed.push(trade);
    events.push({ type: 'closed', trade });
  }

  private finalise(p: Position): ClosedTrade {
    const inst = this.cfg.instrument;
    const dir = direction(p.side);
    const totalLots = p.exits.reduce((a, e) => a + e.lots, 0);
    const avgExit = p.exits.reduce((a, e) => a + e.price * e.lots, 0) / totalLots;
    const gross = p.exits.reduce((a, e) => a + grossPnl(inst, p.side, p.entryPrice, e.price, e.lots, this.cfg.pricing), 0);
    const commission = this.cfg.commissionPerLot * totalLots;
    const risk = p.initialSl !== undefined ? Math.abs(p.entryPrice - p.initialSl) : 0;
    const last = p.exits[p.exits.length - 1];
    return {
      id: p.id,
      side: p.side,
      kind: p.kind,
      lots: totalLots,
      entryPrice: p.entryPrice,
      entryTime: p.entryTime,
      exitPrice: avgExit,
      exitTime: last.time,
      sl: p.sl,
      tp: p.tp,
      initialSl: p.initialSl,
      exitReason: last.reason,
      grossPnl: gross,
      commission,
      pnl: gross - commission,
      pips: ((avgExit - p.entryPrice) * dir) / inst.pipSize,
      rMultiple: risk > 0 ? ((avgExit - p.entryPrice) * dir) / risk : null,
      mfePips: p.mfe / inst.pipSize,
      maePips: p.mae / inst.pipSize,
      partials: p.exits.length,
      note: p.note,
    };
  }

  private processCandle(c: Candle, prevClose: number, events: ReplayEvent[]): void {
    const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
    this.walk(prevClose, c.open, c.time, true, events);
    for (let i = 0; i < 3; i++) this.walk(path[i], path[i + 1], c.time, false, events);
  }

  private trackExcursions(bid: number): void {
    const ask = bid + this.spread;
    for (const p of this.s.positions) {
      const move = p.side === 'buy' ? bid - p.entryPrice : p.entryPrice - ask;
      if (move > p.mfe) p.mfe = move;
      if (-move > p.mae) p.mae = -move;
    }
  }

  /**
   * Move the bid from `from` to `to` and run every order/stop it crosses, nearest first.
   * In a gap (`isGap`) nothing traded in between, so every fill happens at `to`.
   */
  private walk(from: number, to: number, time: number, isGap: boolean, events: ReplayEvent[]): void {
    if (from === to) {
      this.trackExcursions(to);
      return;
    }
    const up = to > from;
    const s = this.spread;
    let cur = from;
    // A level L is reached when the bid travels past it in the direction of the move.
    const reached = (level: number) => (up ? level > cur && level <= to : level < cur && level >= to);

    for (let guard = 0; guard < 10_000; guard++) {
      const candidates: Candidate[] = [];

      for (const p of this.s.positions) {
        if (p.side === 'buy') {
          // A long exits at the bid.
          if (p.sl !== undefined && !up && reached(p.sl)) {
            const lvl = p.sl;
            candidates.push({ level: lvl, priority: 0, run: () => this.exit(p, isGap ? to : lvl, time, 'sl', p.lots, events) });
          }
          if (p.tp !== undefined && up && reached(p.tp)) {
            const lvl = p.tp;
            candidates.push({ level: lvl, priority: 1, run: () => this.exit(p, isGap ? to : lvl, time, 'tp', p.lots, events) });
          }
        } else {
          // A short exits at the ask = bid + spread.
          if (p.sl !== undefined && up && reached(p.sl - s)) {
            const sl = p.sl;
            candidates.push({ level: sl - s, priority: 0, run: () => this.exit(p, isGap ? to + s : sl, time, 'sl', p.lots, events) });
          }
          if (p.tp !== undefined && !up && reached(p.tp - s)) {
            const tp = p.tp;
            candidates.push({ level: tp - s, priority: 1, run: () => this.exit(p, isGap ? to + s : tp, time, 'tp', p.lots, events) });
          }
        }
      }

      for (const o of this.s.pending) {
        // Buy orders fill at the ask, so their bid-level is price - spread.
        const lvl = o.side === 'buy' ? o.price - s : o.price;
        const triggers =
          (o.side === 'buy' && o.kind === 'limit' && !up) ||
          (o.side === 'buy' && o.kind === 'stop' && up) ||
          (o.side === 'sell' && o.kind === 'limit' && up) ||
          (o.side === 'sell' && o.kind === 'stop' && !up);
        if (triggers && reached(lvl)) {
          candidates.push({
            level: lvl,
            priority: 2,
            run: () => {
              const fill = isGap ? (o.side === 'buy' ? to + s : to) : o.price;
              this.s.pending = this.s.pending.filter((x) => x.id !== o.id);
              const pos = this.openPosition(o.side, o.kind, fill, time, o.lots, o.sl, o.tp, o.note);
              events.push({ type: 'filled', order: o, position: pos });
              // In a gap the fill can already be beyond its own SL/TP.
              const bidNow = isGap ? to : lvl;
              const askNow = bidNow + s;
              if (pos.side === 'buy') {
                if (pos.sl !== undefined && bidNow <= pos.sl) this.exit(pos, bidNow, time, 'sl', pos.lots, events);
                else if (pos.tp !== undefined && bidNow >= pos.tp) this.exit(pos, bidNow, time, 'tp', pos.lots, events);
              } else {
                if (pos.sl !== undefined && askNow >= pos.sl) this.exit(pos, askNow, time, 'sl', pos.lots, events);
                else if (pos.tp !== undefined && askNow <= pos.tp) this.exit(pos, askNow, time, 'tp', pos.lots, events);
              }
            },
          });
        }
      }

      if (candidates.length === 0) break;
      candidates.sort((a, b) => Math.abs(a.level - cur) - Math.abs(b.level - cur) || a.priority - b.priority);
      const next = candidates[0];
      this.trackExcursions(isGap ? to : next.level);
      next.run();
      cur = next.level;
    }
    this.trackExcursions(to);
  }
}

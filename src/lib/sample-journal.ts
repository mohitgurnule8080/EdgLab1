import type { Instrument, PricingContext, Side, TradeRecord } from '../core/types';
import { findInstrument } from '../core/instruments';
import { grossPnl, lotsForRisk, pipsBetween } from '../core/sizing';

/** Small deterministic PRNG so the sample journal is the same on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SetupModel {
  name: string;
  winRate: number;
  winR: [number, number];
  hourUtc: [number, number];
  tags: string[];
}

const SETUPS: SetupModel[] = [
  { name: 'London breakout', winRate: 0.5, winR: [1.4, 2.4], hourUtc: [7, 10], tags: ['trend'] },
  { name: 'NY reversal', winRate: 0.42, winR: [2, 3.4], hourUtc: [13, 16], tags: ['counter-trend'] },
  { name: 'Order block retest', winRate: 0.56, winR: [1.2, 2], hourUtc: [8, 15], tags: ['trend', 'A+ setup'] },
  { name: 'Asian range sweep', winRate: 0.36, winR: [1.5, 2.6], hourUtc: [0, 4], tags: ['range'] },
];

const SYMBOLS: { symbol: string; mid: number; spread: number; slPips: [number, number] }[] = [
  { symbol: 'EURUSD', mid: 1.15, spread: 0.03, slPips: [10, 22] },
  { symbol: 'GBPUSD', mid: 1.33, spread: 0.03, slPips: [14, 28] },
  { symbol: 'XAUUSD', mid: 4000, spread: 160, slPips: [35, 90] },
  { symbol: 'USDJPY', mid: 150, spread: 4, slPips: [14, 30] },
];

const NOTES_WIN = [
  'Waited for the retest and entered on the M5 engulfing.',
  'Clean sweep of the Asian high, displacement, then entry on the pullback.',
  'Followed the plan: partials at 1R, rest to target.',
  'HTF bias aligned with the session move.',
];
const NOTES_LOSS = [
  'Setup was valid, price just did not follow through.',
  'Entered before the candle closed.',
  'News spike took the stop.',
  'Counter to the H4 trend, should have skipped.',
];

export function generateSampleJournal(ctx: PricingContext, nowSec = Math.floor(Date.now() / 1000)): TradeRecord[] {
  const rnd = mulberry32(20_241_119);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const trades: TradeRecord[] = [];
  const day = 86_400;
  const startDay = Math.floor(nowSec / day) - 110;

  let n = 0;
  for (let d = startDay; d < startDay + 110; d++) {
    const weekday = new Date(d * day * 1000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const count = rnd() < 0.35 ? 0 : rnd() < 0.75 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const backtest = rnd() < 0.3;
      const setup = pick(SETUPS);
      const sym = pick(SYMBOLS);
      const inst = findInstrument(sym.symbol) as Instrument;
      const side: Side = rnd() < 0.55 ? 'buy' : 'sell';
      const entryTime = d * day + Math.floor(between(setup.hourUtc[0], setup.hourUtc[1]) * 3600);
      const entry = Number((sym.mid + between(-sym.spread, sym.spread)).toFixed(inst.digits));
      const slPips = between(sym.slPips[0], sym.slPips[1]);
      const slDist = slPips * inst.pipSize;
      const dir = side === 'buy' ? 1 : -1;
      const sl = Number((entry - dir * slDist).toFixed(inst.digits));

      // Live trading is a little worse than the backtest: mistakes cost money.
      const mistakes: string[] = [];
      if (!backtest && rnd() < 0.28) mistakes.push(pick(['FOMO entry', 'Moved SL', 'Early exit', 'Oversized', 'Revenge trade', 'No setup']));
      const winRate = setup.winRate - (mistakes.length ? 0.15 : 0) + (backtest ? 0.03 : 0);
      let r: number;
      if (rnd() < 0.08) r = between(-0.1, 0.1);
      else if (rnd() < winRate) r = between(setup.winR[0], setup.winR[1]) * (mistakes.includes('Early exit') ? 0.45 : 1);
      else r = mistakes.includes('Moved SL') ? -between(1.3, 2) : -between(0.92, 1.03);
      const tp = Number((entry + dir * slDist * setup.winR[1]).toFixed(inst.digits));
      const exit = Number((entry + dir * slDist * r).toFixed(inst.digits));
      const size = lotsForRisk({ inst, ctx, balance: 10_000, riskPct: mistakes.includes('Oversized') ? 2.5 : 1, entry, sl });
      const lotsN = Math.max(inst.minLot, size.lots);
      const fees = Number((lotsN * 7).toFixed(2));
      const gross = grossPnl(inst, side, entry, exit, lotsN, ctx);
      const exitTime = entryTime + Math.floor(between(0.3, 6) * 3600);
      const win = r > 0.1;
      trades.push({
        id: `sample-${++n}`,
        source: backtest ? 'backtest' : 'live',
        sessionId: backtest ? 'sample-session' : undefined,
        symbol: sym.symbol,
        side,
        entryTime,
        exitTime,
        entryPrice: entry,
        exitPrice: exit,
        lots: lotsN,
        sl,
        tp,
        pnl: Number((gross - fees).toFixed(2)),
        fees,
        rMultiple: ((exit - entry) * dir) / slDist,
        pips: pipsBetween(inst, side, entry, exit),
        setup: setup.name,
        tags: rnd() < 0.5 ? [...setup.tags] : setup.tags.slice(0, 1),
        mistakes,
        emotion: mistakes.length ? pick(['Anxious', 'Frustrated', 'Greedy', 'Impatient']) : pick(['Calm', 'Calm', 'Confident', 'Focused']),
        rating: mistakes.length ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 3),
        notes: win ? pick(NOTES_WIN) : pick(NOTES_LOSS),
        screenshot: '',
        exitReason: win ? 'tp' : r < -0.5 ? 'sl' : 'manual',
        sample: true,
        createdAt: exitTime,
        updatedAt: exitTime,
      });
    }
  }
  return trades;
}

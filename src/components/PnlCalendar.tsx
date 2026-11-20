import { useMemo, useState } from 'react';
import type { DayCell } from '../core/stats';
import { monthName } from '../core/time';
import { compactMoney, money, plural } from '../lib/format';
import { Button } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month grid of daily net P&L. Diverging colour: profit tint, loss tint, neutral for flat days. */
export function PnlCalendar({ daily, currency, initial }: { daily: Map<string, DayCell>; currency: string; initial: { year: number; month: number } }) {
  const [ym, setYm] = useState(initial);
  const move = (d: number) => setYm(({ year, month }) => {
    const m = month + d;
    return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
  });

  const { weeks, maxAbs, total, days, greenDays } = useMemo(() => {
    const first = new Date(Date.UTC(ym.year, ym.month - 1, 1));
    const daysInMonth = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const cells: ({ day: number; key: string; cell?: DayCell } | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    let maxAbs = 0;
    let total = 0;
    let days = 0;
    let greenDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${ym.year}-${pad(ym.month)}-${pad(d)}`;
      const cell = daily.get(key);
      if (cell) {
        maxAbs = Math.max(maxAbs, Math.abs(cell.pnl));
        total += cell.pnl;
        days++;
        if (cell.pnl > 0) greenDays++;
      }
      cells.push({ day: d, key, cell });
    }
    while (cells.length % 7) cells.push(null);
    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, maxAbs, total, days, greenDays };
  }, [daily, ym]);

  const tint = (pnl: number) => {
    if (!maxAbs || Math.abs(pnl) < 1e-9) return 'var(--color-ink-850)';
    const a = 18 + 62 * Math.sqrt(Math.abs(pnl) / maxAbs);
    return `color-mix(in oklab, var(${pnl > 0 ? '--color-profit' : '--color-loss'}) ${a.toFixed(1)}%, transparent)`;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Previous month">
            ‹
          </Button>
          <div className="min-w-[110px] text-center font-semibold">
            {monthName(ym.month)} {ym.year}
          </div>
          <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Next month">
            ›
          </Button>
        </div>
        <div className="text-[13px] text-fg-2">
          <span className="type-data font-semibold text-fg">{money(total, currency, { signed: true })}</span> over {plural(days, 'trading day')}, {greenDays} green
        </div>
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-[3px] text-[12px]">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-center text-fg-3">
            {d}
          </div>
        ))}
        <div className="pb-1 text-center text-fg-3">Week</div>
        {weeks.map((w, wi) => {
          const wk = w.reduce((a, c) => a + (c?.cell?.pnl ?? 0), 0);
          const wkTrades = w.reduce((a, c) => a + (c?.cell?.trades ?? 0), 0);
          return [
            ...w.map((c, i) =>
              c ? (
                <div
                  key={c.key}
                  className="flex h-[52px] flex-col justify-between rounded-[5px] p-1.5 sm:h-[62px]"
                  style={{ background: c.cell ? tint(c.cell.pnl) : 'transparent', outline: c.cell ? undefined : '1px solid color-mix(in oklab, var(--color-ink-700) 55%, transparent)' }}
                  title={c.cell ? `${c.key}: ${money(c.cell.pnl, currency, { signed: true })} from ${plural(c.cell.trades, 'trade')}` : c.key}
                >
                  <span className="text-[11px] text-fg-2">{c.day}</span>
                  {c.cell && (
                    <span className="type-data leading-tight">
                      <span className="block font-semibold text-fg">{compactMoney(c.cell.pnl, currency)}</span>
                      <span className="hidden text-[11px] text-fg-2 sm:block">{plural(c.cell.trades, 'trade')}</span>
                    </span>
                  )}
                </div>
              ) : (
                <div key={`e${wi}-${i}`} />
              ),
            ),
            <div key={`w${wi}`} className="flex h-[52px] flex-col justify-center rounded-[5px] bg-ink-950 p-1.5 text-center type-data sm:h-[62px]">
              {wkTrades ? (
                <>
                  <span className="font-semibold">{compactMoney(wk, currency)}</span>
                  <span className="text-[11px] text-fg-3">{wkTrades}</span>
                </>
              ) : (
                <span className="text-fg-3">—</span>
              )}
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

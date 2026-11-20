import { useMemo, useState } from 'react';
import { niceStep, useWidth } from './EquityChart';
import { pct, plural, rMult } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Win rate donut                                                      */
/* ------------------------------------------------------------------ */

const DC = 70; // centre of the 140 x 140 donut
const DR = 56;

function donutArc(from: number, to: number): string {
  // from / to are fractions of the circle, starting at 12 o'clock.
  const a1 = from * Math.PI * 2 - Math.PI / 2;
  const a2 = to * Math.PI * 2 - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${(DC + DR * Math.cos(a1)).toFixed(2)} ${(DC + DR * Math.sin(a1)).toFixed(2)} A ${DR} ${DR} 0 ${large} 1 ${(DC + DR * Math.cos(a2)).toFixed(2)} ${(DC + DR * Math.sin(a2)).toFixed(2)}`;
}

/** Share of trades won, lost and closed flat, with the win rate in the middle. */
export function WinRateDonut({ wins, losses, breakeven }: { wins: number; losses: number; breakeven: number }) {
  const total = wins + losses + breakeven;
  const parts = [
    { key: 'Won', n: wins, color: 'var(--color-profit)' },
    { key: 'Lost', n: losses, color: 'var(--color-loss)' },
    { key: 'Flat', n: breakeven, color: 'var(--color-ink-600)' },
  ].filter((p) => p.n > 0);
  const gap = parts.length > 1 ? 0.012 : 0; // about 4px of surface between segments
  let at = 0;
  const arcs = parts.map((p) => {
    const from = at;
    at += p.n / total;
    return { ...p, from: from + gap / 2, to: at - gap / 2 };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={`Win rate ${pct(wins / Math.max(1, total), 0)}: ${wins} won, ${losses} lost, ${breakeven} flat`}>
        {total === 0 ? (
          <circle cx={DC} cy={DC} r={DR} fill="none" stroke="var(--color-ink-700)" strokeWidth={14} />
        ) : parts.length === 1 ? (
          <circle cx={DC} cy={DC} r={DR} fill="none" stroke={parts[0].color} strokeWidth={14}>
            <title>{`${parts[0].key}: ${parts[0].n}`}</title>
          </circle>
        ) : (
          arcs.map((a) => (
            <path key={a.key} d={donutArc(a.from, a.to)} fill="none" stroke={a.color} strokeWidth={14}>
              <title>{`${a.key}: ${a.n} (${pct(a.n / total, 0)})`}</title>
            </path>
          ))
        )}
        <text x={DC} y={DC - 2} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--color-fg)" className="type-data">
          {total ? pct(wins / total, 0) : '—'}
        </text>
        <text x={DC} y={DC + 16} textAnchor="middle" fontSize={11} fill="var(--color-fg-3)">
          win rate
        </text>
      </svg>
      <ul className="space-y-1.5 text-[13px]">
        {[
          { key: 'Won', n: wins, color: 'var(--color-profit)' },
          { key: 'Lost', n: losses, color: 'var(--color-loss)' },
          { key: 'Flat', n: breakeven, color: 'var(--color-ink-600)' },
        ].map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="w-[38px] text-fg-2">{p.key}</span>
            <span className="type-data font-semibold">{p.n}</span>
            <span className="type-data text-fg-3">{total ? pct(p.n / total, 0) : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* R-multiple distribution                                             */
/* ------------------------------------------------------------------ */

const STEP = 0.5;

interface Bin {
  lo: number;
  hi: number;
  n: number;
  openLo: boolean;
  openHi: boolean;
}

function binsFor(rs: number[]): Bin[] {
  const min = Math.min(...rs);
  const max = Math.max(...rs);
  const lo = Math.max(-3, Math.floor(min / STEP) * STEP);
  const hi = Math.min(6, Math.max(lo + STEP, Math.ceil((max + 1e-9) / STEP) * STEP));
  const bins: Bin[] = [];
  for (let a = lo; a < hi - 1e-9; a += STEP) bins.push({ lo: a, hi: a + STEP, n: 0, openLo: false, openHi: false });
  bins[0].openLo = min < lo;
  bins[bins.length - 1].openHi = max >= hi;
  for (const r of rs) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((r - lo) / STEP)));
    bins[i].n++;
  }
  return bins;
}

const rLabel = (v: number) => (v === 0 ? '0R' : `${v > 0 ? '+' : '−'}${Math.abs(v)}R`);

/** How results are spread in R: losses left of zero, wins to the right, the average marked. */
export function RHistogram({ rs, height = 190 }: { rs: number[]; height?: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bins = useMemo(() => (rs.length ? binsFor(rs) : []), [rs]);
  if (!rs.length)
    return (
      <div ref={wrap}>
        <p className="text-fg-2">Trades with a stop loss get an R multiple; their spread shows up here.</p>
      </div>
    );

  const avg = rs.reduce((a, r) => a + r, 0) / rs.length;
  const m = { l: 30, r: 10, t: 22, b: 24 };
  const W = width;
  const H = height;
  const maxN = Math.max(...bins.map((b) => b.n));
  const yStep = niceStep(maxN, 3);
  const yMax = Math.max(yStep, Math.ceil(maxN / yStep) * yStep);
  const lo = bins[0].lo;
  const hi = bins[bins.length - 1].hi;
  const x = (v: number) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r);
  const y = (n: number) => H - m.b - (n / yMax) * (H - m.t - m.b);
  const colW = (W - m.l - m.r) / bins.length;
  const barW = Math.max(2, colW - 2);
  const ticks: number[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += yStep) ticks.push(t);
  const xTicks: number[] = [];
  const every = hi - lo > 6 ? 2 : 1;
  for (let v = Math.ceil(lo); v <= hi + 1e-9; v += every) xTicks.push(v);
  const avgX = x(Math.min(hi, Math.max(lo, avg)));
  const hb = hover === null ? null : bins[hover];

  return (
    <div ref={wrap} className="relative">
      <svg width={W} height={H} role="img" aria-label={`Distribution of ${plural(rs.length, 'trade')} by R multiple; average ${rMult(avg)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--color-ink-700)" strokeOpacity={t === 0 ? 1 : 0.45} />
            <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-fg-3)" className="type-data">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - 7} textAnchor="middle" fontSize={11} fill="var(--color-fg-3)" className="type-data">
            {rLabel(v)}
          </text>
        ))}
        {bins.map((b, i) => {
          if (!b.n) return null;
          const bx = m.l + i * colW + (colW - barW) / 2;
          const top = y(b.n);
          const h = H - m.b - top;
          const r = Math.min(4, barW / 2, h);
          const fill = (b.lo + b.hi) / 2 < 0 ? 'var(--color-loss)' : 'var(--color-profit)';
          // Rounded data end, square at the baseline.
          const d = `M ${bx} ${H - m.b} V ${top + r} Q ${bx} ${top} ${bx + r} ${top} H ${bx + barW - r} Q ${bx + barW} ${top} ${bx + barW} ${top + r} V ${H - m.b} Z`;
          return <path key={i} d={d} fill={fill} opacity={hover === null || hover === i ? 1 : 0.55} />;
        })}
        <line x1={avgX} x2={avgX} y1={m.t - 6} y2={H - m.b} stroke="var(--accent-line)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={avgX} y={m.t - 10} textAnchor={avgX > W - 80 ? 'end' : avgX < 80 ? 'start' : 'middle'} fontSize={11} fontWeight={600} fill="var(--color-fg-2)" className="type-data">
          average {rMult(avg)}
        </text>
        {bins.map((_, i) => (
          <rect key={i} x={m.l + i * colW} y={m.t} width={colW} height={H - m.t - m.b} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hb && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded-[var(--radius-ctl)] border border-ink-600 bg-ink-900/95 px-3 py-2 text-[12px] shadow-xl"
          style={{ left: Math.min(W - 160, Math.max(0, m.l + hover * colW + colW / 2 - 75)), top: Math.max(0, y(hb.n) - 64) }}
        >
          <div className="font-semibold type-data">
            {hb.openLo ? `${rLabel(hb.hi)} or worse` : hb.openHi ? `${rLabel(hb.lo)} or better` : `${rLabel(hb.lo)} to ${rLabel(hb.hi)}`}
          </div>
          <div className="text-fg-2">
            {plural(hb.n, 'trade')}, {pct(hb.n / rs.length, 0)} of the total
          </div>
        </div>
      )}
    </div>
  );
}

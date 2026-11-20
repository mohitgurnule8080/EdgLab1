import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EquityPoint } from '../core/stats';
import { formatDate } from '../core/time';
import { compactMoney, money, rMult, signed } from '../lib/format';

export function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Cumulative result after each trade. Fill above zero is profit-tinted, below zero loss-tinted. */
export function EquityChart({ points, mode, currency, tz, height = 260 }: { points: EquityPoint[]; mode: 'money' | 'r'; currency: string; tz: string; height?: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const m = { l: 58, r: 14, t: 14, b: 26 };
  const W = width;
  const H = height;
  const val = (p: EquityPoint) => (mode === 'money' ? p.pnl : p.r);

  const geo = useMemo(() => {
    const vals = points.map(val);
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const padY = (hi - lo) * 0.08;
    lo -= padY;
    hi += padY;
    const step = niceStep(hi - lo, 4);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    const n = Math.max(1, points.length - 1);
    const x = (i: number) => m.l + (i / n) * (W - m.l - m.r);
    const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val(p)).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
    return { x, y, line, area, ticks, n };
  }, [points, mode, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (v: number) => (mode === 'money' ? compactMoney(v, currency) : signed(v, 1, 'R'));
  const y0 = geo.y(0);
  const hp = hover !== null ? points[hover] : null;
  const prev = hover !== null && hover > 0 ? points[hover - 1] : null;
  const xTicks = useMemo(() => {
    const n = points.length - 1;
    if (n < 1) return [];
    const step = Math.max(1, Math.round(niceStep(n, 5)));
    const out: number[] = [];
    for (let i = 0; i <= n; i += step) out.push(i);
    return out;
  }, [points.length]);

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg width={W} height={H} role="img" aria-label={`Equity curve over ${points.length - 1} trades`} className="block">
        <defs>
          <clipPath id={`${clipId}-up`}>
            <rect x={0} y={0} width={W} height={Math.max(0, y0)} />
          </clipPath>
          <clipPath id={`${clipId}-dn`}>
            <rect x={0} y={y0} width={W} height={Math.max(0, H - y0)} />
          </clipPath>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--color-ink-700)" strokeOpacity={t === 0 ? 1 : 0.45} strokeWidth={1} />
            <text x={m.l - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-fg-3)" className="type-data">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.filter((i) => geo.x(i) < W - 100).map((i) => (
          <text key={i} x={geo.x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-fg-3)" className="type-data">
            {i}
          </text>
        ))}
        <path d={geo.area} fill="var(--color-profit)" fillOpacity={0.16} clipPath={`url(#${clipId}-up)`} />
        <path d={geo.area} fill="var(--color-loss)" fillOpacity={0.18} clipPath={`url(#${clipId}-dn)`} />
        <path d={geo.line} fill="none" stroke="var(--accent-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && hover !== null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={m.t} y2={H - m.b} stroke="var(--color-fg-3)" strokeDasharray="3 3" />
            <circle cx={geo.x(hover)} cy={geo.y(val(hp))} r={5} fill="var(--accent-line)" stroke="var(--color-ink-900)" strokeWidth={2} />
          </g>
        )}
        <rect
          x={m.l}
          y={m.t}
          width={Math.max(0, W - m.l - m.r)}
          height={Math.max(0, H - m.t - m.b)}
          fill="transparent"
          onMouseMove={(e) => {
            const rect = (e.target as SVGRectElement).getBoundingClientRect();
            const rel = (e.clientX - rect.left) / rect.width;
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * geo.n))));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      <div className="pointer-events-none absolute bottom-[6px] right-[14px] text-[11px] text-fg-3">Trade number</div>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-[var(--radius-ctl)] border border-ink-600 bg-ink-900/95 px-3 py-2 text-[12px] shadow-xl"
          style={{ left: Math.min(W - 180, Math.max(0, geo.x(hover) + 12)), top: 8 }}
        >
          <div className="text-fg-3">{hover === 0 ? 'Start' : `Trade ${hover}, ${formatDate(hp.time, tz)}`}</div>
          <div className="type-data mt-0.5 text-[14px] font-semibold">{mode === 'money' ? money(hp.pnl, currency, { signed: true }) : rMult(hp.r)}</div>
          {prev && (
            <div className="type-data text-fg-2">
              This trade {mode === 'money' ? money(hp.pnl - prev.pnl, currency, { signed: true }) : rMult(hp.r - prev.r)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

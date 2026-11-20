import type { ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { AccountControls, LogoMark, NAV } from '../components/AppChrome';
import { TIMEFRAMES, tfLabel } from '../core/time';
import type { IndicatorConfig, MaKind } from '../core/indicators';
import { chartPalette } from '../lib/theme';
import { Dropdown, MenuItem } from './Dropdown';
import { IChevronDown, IIndicators, IMenu, ISearch } from './toolIcons';
import { IconReplay as IReplayIcon } from '../components/icons';

/** TradingView-style short labels: 1m, 15m, 1h, 4h, D, W. */
export function tfShort(sec: number): string {
  if (sec < 3600) return `${sec / 60}m`;
  if (sec < 86_400) return `${sec / 3600}h`;
  return sec === 86_400 ? 'D' : 'W';
}

export function TopBar(props: {
  symbol: string;
  description: string;
  onSymbolSearch(): void;
  tfSec: number;
  baseTf: number;
  onTf(sec: number): void;
  indicators: IndicatorConfig;
  onIndicators(next: IndicatorConfig): void;
  replay: 'off' | 'selecting' | 'on';
  onReplay(): void;
  status?: ReactNode;
}) {
  const { go } = useApp();
  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden rounded-[var(--radius-panel)] border border-ink-700 bg-ink-900 px-1.5">
      <Dropdown
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label="Menu" className="flex h-8 items-center gap-1.5 rounded-[var(--radius-ctl)] px-1.5 text-fg-2 transition hover:bg-ink-850 hover:text-fg">
            <LogoMark size={22} />
            <IMenu size={16} />
          </button>
        )}
      >
        {(close) => (
          <div role="menu">
            {NAV.map((n) => (
              <MenuItem
                key={n.page}
                active={n.page === 'backtest'}
                onClick={() => {
                  close();
                  go(n.page);
                }}
              >
                <n.Icon size={16} />
                {n.label}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>

      <Divider />

      <button
        type="button"
        onClick={props.onSymbolSearch}
        className="flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-ctl)] px-2 transition hover:bg-ink-850"
        title={props.description}
        aria-label={`Symbol ${props.symbol}. Change symbol`}
      >
        <ISearch size={16} className="text-fg-3" />
        <span className="text-[14px] font-semibold">{props.symbol}</span>
      </button>

      <Divider />

      <div className="flex shrink-0 items-center" role="radiogroup" aria-label="Timeframe">
        {TIMEFRAMES.map((t) => {
          const enabled = t.sec >= props.baseTf;
          const active = t.sec === props.tfSec;
          return (
            <button
              key={t.sec}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!enabled}
              onClick={() => props.onTf(t.sec)}
              title={enabled ? tfLabel(t.sec) : `Needs ${tfLabel(t.sec)} or lower candles`}
              className={`h-8 min-w-[34px] rounded-[var(--radius-ctl)] px-1.5 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-30 ${active ? 'font-semibold text-brass-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
            >
              {tfShort(t.sec)}
            </button>
          );
        })}
      </div>

      <Divider />

      <IndicatorsMenu value={props.indicators} onChange={props.onIndicators} />

      <Divider />

      <button
        type="button"
        onClick={props.onReplay}
        aria-pressed={props.replay !== 'off'}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-ctl)] px-2 text-[13px] transition ${props.replay !== 'off' ? 'bg-brass/15 text-brass-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
        title={props.replay === 'on' ? 'Leave the replay (it stays saved)' : props.replay === 'selecting' ? 'Cancel' : 'Replay the market from a candle you pick'}
      >
        <IReplayIcon size={18} />
        {props.replay === 'on' ? 'Exit replay' : props.replay === 'selecting' ? 'Cancel replay' : 'Replay'}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
        {props.status}
        <AccountControls compact />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-700" aria-hidden />;
}

function IndicatorsMenu({ value, onChange }: { value: IndicatorConfig; onChange(v: IndicatorConfig): void }) {
  const pal = chartPalette();
  const count = value.ma.filter((m) => m.on).length + (value.bb.on ? 1 : 0) + (value.rsi.on ? 1 : 0) + (value.volume ? 1 : 0);
  const setMa = (i: number, patch: Partial<IndicatorConfig['ma'][number]>) => {
    const ma = value.ma.map((m, j) => (j === i ? { ...m, ...patch } : m)) as IndicatorConfig['ma'];
    onChange({ ...value, ma });
  };
  const num = (v: string, min: number) => Math.max(min, Math.min(500, Math.round(Number(v) || min)));
  return (
    <Dropdown
      panelClass="w-[300px] p-2"
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-ctl)] px-2 text-[13px] text-fg-2 transition hover:bg-ink-850 hover:text-fg">
          <IIndicators size={18} />
          Indicators
          {count > 0 && <span className="type-data rounded bg-ink-800 px-1.5 text-[11px] text-fg">{count}</span>}
          <IChevronDown size={14} />
        </button>
      )}
    >
      {() => (
        <div className="space-y-1 text-[13px]">
          {value.ma.map((m, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[var(--radius-ctl)] px-1.5 py-1 hover:bg-ink-850">
              <input type="checkbox" checked={m.on} onChange={(e) => setMa(i, { on: e.target.checked })} aria-label={`Moving average ${i + 1}`} className="accent-[var(--color-brass)]" />
              <span className="h-[3px] w-4 rounded-full" style={{ background: pal.ma[i] }} aria-hidden />
              <select className="field h-7 min-h-0 w-[72px] py-0 pl-2 text-[12px]" value={m.kind} onChange={(e) => setMa(i, { kind: e.target.value as MaKind })} aria-label="Average type">
                <option value="ema">EMA</option>
                <option value="sma">SMA</option>
              </select>
              <input type="number" min={2} max={500} className="field type-data h-7 min-h-0 w-[64px] py-0 text-[12px]" value={m.period} onChange={(e) => setMa(i, { period: num(e.target.value, 2) })} aria-label="Length" />
              <span className="text-fg-3">length</span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-[var(--radius-ctl)] px-1.5 py-1 hover:bg-ink-850">
            <input type="checkbox" checked={value.bb.on} onChange={(e) => onChange({ ...value, bb: { ...value.bb, on: e.target.checked } })} id="ind-bb" className="accent-[var(--color-brass)]" />
            <label htmlFor="ind-bb" className="mr-auto">
              Bollinger Bands
            </label>
            <input type="number" className="field type-data h-7 min-h-0 w-[52px] py-0 text-[12px]" value={value.bb.period} onChange={(e) => onChange({ ...value, bb: { ...value.bb, period: num(e.target.value, 2) } })} aria-label="Bollinger length" />
            <input type="number" step="0.5" className="field type-data h-7 min-h-0 w-[52px] py-0 text-[12px]" value={value.bb.mult} onChange={(e) => onChange({ ...value, bb: { ...value.bb, mult: Math.max(0.5, Number(e.target.value) || 2) } })} aria-label="Standard deviations" />
          </div>
          <div className="flex items-center gap-2 rounded-[var(--radius-ctl)] px-1.5 py-1 hover:bg-ink-850">
            <input type="checkbox" checked={value.rsi.on} onChange={(e) => onChange({ ...value, rsi: { ...value.rsi, on: e.target.checked } })} id="ind-rsi" className="accent-[var(--color-brass)]" />
            <label htmlFor="ind-rsi" className="mr-auto">
              RSI <span className="text-fg-3">(own pane)</span>
            </label>
            <input type="number" className="field type-data h-7 min-h-0 w-[52px] py-0 text-[12px]" value={value.rsi.period} onChange={(e) => onChange({ ...value, rsi: { ...value.rsi, period: num(e.target.value, 2) } })} aria-label="RSI length" />
          </div>
          <label className="flex items-center gap-2 rounded-[var(--radius-ctl)] px-1.5 py-1.5 hover:bg-ink-850">
            <input type="checkbox" checked={value.volume} onChange={(e) => onChange({ ...value, volume: e.target.checked })} className="accent-[var(--color-brass)]" />
            Volume
          </label>
        </div>
      )}
    </Dropdown>
  );
}

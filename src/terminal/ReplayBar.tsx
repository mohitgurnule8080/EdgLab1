import { pct } from '../lib/format';
import { Dropdown, MenuItem } from './Dropdown';
import { IChevronDown, IFastForward, IForward, IPause, IPlay, IStop } from './toolIcons';

export const SPEEDS = [1, 2, 4, 8, 16];

function BarButton({ label, onClick, disabled, children, primary = false, keys }: { label: string; onClick(): void; disabled?: boolean; children: React.ReactNode; primary?: boolean; keys?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={keys ? `${label} (${keys})` : label}
      aria-label={label}
      aria-keyshortcuts={keys}
      className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] px-2 text-[13px] transition disabled:opacity-40 ${primary ? 'bg-brass text-brass-ink hover:brightness-110' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

/** Floating replay controls at the bottom of the chart, like a market replay toolbar. */
export function ReplayBar(p: {
  playing: boolean;
  onPlay(): void;
  onStep(): void;
  onStepMany(): void;
  speed: number;
  onSpeed(s: number): void;
  unitLabel?: { bar: string; base: string };
  unit: 'bar' | 'base';
  onUnit(u: 'bar' | 'base'): void;
  onJump(target: 'london' | 'ny' | 'day'): void;
  progress: number;
  atEnd: boolean;
  onExit(): void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900/95 p-1 shadow-2xl backdrop-blur" role="toolbar" aria-label="Replay controls">
      <BarButton label={p.playing ? 'Pause' : 'Play'} onClick={p.onPlay} disabled={p.atEnd} primary keys="Space">
        {p.playing ? <IPause size={16} /> : <IPlay size={16} />}
      </BarButton>
      <BarButton label="Forward one candle" onClick={p.onStep} disabled={p.atEnd} keys="ArrowRight">
        <IForward size={18} />
      </BarButton>
      <BarButton label="Forward 10 candles" onClick={p.onStepMany} disabled={p.atEnd} keys="Shift+ArrowRight">
        <IFastForward size={18} />
      </BarButton>
      <Dropdown
        up
        panelClass="min-w-[120px]"
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} title="Replay speed" className="type-data flex h-9 items-center gap-1 rounded-[var(--radius-ctl)] px-2 text-[13px] text-fg-2 hover:bg-ink-850 hover:text-fg">
            {p.speed}x
            <IChevronDown size={14} />
          </button>
        )}
      >
        {(close) =>
          SPEEDS.map((s) => (
            <MenuItem
              key={s}
              active={s === p.speed}
              onClick={() => {
                p.onSpeed(s);
                close();
              }}
              hint={`${s} per second`}
            >
              {s}x
            </MenuItem>
          ))
        }
      </Dropdown>
      {p.unitLabel && (
        <Dropdown
          up
          panelClass="min-w-[190px]"
          trigger={(open, toggle) => (
            <button type="button" onClick={toggle} aria-expanded={open} title="What one step reveals" className="flex h-9 items-center gap-1 rounded-[var(--radius-ctl)] px-2 text-[13px] text-fg-2 hover:bg-ink-850 hover:text-fg">
              Step: {p.unit === 'bar' ? p.unitLabel!.bar : p.unitLabel!.base}
              <IChevronDown size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem active={p.unit === 'bar'} onClick={() => { p.onUnit('bar'); close(); }}>
                One {p.unitLabel!.bar} candle
              </MenuItem>
              <MenuItem active={p.unit === 'base'} onClick={() => { p.onUnit('base'); close(); }}>
                One {p.unitLabel!.base} candle (watch it form)
              </MenuItem>
            </>
          )}
        </Dropdown>
      )}
      <Dropdown
        up
        panelClass="min-w-[190px]"
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} disabled={p.atEnd} className="flex h-9 items-center gap-1 rounded-[var(--radius-ctl)] px-2 text-[13px] text-fg-2 hover:bg-ink-850 hover:text-fg disabled:opacity-40">
            Jump to
            <IChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem onClick={() => { p.onJump('london'); close(); }}>Next London open</MenuItem>
            <MenuItem onClick={() => { p.onJump('ny'); close(); }}>Next New York open</MenuItem>
            <MenuItem onClick={() => { p.onJump('day'); close(); }}>Next day</MenuItem>
          </>
        )}
      </Dropdown>
      <div className="mx-2 hidden items-center gap-2 text-[12px] text-fg-3 sm:flex" title="How far through the data the replay is">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-800" aria-hidden>
          <div className="h-full bg-brass" style={{ width: `${Math.min(100, p.progress * 100)}%` }} />
        </div>
        <span className="type-data">{pct(p.progress, 0)}</span>
      </div>
      <BarButton label="Exit replay (it stays saved)" onClick={p.onExit}>
        <IStop size={14} />
      </BarButton>
    </div>
  );
}

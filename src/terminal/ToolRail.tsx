import type { ReactNode } from 'react';
import type { ToolId } from './drawings';
import { ICursor, IEye, IEyeOff, IFib, IHLine, ILong, IMagnet, IMeasure, IRay, IRect, IShort, IStay, IText, ITrash, ITrend, IVLine } from './toolIcons';

export const TOOLS: { id: ToolId; label: string; key?: string; Icon: (p: { size?: number }) => ReactNode }[] = [
  { id: 'cursor', label: 'Cursor', key: 'Esc', Icon: ICursor },
  { id: 'trend', label: 'Trend line', key: 'Alt+T', Icon: ITrend },
  { id: 'ray', label: 'Ray', Icon: IRay },
  { id: 'hline', label: 'Horizontal line', key: 'Alt+H', Icon: IHLine },
  { id: 'vline', label: 'Vertical line', key: 'Alt+V', Icon: IVLine },
  { id: 'rect', label: 'Rectangle', Icon: IRect },
  { id: 'fib', label: 'Fib retracement', key: 'Alt+F', Icon: IFib },
  { id: 'long', label: 'Long position', Icon: ILong },
  { id: 'short', label: 'Short position', Icon: IShort },
  { id: 'measure', label: 'Measure', Icon: IMeasure },
  { id: 'text', label: 'Text note', Icon: IText },
];

function RailButton({ label, active, onClick, children, danger = false }: { label: string; active?: boolean; onClick(): void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-ctl)] transition ${active ? 'bg-brass/15 text-brass-fg' : danger ? 'text-fg-2 hover:bg-loss/15 hover:text-loss-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

/** The drawing toolbar on the left of the chart. */
export function ToolRail(p: {
  tool: ToolId;
  setTool(t: ToolId): void;
  magnet: boolean;
  setMagnet(v: boolean): void;
  stay: boolean;
  setStay(v: boolean): void;
  hidden: boolean;
  setHidden(v: boolean): void;
  onClear(): void;
  count: number;
}) {
  return (
    <nav aria-label="Drawing tools" className="relative flex shrink-0 flex-row gap-0.5 overflow-auto rounded-[var(--radius-panel)] border border-ink-700 bg-ink-900 p-1 lg:w-[46px] lg:flex-col">
      {TOOLS.map((t) => (
        <RailButton key={t.id} label={t.key ? `${t.label} (${t.key})` : t.label} active={p.tool === t.id} onClick={() => p.setTool(t.id)}>
          <t.Icon size={20} />
        </RailButton>
      ))}
      <span className="mx-1 my-1 h-px w-auto shrink-0 bg-ink-700 max-lg:mx-1 max-lg:h-auto max-lg:w-px" aria-hidden />
      <RailButton label={p.magnet ? 'Magnet on: points snap to open, high, low or close' : 'Magnet: snap points to candle prices'} active={p.magnet} onClick={() => p.setMagnet(!p.magnet)}>
        <IMagnet size={20} />
      </RailButton>
      <RailButton label={p.stay ? 'Stay in drawing mode: on' : 'Stay in drawing mode'} active={p.stay} onClick={() => p.setStay(!p.stay)}>
        <IStay size={20} />
      </RailButton>
      <RailButton label={p.hidden ? 'Show drawings' : 'Hide drawings'} active={p.hidden} onClick={() => p.setHidden(!p.hidden)}>
        {p.hidden ? <IEyeOff size={20} /> : <IEye size={20} />}
      </RailButton>
      <RailButton label={`Remove all drawings${p.count ? ` (${p.count})` : ''}`} danger onClick={p.onClear}>
        <ITrash size={20} />
      </RailButton>
    </nav>
  );
}

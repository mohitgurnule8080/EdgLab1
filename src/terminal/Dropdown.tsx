import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A trigger plus a panel that closes on outside click or Escape. The panel is rendered in a
 * portal with fixed positioning, so toolbars that scroll sideways never clip it.
 */
export function Dropdown({
  trigger,
  children,
  align = 'left',
  panelClass = '',
  up = false,
}: {
  trigger(open: boolean, toggle: () => void): ReactNode;
  children(close: () => void): ReactNode;
  align?: 'left' | 'right';
  panelClass?: string;
  /** Open above the trigger (for toolbars at the bottom of the screen). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const s: CSSProperties = { position: 'fixed' };
    if (up) s.bottom = window.innerHeight - r.top + 6;
    else s.top = r.bottom + 6;
    if (align === 'right') s.right = Math.max(8, window.innerWidth - r.right);
    else s.left = Math.max(8, Math.min(r.left, window.innerWidth - 220));
    setPos(s);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={box} className="relative shrink-0">
      {trigger(open, () => setOpen((o) => !o))}
      {open &&
        createPortal(
          <div ref={panel} style={pos} className={`z-[90] max-h-[70vh] min-w-[200px] overflow-y-auto rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900 p-1 shadow-2xl ${panelClass}`}>
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({ children, onClick, active = false, disabled = false, hint }: { children: ReactNode; onClick(): void; active?: boolean; disabled?: boolean; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-ctl)] px-2.5 py-1.5 text-left text-[13px] transition disabled:opacity-40 ${active ? 'bg-ink-850 text-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
    >
      {children}
      {hint && <span className="ml-auto pl-4 text-[12px] text-fg-3">{hint}</span>}
    </button>
  );
}

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';

type Variant = 'primary' | 'buy' | 'sell' | 'outline' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brass text-brass-ink hover:brightness-110 font-semibold',
  buy: 'bg-profit text-profit-ink hover:brightness-110 font-semibold',
  sell: 'bg-loss-strong text-white hover:brightness-110 font-semibold',
  outline: 'border border-ink-600 text-fg hover:border-fg-3 hover:bg-ink-850',
  ghost: 'text-fg-2 hover:text-fg hover:bg-ink-850',
  danger: 'border border-loss/60 text-loss-fg hover:bg-loss/15',
};

export function Button({
  variant = 'outline',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-9 px-3.5', lg: 'h-11 px-4 text-[15px]' };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] whitespace-nowrap transition disabled:opacity-40 disabled:pointer-events-none ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[13px] text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
}: {
  value: T;
  options: { value: NoInfer<T>; label: ReactNode; className?: string }[];
  onChange(v: NoInfer<T>): void;
  size?: 'sm' | 'md';
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-[var(--radius-ctl)] border border-ink-700 bg-ink-950 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-[4px] ${size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3'} transition ${
              active ? o.className ?? 'seg-on' : 'text-fg-2 hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({ title, actions, children, className = '', bodyClass = 'p-4' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-[70ch]">
        <h1 className="type-display text-[28px] leading-tight">{title}</h1>
        {intro && <p className="mt-1 text-fg-2">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-ink-600 p-6">
      <h3 className="text-[16px] font-semibold">{title}</h3>
      {children && <div className="max-w-[62ch] text-fg-2">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Side sheet on desktop, full-screen sheet on mobile. Closes on Escape and backdrop click. */
export function Sheet({ open, title, onClose, children, footer, width = 'max-w-[560px]' }: { open: boolean; title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex h-full w-full ${width} flex-col border-l border-ink-700 bg-ink-900 shadow-2xl outline-none`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-5 py-4">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Stars({ value, onChange, size = 18 }: { value: number; onChange?(v: number): void; size?: number }) {
  return (
    <div className="inline-flex items-center gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label="Execution rating">
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= value;
        const star = (
          <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
            <path
              d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z"
              fill={on ? 'var(--color-brass)' : 'none'}
              stroke={on ? 'var(--color-brass)' : 'var(--color-ink-600)'}
              strokeWidth="1.4"
            />
          </svg>
        );
        return onChange ? (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} of 5`} onClick={() => onChange(value === i ? 0 : i)} className="rounded p-0.5">
            {star}
          </button>
        ) : (
          <span key={i}>{star}</span>
        );
      })}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[13px] transition ${active ? 'border-brass bg-brass/15 text-fg' : 'border-ink-600 text-fg-2 hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,400px)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-5 sm:translate-x-0" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-[var(--radius-ctl)] border px-3.5 py-2.5 shadow-xl ${
            t.tone === 'error' ? 'border-loss/60 toast-error' : t.tone === 'success' ? 'border-profit/50 toast-success' : 'border-ink-600 bg-ink-850'
          }`}
        >
          <span>{t.message}</span>
          <button type="button" className="text-fg-3 hover:text-fg" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function SideBadge({ side }: { side: 'buy' | 'sell' }) {
  return (
    <span className={`inline-flex h-5 items-center rounded px-1.5 text-[12px] font-semibold ${side === 'buy' ? 'bg-profit/20 text-profit-fg' : 'bg-loss/20 text-loss-fg'}`}>
      {side === 'buy' ? 'Long' : 'Short'}
    </span>
  );
}

/** In-page confirmation (browser confirm() is blocked in sandboxed hosts). */
export function ConfirmDialog() {
  const { confirmState } = useApp();
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirmState) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && confirmState.resolve(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState]);
  if (!confirmState) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-scrim" onClick={() => confirmState.resolve(false)} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="relative w-full max-w-[420px] rounded-[var(--radius-panel)] border border-ink-600 bg-ink-900 p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-[17px] font-semibold">
          {confirmState.title}
        </h2>
        {confirmState.body && <p className="mt-2 text-fg-2">{confirmState.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => confirmState.resolve(false)}>
            Cancel
          </Button>
          <button
            ref={okRef}
            type="button"
            onClick={() => confirmState.resolve(true)}
            className={`inline-flex h-9 items-center rounded-[var(--radius-ctl)] px-3.5 font-semibold ${confirmState.danger ? 'bg-loss-strong text-white' : 'bg-brass text-brass-ink'}`}
          >
            {confirmState.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

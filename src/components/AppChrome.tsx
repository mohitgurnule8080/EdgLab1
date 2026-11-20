import { useApp, type Page } from '../state/AppContext';
import { ThemeToggle } from './ThemeToggle';
import { IconChart, IconDashboard, IconData, IconJournal, IconMarkets, IconSettings } from './icons';

export const NAV: { page: Page; label: string; Icon: typeof IconDashboard }[] = [
  { page: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { page: 'backtest', label: 'Chart', Icon: IconChart },
  { page: 'markets', label: 'Markets', Icon: IconMarkets },
  { page: 'journal', label: 'Journal', Icon: IconJournal },
  { page: 'data', label: 'Data', Icon: IconData },
  { page: 'settings', label: 'Settings', Icon: IconSettings },
];

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="6" y="10" width="6" height="12" rx="1.5" fill="var(--color-loss)" />
      <path d="M9 6v4M9 22v4" stroke="var(--color-loss)" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="19" y="7" width="6" height="15" rx="1.5" fill="var(--color-profit)" />
      <path d="M22 3v4M22 22v6" stroke="var(--color-profit)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <LogoMark />
      <span className="type-display text-[19px] tracking-tight">EdgeLab</span>
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function HideAmountsButton({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings } = useApp();
  const hidden = settings.hideAmounts;
  return (
    <button
      type="button"
      onClick={() => updateSettings({ hideAmounts: !hidden })}
      aria-pressed={hidden}
      title={hidden ? 'Show amounts' : 'Hide amounts (for screen recording)'}
      className={`flex ${compact ? 'h-8 w-8' : 'h-9 w-9'} items-center justify-center rounded-[var(--radius-ctl)] transition ${hidden ? 'bg-brass/15 text-brass-fg' : 'text-fg-2 hover:bg-ink-850 hover:text-fg'}`}
    >
      <EyeIcon off={hidden} />
      <span className="sr-only">{hidden ? 'Show amounts' : 'Hide amounts'}</span>
    </button>
  );
}

export function AccountControls({ compact = false }: { compact?: boolean }) {
  const { account } = useApp();
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle className={compact ? '!h-8 !w-8' : ''} />
      <HideAmountsButton compact={compact} />
      <div className={`hidden text-right leading-tight ${compact ? 'xl:block' : 'md:block'}`}>
        <div className="max-w-[140px] truncate text-[13px] font-medium">{account.kind === 'account' ? account.profile?.name : 'Guest'}</div>
        <div className="text-[11px] text-fg-3">{account.kind === 'account' ? 'Encrypted' : 'Not encrypted'}</div>
      </div>
      <button
        type="button"
        onClick={() => account.lock('manual')}
        className={`${compact ? 'h-8' : 'h-9'} rounded-[var(--radius-ctl)] border border-ink-600 px-3 text-[13px] text-fg-2 transition hover:border-fg-3 hover:text-fg`}
      >
        {account.kind === 'account' ? 'Lock' : 'Sign in'}
      </button>
    </div>
  );
}

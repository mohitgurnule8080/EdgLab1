import { useTheme } from '../lib/theme';
import { IconMoon, IconSun } from './icons';

/** Day / night switch. A "match device" choice in Settings is replaced by an explicit one here. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setPref } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Switch to day mode' : 'Switch to night mode';
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] text-fg-2 transition hover:bg-ink-850 hover:text-fg ${className}`}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}

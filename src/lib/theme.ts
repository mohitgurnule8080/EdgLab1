import { useSyncExternalStore } from 'react';

/**
 * Day / night theme. The choice is kept per device (it applies on the sign-in screen too)
 * and "system" follows the operating system's light or dark setting.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'edgelab:theme';
const EVENT = 'edgelab:theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked */
  }
  return 'dark';
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(pref: ThemePref = getThemePref()): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f5f9' : '#0c1220');
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* keep it for this visit only */
  }
  current = pref;
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

let current: ThemePref = getThemePref();

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  const onSystem = () => {
    if (current === 'system') {
      applyTheme('system');
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  mq?.addEventListener?.('change', onSystem);
  return () => {
    window.removeEventListener(EVENT, cb);
    mq?.removeEventListener?.('change', onSystem);
  };
}

/** Current theme preference and the resolved theme; re-renders on change. */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref(p: ThemePref): void } {
  const snapshot = useSyncExternalStore(subscribe, () => `${current}:${resolveTheme(current)}`);
  const [pref, theme] = snapshot.split(':') as [ThemePref, Theme];
  return { pref, theme, setPref: setThemePref };
}

/** Read a design token (e.g. "fg-2") as a colour string, for canvas charts. */
export function tokenColor(name: string): string {
  return cssVar(`--color-${name}`, '#888888');
}

function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** "#rrggbb" plus an alpha, as rgba() (the chart library does not read 8-digit hex everywhere). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface ChartPalette {
  bg: string;
  grid: string;
  cross: string;
  label: string;
  border: string;
  text: string;
  up: string;
  down: string;
  exit: string;
  pending: string;
  draft: string;
  accent: string;
  ma: [string, string, string];
  band: string;
  surface: string;
  fg: string;
}

/** Colours for the canvas candle chart, read from the active theme. */
export function chartPalette(): ChartPalette {
  return {
    bg: cssVar('--chart-bg', '#0c1220'),
    grid: cssVar('--chart-grid', 'rgba(38, 50, 76, 0.5)'),
    cross: cssVar('--chart-cross', '#5b6886'),
    label: cssVar('--chart-label', '#26324c'),
    border: cssVar('--chart-border', '#26324c'),
    text: cssVar('--chart-text', '#8592aa'),
    up: cssVar('--chart-up', '#23aaa5'),
    down: cssVar('--chart-down', '#cf4468'),
    exit: cssVar('--chart-exit', '#a9b3c7'),
    pending: cssVar('--chart-pending', '#8da2fb'),
    draft: cssVar('--chart-draft', '#e3a53c'),
    accent: cssVar('--accent-line', '#e3a53c'),
    ma: [cssVar('--session-asia', '#2563c9'), cssVar('--session-london', '#c98500'), cssVar('--session-ny', '#9085e9')],
    band: cssVar('--color-fg-3', '#8592aa'),
    surface: cssVar('--color-ink-900', '#121a2b'),
    fg: cssVar('--color-fg', '#e7ebf3'),
  };
}

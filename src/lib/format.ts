const moneyFormatters = new Map<string, Intl.NumberFormat>();

// Privacy mode: when on, every money amount renders as a mask. R multiples, pips and
// percentages stay visible, so charts and statistics remain useful on a shared screen.
let hideAmounts = false;
export const MASK = '•••••';
export function setHideAmounts(on: boolean): void {
  hideAmounts = on;
}
export function amountsHidden(): boolean {
  return hideAmounts;
}

function moneyFormatter(ccy: string, decimals: number): Intl.NumberFormat {
  const key = `${ccy}:${decimals}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(ccy === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: ccy,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    moneyFormatters.set(key, f);
  }
  return f;
}

/** "$1,234.50", or "+$1,234.50" / "−$80.00" with `signed`. Uses a true minus sign. */
export function money(v: number, ccy = 'USD', opts: { signed?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(v)) return '—';
  if (hideAmounts) return MASK;
  const decimals = opts.decimals ?? (Math.abs(v) >= 10_000 ? 0 : 2);
  const s = moneyFormatter(ccy, decimals).format(Math.abs(v));
  if (v < 0 && Math.abs(v) >= 0.5 * 10 ** -decimals) return `−${s}`;
  if (opts.signed && v > 0) return `+${s}`;
  return s;
}

export function compactMoney(v: number, ccy = 'USD'): string {
  if (!Number.isFinite(v)) return '—';
  if (hideAmounts) return '•••';
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 10_000) body = `${(abs / 1000).toFixed(0)}k`;
  else if (abs >= 1000) body = `${(abs / 1000).toFixed(1)}k`;
  else body = abs.toFixed(0);
  const symbol = moneyFormatter(ccy, 0).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';
  const sign = v < 0 && body !== '0' ? '−' : v > 0 ? '+' : '';
  return `${sign}${symbol}${body}`;
}

export function price(v: number | undefined, digits: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function signed(v: number, decimals = 1, suffix = ''): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(decimals));
  if (r === 0) return `0${decimals ? '.' + '0'.repeat(decimals) : ''}${suffix}`;
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals)}${suffix}`;
}

export function rMult(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return signed(v, decimals, 'R');
}

export function pct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

export function ratio(v: number, decimals = 2): string {
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}

export function lots(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Tailwind text class for a profit / loss number. */
export function pnlClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-fg-2';
  return v > 0 ? 'text-profit-fg' : 'text-loss-fg';
}

export function uid(prefix = ''): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

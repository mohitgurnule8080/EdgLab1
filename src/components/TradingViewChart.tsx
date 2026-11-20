import { useEffect, useRef, useState, type RefObject } from 'react';
import { chartPalette, useTheme, withAlpha, type Theme } from '../lib/theme';
import type { WatchItem } from '../store/db';

const TV_CHART = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const TV_TAPE = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';

// Browsers report some zones by their old names; TradingView expects the current ones.
const TV_ZONES: Record<string, string> = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon' };

type WidgetState = 'loading' | 'ready' | 'failed' | 'blocked';

/** True when running inside a sandboxed host that blocks outside scripts (a Claude artifact). */
export function inSandboxHost(): boolean {
  return typeof (globalThis as { claude?: unknown }).claude !== 'undefined';
}

/** Mounts one of TradingView's embed widgets into `box`, re-mounting whenever `key` changes. */
function useTradingViewWidget(box: RefObject<HTMLDivElement | null>, src: string, config: () => object, key: string): WidgetState {
  const [state, setState] = useState<WidgetState>(inSandboxHost() ? 'blocked' : 'loading');
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (inSandboxHost() || !box.current) return;
    const container = box.current;
    setState('loading');
    container.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = src;
    script.async = true;
    script.innerHTML = JSON.stringify(configRef.current());
    script.onerror = () => setState('failed');
    container.appendChild(widget);
    container.appendChild(script);
    const poll = setInterval(() => {
      if (container.querySelector('iframe')) {
        setState('ready');
        clearInterval(poll);
      }
    }, 300);
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      if (!container.querySelector('iframe')) setState('failed');
    }, 15_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
      container.innerHTML = '';
    };
  }, [key, src]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

function surface(theme: Theme) {
  const pal = chartPalette();
  return { theme, backgroundColor: withAlpha(pal.bg, 1), gridColor: pal.grid };
}

/**
 * TradingView's free Advanced Real-Time Chart widget: live prices, drawing tools and a
 * watchlist panel for any TradingView symbol. EdgeLab only embeds it; the data stays inside
 * TradingView's frame (use the sync panel to bring candles into a backtest).
 */
export function TradingViewChart({ symbol, watchlist, tz, interval = '15' }: { symbol: string; watchlist: string[]; tz: string; interval?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const state = useTradingViewWidget(
    box,
    TV_CHART,
    () => ({
      autosize: true,
      symbol,
      interval,
      timezone: TV_ZONES[tz] ?? tz,
      ...surface(theme),
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      watchlist,
      withdateranges: true,
      hide_side_toolbar: false,
      details: false,
      hotlist: false,
      calendar: false,
      save_image: false,
      support_host: 'https://www.tradingview.com',
    }),
    JSON.stringify({ symbol, watchlist, tz, interval, theme }),
  );

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="tradingview-widget-container absolute inset-0" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          {state === 'loading' ? (
            <p className="text-fg-3">Loading the live chart…</p>
          ) : (
            <div className="max-w-[46ch] text-center">
              <p className="font-semibold">{state === 'blocked' ? 'Live charts open in your own copy of EdgeLab' : 'The live chart did not load'}</p>
              <p className="mt-2 text-[14px] text-fg-2">
                {state === 'blocked'
                  ? 'This preview page is not allowed to contact TradingView or other sites. Run EdgeLab on your computer with npm run dev, or deploy it free on Vercel, and this chart and the data sync go live.'
                  : 'TradingView could not be reached. Check your connection, or allow this site in your ad blocker.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A scrolling strip of live prices for the watchlist. Renders nothing where outside scripts are blocked. */
export function TickerTape({ items }: { items: WatchItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const state = useTradingViewWidget(
    box,
    TV_TAPE,
    () => ({
      symbols: items.map((w) => ({ proName: w.tv, title: w.label })),
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: 'adaptive',
      colorTheme: theme,
      locale: 'en',
    }),
    JSON.stringify({ items, theme }),
  );
  if (state === 'blocked' || state === 'failed') return null;
  return (
    <section className="panel mb-4 h-[46px] overflow-hidden" aria-label="Live prices">
      <div ref={box} className="tradingview-widget-container h-full" />
    </section>
  );
}

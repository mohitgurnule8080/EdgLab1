import { useMemo, useState } from 'react';
import type { TradeRecord } from '../core/types';
import { breakdown, bySession, byWeekday, computeStats, dailyPnl, equityCurve, sqnLabel, type TradeStats } from '../core/stats';
import { formatDate, formatDuration, zonedParts, zonedToUtc } from '../core/time';
import { useApp } from '../state/AppContext';
import { generateSampleJournal } from '../lib/sample-journal';
import { money, pct, plural, pnlClass, ratio, rMult } from '../lib/format';
import { Button, EmptyState, Panel, Segmented, SideBadge } from '../components/ui';
import { SessionClock } from '../components/SessionClock';
import { RHistogram, WinRateDonut } from '../components/ResultShape';
import { IconCalendar, IconClock, IconFlame, IconTrendUp } from '../components/icons';
import { EquityChart } from '../components/EquityChart';
import { PnlCalendar } from '../components/PnlCalendar';
import { BreakdownTable } from '../components/BreakdownTable';

type SourceFilter = 'all' | 'live' | 'backtest';
type Period = 'all' | '30' | '90' | '365';
type Group = 'setup' | 'session' | 'pair' | 'weekday' | 'side' | 'emotion';

export function Dashboard() {
  const { trades, settings, pricing, saveTrades, deleteTrades, go, toast } = useApp();
  const tz = settings.timezone;
  const ccy = settings.accountCurrency;
  const [source, setSource] = useState<SourceFilter>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [pair, setPair] = useState('');
  const [setup, setSetup] = useState('');
  const [curveMode, setCurveMode] = useState<'money' | 'r'>('money');
  const [group, setGroup] = useState<Group>('setup');

  const pairs = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter(Boolean))].sort(), [trades]);
  const hasSample = trades.some((t) => t.sample);

  const base = useMemo(() => {
    const since = period === 'all' ? -Infinity : Date.now() / 1000 - Number(period) * 86_400;
    return trades.filter((t) => t.exitTime >= since && (!pair || t.symbol === pair) && (!setup || t.setup === setup));
  }, [trades, period, pair, setup]);
  const view = useMemo(() => (source === 'all' ? base : base.filter((t) => t.source === source)), [base, source]);
  const stats = useMemo(() => computeStats(view, settings.accountSize), [view, settings.accountSize]);
  const curve = useMemo(() => equityCurve(view), [view]);
  const daily = useMemo(() => dailyPnl(view, tz), [view, tz]);
  const rValues = useMemo(() => view.flatMap((t) => (t.rMultiple === null || t.rMultiple === undefined ? [] : [t.rMultiple])), [view]);
  const latest = view.reduce((a, t) => Math.max(a, t.exitTime), 0);
  const latestParts = zonedParts(latest || Date.now() / 1000, tz);

  const loadSample = async () => {
    await saveTrades(generateSampleJournal(pricing));
    toast('Sample journal loaded. Remove it any time from the banner on this page.', 'success');
  };
  const removeSample = async () => {
    await deleteTrades(trades.filter((t) => t.sample).map((t) => t.id));
    toast('Sample trades removed');
  };

  if (trades.length === 0) {
    return (
      <div>
        <DeskBanner trades={trades} />
        <EmptyState
          title="No trades yet"
          actions={
            <>
              <Button variant="primary" onClick={() => go('backtest')}>
                Start a backtest
              </Button>
              <Button onClick={() => go('journal', 'new')}>Log a live trade</Button>
              <Button variant="ghost" onClick={loadSample}>
                Explore with sample trades
              </Button>
            </>
          }
        >
          Replay a chart and take trades, or log the trades you took today. Your win rate, R multiples, drawdown and P&L calendar build up from there.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <DeskBanner trades={trades} />

      {hasSample && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-brass/40 bg-brass/10 px-4 py-2.5">
          <span>These numbers include generated sample trades so you can see how the dashboard works.</span>
          <Button size="sm" onClick={removeSample}>
            Remove sample trades
          </Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Trade source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All trades' },
            { value: 'live', label: 'Live' },
            { value: 'backtest', label: 'Backtest' },
          ]}
        />
        <select className="field w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          <option value="all">All time</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </select>
        <select className="field w-auto" value={pair} onChange={(e) => setPair(e.target.value)} aria-label="Pair">
          <option value="">All pairs</option>
          {pairs.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className="field w-auto" value={setup} onChange={(e) => setSetup(e.target.value)} aria-label="Setup">
          <option value="">All setups</option>
          {setups.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {view.length === 0 ? (
        <EmptyState title="No trades match these filters">Change the source, period, pair or setup above.</EmptyState>
      ) : (
        <div className="space-y-4">
          {/* Hero: the curve is the point of the page */}
          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                <div>
                  <div className="text-[13px] text-fg-2">Net result</div>
                  <div className={`type-display type-data text-[40px] leading-none ${pnlClass(stats.netPnl)}`}>{money(stats.netPnl, ccy, { signed: true })}</div>
                </div>
                <div className="pb-1 type-data">
                  <div className="text-[13px] text-fg-2">In R</div>
                  <div className="text-[22px] font-semibold">{rMult(stats.totalR, 1)}</div>
                </div>
                <div className="pb-1 type-data">
                  <div className="text-[13px] text-fg-2">Trades</div>
                  <div className="text-[22px] font-semibold">{stats.trades}</div>
                </div>
              </div>
              <Segmented
                label="Curve units"
                size="sm"
                value={curveMode}
                onChange={setCurveMode}
                options={[
                  { value: 'money', label: ccy },
                  { value: 'r', label: 'R' },
                ]}
              />
            </div>
            <EquityChart points={curve} mode={curveMode} currency={ccy} tz={tz} />
          </section>

          <Scorecard s={stats} ccy={ccy} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1.15fr)_minmax(0,1fr)]">
            <Panel title="Win rate" className="flex flex-col" bodyClass="flex flex-1 items-center p-4">
              <WinRateDonut wins={stats.wins} losses={stats.losses} breakeven={stats.breakeven} />
            </Panel>
            <Panel title="How your results are spread" className="flex flex-col" bodyClass="flex flex-1 flex-col justify-center p-4">
              <RHistogram rs={rValues} />
            </Panel>
            <div className="lg:col-span-2 xl:col-span-1">
              <RecentTrades trades={view} ccy={ccy} tz={tz} onOpen={() => go('journal')} />
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="P&L calendar">
              <PnlCalendar key={`${latestParts.year}-${latestParts.month}`} daily={daily} currency={ccy} initial={{ year: latestParts.year, month: latestParts.month }} />
            </Panel>
            <div className="space-y-4">
              <BacktestVsLive trades={base} ccy={ccy} />
              <MistakeCost trades={view} ccy={ccy} />
            </div>
          </div>

          <Panel
            title="Where your edge is"
            actions={
              <Segmented
                label="Group by"
                size="sm"
                value={group}
                onChange={setGroup}
                options={[
                  { value: 'setup', label: 'Setup' },
                  { value: 'session', label: 'Session' },
                  { value: 'pair', label: 'Pair' },
                  { value: 'weekday', label: 'Weekday' },
                  { value: 'side', label: 'Direction' },
                  { value: 'emotion', label: 'Emotion' },
                ]}
              />
            }
            bodyClass="p-0"
          >
            <BreakdownTable
              currency={ccy}
              keyLabel={{ setup: 'Setup', session: 'Session (New York time)', pair: 'Pair', weekday: 'Day', side: 'Direction', emotion: 'Emotion' }[group]}
              rows={
                group === 'setup'
                  ? breakdown(view, (t) => t.setup || 'No setup')
                  : group === 'session'
                    ? bySession(view)
                    : group === 'pair'
                      ? breakdown(view, (t) => t.symbol)
                      : group === 'weekday'
                        ? byWeekday(view, tz)
                        : group === 'side'
                          ? breakdown(view, (t) => (t.side === 'buy' ? 'Long' : 'Short'), ['Long', 'Short'])
                          : breakdown(view, (t) => t.emotion || 'Not recorded')
              }
            />
          </Panel>
        </div>
      )}
    </div>
  );
}

function Scorecard({ s, ccy }: { s: TradeStats; ccy: string }) {
  const items: { label: string; value: string; detail: string; tone?: string }[] = [
    { label: 'Win rate', value: pct(s.winRate, 1), detail: `${s.wins} won, ${s.losses} lost${s.breakeven ? `, ${s.breakeven} flat` : ''}` },
    { label: 'Profit factor', value: ratio(s.profitFactor), detail: `${money(s.grossProfit, ccy)} won vs ${money(s.grossLoss, ccy)} lost` },
    { label: 'Expectancy', value: rMult(s.rTrades ? s.avgR : null), detail: `${money(s.expectancy, ccy, { signed: true })} per trade`, tone: pnlClass(s.avgR) },
    { label: 'Average win / loss', value: `${ratio(s.payoff)} : 1`, detail: `${money(s.avgWin, ccy)} / ${money(s.avgLoss, ccy)}` },
    { label: 'Max drawdown', value: s.rTrades ? (s.maxDrawdownR > 0 ? `\u2212${s.maxDrawdownR.toFixed(1)}R` : '0.0R') : money(-s.maxDrawdown, ccy), detail: `${money(-s.maxDrawdown, ccy)}${s.maxDrawdownPct !== null ? `, ${pct(s.maxDrawdownPct)} of peak` : ''}` },
    { label: 'SQN', value: s.sqn === null ? '—' : s.sqn.toFixed(2), detail: sqnLabel(s.sqn) },
    { label: 'Streaks', value: `${s.maxConsecWins} / ${s.maxConsecLosses}`, detail: 'Longest win / loss run' },
    { label: 'Average hold', value: formatDuration(s.avgHoldSec), detail: `${money(s.totalFees, ccy)} paid in fees` },
  ];
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-ink-700 bg-ink-700 sm:grid-cols-4 xl:grid-cols-8" aria-label="Key statistics">
      {items.map((it) => (
        <div key={it.label} className="bg-ink-900 px-4 py-3">
          <div className="text-[12px] text-fg-3">{it.label}</div>
          <div className={`type-data mt-0.5 text-[20px] font-semibold leading-tight ${it.tone ?? ''}`}>{it.value}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-fg-2">{it.detail}</div>
        </div>
      ))}
    </section>
  );
}

function BacktestVsLive({ trades, ccy }: { trades: TradeRecord[]; ccy: string }) {
  const live = computeStats(trades.filter((t) => t.source === 'live'));
  const bt = computeStats(trades.filter((t) => t.source === 'backtest'));
  if (!live.trades || !bt.trades) {
    return (
      <Panel title="Backtest vs live">
        <p className="text-fg-2">Once you have both backtested and live trades, this compares them side by side, so you can see whether you trade your system the way you tested it.</p>
      </Panel>
    );
  }
  const rows: [string, string, string][] = [
    ['Trades', String(bt.trades), String(live.trades)],
    ['Win rate', pct(bt.winRate, 0), pct(live.winRate, 0)],
    ['Expectancy', rMult(bt.avgR), rMult(live.avgR)],
    ['Profit factor', ratio(bt.profitFactor), ratio(live.profitFactor)],
    ['Net P&L', money(bt.netPnl, ccy, { signed: true }), money(live.netPnl, ccy, { signed: true })],
  ];
  const gap = live.avgR - bt.avgR;
  return (
    <Panel title="Backtest vs live" bodyClass="p-0">
      <table className="table-data">
        <thead>
          <tr>
            <th />
            <th className="num">Backtest</th>
            <th className="num">Live</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <td className="text-fg-2">{k}</td>
              <td className="num">{a}</td>
              <td className="num font-semibold">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bt.trades >= 5 && live.trades >= 5 && (
        <p className="px-4 py-3 text-[13px] text-fg-2">
          {Math.abs(gap) < 0.05
            ? 'Live trading is matching your backtests.'
            : gap < 0
              ? `Live trades earn ${Math.abs(gap).toFixed(2)}R less per trade than your backtests. The mistakes below are a good place to look.`
              : `Live trades earn ${gap.toFixed(2)}R more per trade than your backtests. Make sure the sample is large enough before you size up.`}
        </p>
      )}
    </Panel>
  );
}

function MistakeCost({ trades, ccy }: { trades: TradeRecord[]; ccy: string }) {
  const rows = breakdown(trades, (t) => t.mistakes).sort((a, b) => a.stats.netPnl - b.stats.netPnl);
  const clean = computeStats(trades.filter((t) => t.mistakes.length === 0));
  const dirty = computeStats(trades.filter((t) => t.mistakes.length > 0));
  return (
    <Panel title="What mistakes cost you">
      {rows.length === 0 ? (
        <p className="text-fg-2">Tag mistakes such as FOMO entry or moved SL when you review a trade, and their cost shows up here.</p>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {rows.slice(0, 5).map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-3">
                <span>
                  {r.key} <span className="text-[12px] text-fg-3">{plural(r.stats.trades, 'trade')}</span>
                </span>
                <span className={`type-data font-semibold ${pnlClass(r.stats.netPnl)}`}>{money(r.stats.netPnl, ccy, { signed: true })}</span>
              </li>
            ))}
          </ul>
          {clean.rTrades > 0 && dirty.rTrades > 0 && (
            <p className="border-t border-ink-700 pt-3 text-[13px] text-fg-2">
              Clean trades average <span className="type-data font-semibold text-fg">{rMult(clean.avgR)}</span>; trades with a mistake average{' '}
              <span className="type-data font-semibold text-fg">{rMult(dirty.avgR)}</span>.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Desk banner: greeting, today's numbers and the session clock         */
/* ------------------------------------------------------------------ */

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function DeskBanner({ trades }: { trades: TradeRecord[] }) {
  const { settings, account } = useApp();
  const tz = settings.timezone;
  const ccy = settings.accountCurrency;
  const now = Math.floor(Date.now() / 1000);
  const p = zonedParts(now, tz);
  const first = account.kind === 'account' ? account.profile?.name.trim().split(/\s+/)[0] : undefined;
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(new Date(now * 1000));

  const live = useMemo(() => trades.filter((t) => t.source === 'live').sort((a, b) => a.exitTime - b.exitTime), [trades]);
  const dayStart = zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
  const weekStart = zonedToUtc(p.year, p.month, p.day - ((p.weekday + 6) % 7), 0, 0, tz);
  const monthStart = zonedToUtc(p.year, p.month, 1, 0, 0, tz);
  const since = (t0: number) => {
    const list = live.filter((t) => t.exitTime >= t0);
    return { pnl: list.reduce((a, t) => a + t.pnl, 0), n: list.length, won: list.filter((t) => t.pnl > 0).length };
  };
  const today = since(dayStart);
  const week = since(weekStart);
  const month = since(monthStart);

  // Current run of wins or losses, newest trade backwards; a flat trade ends it.
  let run = 0;
  let runWin = true;
  for (let i = live.length - 1; i >= 0; i--) {
    const v = live[i].pnl;
    if (Math.abs(v) < 1e-9) break;
    if (run === 0) runWin = v > 0;
    else if (v > 0 !== runWin) break;
    run++;
  }

  const detail = (x: { n: number; won: number }, when: string) => (x.n ? `${plural(x.n, 'trade')}, ${x.won} won` : `No trades ${when}`);

  return (
    <section className="panel mb-5 overflow-hidden" aria-label="Today">
      <div className="grid items-center gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h1 className="type-display text-[28px] leading-tight sm:text-[32px]">
            {greeting(p.hour)}
            {first ? `, ${first}` : ''}
          </h1>
          <p className="mt-1 text-fg-2">{date}</p>
          <div className="mt-5 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
            <TodayStat icon={<IconClock size={16} />} label="Today" value={today.n ? money(today.pnl, ccy, { signed: true }) : money(0, ccy)} tone={pnlClass(today.pnl)} detail={detail(today, 'today')} />
            <TodayStat icon={<IconCalendar size={16} />} label="This week" value={money(week.pnl, ccy, { signed: week.n > 0 })} tone={pnlClass(week.pnl)} detail={detail(week, 'this week')} />
            <TodayStat icon={<IconTrendUp size={16} />} label="This month" value={money(month.pnl, ccy, { signed: month.n > 0 })} tone={pnlClass(month.pnl)} detail={detail(month, 'this month')} />
            <TodayStat
              icon={<IconFlame size={16} />}
              label="Current streak"
              value={run ? `${run} ${runWin ? (run === 1 ? 'win' : 'wins') : run === 1 ? 'loss' : 'losses'}` : '—'}
              tone={run ? (runWin ? 'text-profit-fg' : 'text-loss-fg') : ''}
              detail={live.length ? `Across ${plural(live.length, 'live trade')}` : 'Log live trades in the Journal'}
            />
          </div>
        </div>
        <div className="border-t border-ink-700 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <SessionClock tz={tz} size={196} />
        </div>
      </div>
    </section>
  );
}

function TodayStat({ icon, label, value, detail, tone = '' }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="border-ink-700 pr-4 sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
        <span className="text-brass-fg">{icon}</span>
        {label}
      </div>
      <div className={`type-data mt-1 text-[22px] font-semibold leading-tight ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-fg-2">{detail}</div>
    </div>
  );
}

function RecentTrades({ trades, ccy, tz, onOpen }: { trades: TradeRecord[]; ccy: string; tz: string; onOpen(): void }) {
  const recent = [...trades].sort((a, b) => b.exitTime - a.exitTime).slice(0, 5);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz });
  return (
    <Panel
      className="h-full"
      title="Recent trades"
      actions={
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open journal
        </Button>
      }
      bodyClass="p-0"
    >
      <table className="table-data">
        <thead>
          <tr>
            <th>Closed</th>
            <th>Trade</th>
            <th className="num">R</th>
            <th className="num">P&L</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((t) => (
            <tr key={t.id}>
              <td className="text-fg-2" title={formatDate(t.exitTime, tz)}>
                {day.format(new Date(t.exitTime * 1000))}
              </td>
              <td>
                <span className="inline-flex items-center gap-2">
                  <span className="font-medium">{t.symbol}</span>
                  <SideBadge side={t.side} />
                  {t.source === 'backtest' && <span className="text-[11px] text-fg-3">backtest</span>}
                </span>
              </td>
              <td className={`num ${pnlClass(t.rMultiple)}`}>{rMult(t.rMultiple, 1)}</td>
              <td className={`num font-semibold ${pnlClass(t.pnl)}`}>{money(t.pnl, ccy, { signed: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

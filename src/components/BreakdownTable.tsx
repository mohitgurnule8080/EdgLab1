import type { BreakdownRow } from '../core/stats';
import { money, pct, ratio, rMult } from '../lib/format';

/** Per-group results. The bar is diverging: profit grows right of the centre line, loss grows left. */
export function BreakdownTable({ rows, keyLabel, currency, emptyText = 'No trades in this view.' }: { rows: BreakdownRow[]; keyLabel: string; currency: string; emptyText?: string }) {
  if (!rows.length) return <p className="py-6 text-fg-3">{emptyText}</p>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.stats.netPnl)), 1e-9);
  return (
    <div className="overflow-x-auto">
      <table className="table-data">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th className="num">Trades</th>
            <th className="num">Win rate</th>
            <th className="num">Net P&L</th>
            <th className="min-w-[140px]" aria-label="Net P&L bar" />
            <th className="num">Avg R</th>
            <th className="num">Profit factor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = (Math.abs(r.stats.netPnl) / maxAbs) * 50;
            const pos = r.stats.netPnl >= 0;
            return (
              <tr key={r.key}>
                <td className="font-medium">{r.key}</td>
                <td className="num">{r.stats.trades}</td>
                <td className="num">{pct(r.stats.winRate, 0)}</td>
                <td className="num font-semibold">{money(r.stats.netPnl, currency, { signed: true })}</td>
                <td>
                  <div className="relative h-3 w-full min-w-[120px]" title={money(r.stats.netPnl, currency, { signed: true })}>
                    <div className="absolute inset-y-[-2px] left-1/2 w-px bg-ink-600" />
                    <div
                      className="absolute top-0 h-full"
                      style={{
                        left: pos ? '50%' : `${50 - w}%`,
                        width: `${Math.max(w, 0.8)}%`,
                        background: pos ? 'var(--color-profit)' : 'var(--color-loss)',
                        borderRadius: pos ? '0 4px 4px 0' : '4px 0 0 4px',
                      }}
                    />
                  </div>
                </td>
                <td className="num">{rMult(r.stats.rTrades ? r.stats.avgR : null)}</td>
                <td className="num">{ratio(r.stats.profitFactor)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useRef, useState } from 'react';
import { accounts } from '../security/accounts';
import { KDF_ITERATIONS } from '../security/vault';
import { connectCloud } from '../store/cloud';
import { cipherFor } from '../state/AppContext';
import { ACCOUNT_CURRENCIES, INSTRUMENTS } from '../core/instruments';
import { browserTimeZone } from '../core/time';
import type { Instrument } from '../core/types';
import { useApp } from '../state/AppContext';
import { Button, Field, PageHeader, Panel, Segmented } from '../components/ui';
import { useTheme, type ThemePref } from '../lib/theme';
import { IconMoon, IconSun } from '../components/icons';
import { saveFile } from '../lib/host';
import { plural } from '../lib/format';

const ZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

export function SettingsPage() {
  const { settings, updateSettings, instruments, exportBackup, importBackup, clearAll, trades, deleteTrades, toast, storageMode, confirm, cloudStatus, account } = useApp();
  const [keyDraft, setKeyDraft] = useState(settings.apiKeys.twelvedata ?? '');
  const [showKey, setShowKey] = useState(false);
  const theme = useTheme();

  const deleteAccount = async () => {
    if (account.kind !== 'account' || !account.profile || !account.key) return;
    const ok = await confirm({
      title: `Delete the account "${account.profile.name}"?`,
      body: 'Its trades, sessions, downloaded data and settings are erased from this device and from sync. This cannot be undone.',
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    const cloud = await connectCloud(account.cloudScope, cipherFor(account.key));
    if (cloud) {
      try {
        await cloud.load();
        cloud.clearAll();
        await cloud.idle();
      } catch {
        /* nothing synced */
      }
    }
    await accounts.remove(account.profile.id);
    account.lock('manual');
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = [...new Set([browserTimeZone(), settings.timezone, ...ZONES])];
  const samples = trades.filter((t) => t.sample).length;

  const setInstrument = (symbol: string, patch: Partial<Instrument>) => {
    const current = instruments.find((i) => i.symbol === symbol);
    if (!current) return;
    const next = { ...current, ...patch };
    const builtIn = INSTRUMENTS.find((i) => i.symbol === symbol);
    const same = builtIn && builtIn.pipSize === next.pipSize && builtIn.contractSize === next.contractSize && builtIn.digits === next.digits;
    const rest = settings.instrumentOverrides.filter((i) => i.symbol !== symbol);
    updateSettings({ instrumentOverrides: same ? rest : [...rest, next] });
  };

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel title="Security and privacy">
          <div className="space-y-3">
            {account.kind === 'account' ? (
              <p className="text-fg-2">
                Signed in as <span className="font-semibold text-fg">{account.profile?.name}</span>. Your journal, sessions, settings and API keys are encrypted with AES-256-GCM using a key made from your password ({KDF_ITERATIONS.toLocaleString()} rounds of PBKDF2). The password itself is never stored.
              </p>
            ) : (
              <p className="text-fg-2">You are using EdgeLab as a guest, so this data is not encrypted. Create an account from the sign-in screen to encrypt it; you can move this journal into it.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {account.kind === 'account' && (
                <Field label="Lock automatically" hint="After this long without any activity">
                  <select className="field" value={settings.autoLockMin} onChange={(e) => updateSettings({ autoLockMin: Number(e.target.value) })}>
                    <option value={5}>After 5 minutes</option>
                    <option value={15}>After 15 minutes</option>
                    <option value={30}>After 30 minutes</option>
                    <option value={60}>After 1 hour</option>
                    <option value={0}>Never</option>
                  </select>
                </Field>
              )}
              <label className="flex items-start gap-2 self-end pb-2 text-[14px]">
                <input type="checkbox" className="mt-1" checked={settings.hideAmounts} onChange={(e) => updateSettings({ hideAmounts: e.target.checked })} />
                <span>
                  Hide amounts
                  <span className="block text-[12px] text-fg-3">Masks balances and P&L everywhere; R, pips and percentages stay visible. Handy for screen recording.</span>
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-ink-700 pt-3">
              <Button onClick={() => account.lock('manual')}>{account.kind === 'account' ? 'Lock now' : 'Sign in or create an account'}</Button>
              {account.kind === 'account' && (
                <Button variant="danger" onClick={deleteAccount}>
                  Delete this account
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Appearance">
          <div className="space-y-3">
            <p className="text-fg-2">Night mode is easier on the eyes for evening sessions; day mode reads better in a bright room. The choice is kept on this device, including on the sign-in screen.</p>
            <Segmented<ThemePref>
              label="Theme"
              value={theme.pref}
              onChange={theme.setPref}
              options={[
                {
                  value: 'light',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <IconSun size={16} /> Day
                    </span>
                  ),
                },
                {
                  value: 'dark',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <IconMoon size={16} /> Night
                    </span>
                  ),
                },
                { value: 'system', label: 'Match my device' },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Market data">
          <div className="space-y-3">
            <p className="text-fg-2">Crypto candles come from Binance and need no key. For forex, get a free API key from Twelve Data (no card needed) and paste it here.</p>
            <Field
              label="Twelve Data API key"
              hint={account.kind === 'account' ? 'Stored encrypted with your account and sent only to Twelve Data.' : 'Stored in this browser only, not encrypted, and never synced.'}
            >
              <div className="flex gap-1.5">
                <input
                  className="field type-data"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value.trim())}
                  placeholder="Paste your key"
                />
                <Button onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    updateSettings({ apiKeys: { ...settings.apiKeys, twelvedata: keyDraft || undefined } });
                    toast(keyDraft ? 'API key saved' : 'API key removed', 'success');
                  }}
                >
                  Save
                </Button>
              </div>
            </Field>
            <p className="text-[13px]">
              <a className="text-brass-fg underline" href="https://twelvedata.com/register" target="_blank" rel="noreferrer">
                Get a free Twelve Data key
              </a>
            </p>
          </div>
        </Panel>

        <Panel title="Account">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account currency">
              <select className="field" value={settings.accountCurrency} onChange={(e) => updateSettings({ accountCurrency: e.target.value })}>
                {ACCOUNT_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Account size" hint="Used for drawdown % and as the default backtest balance">
              <input type="number" className="field type-data" value={settings.accountSize} onChange={(e) => updateSettings({ accountSize: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <Field label="Default risk per trade (%)">
              <input type="number" step="0.1" className="field type-data" value={settings.defaultRiskPct} onChange={(e) => updateSettings({ defaultRiskPct: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <Field label="Default commission per lot" hint="Round turn, in account currency">
              <input type="number" step="0.5" className="field type-data" value={settings.defaultCommission} onChange={(e) => updateSettings({ defaultCommission: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <Field label="Time zone" hint="Charts, journal times and the P&L calendar use it. Sessions are always defined in New York time.">
              <select className="field" value={settings.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>

        <Panel title="Your data">
          <div className="space-y-3">
            <p className={storageMode === 'memory' ? 'text-loss-fg' : 'text-fg-2'}>
              {cloudStatus === 'synced'
                ? `${plural(trades.length, 'trade')} saved in this browser and synced to your private space on this page, so the journal follows you to other devices. Imported candle files stay on each device.`
                : cloudStatus === 'connecting'
                  ? 'Connecting to your private space on this page…'
                  : storageMode === 'indexeddb'
                    ? `Saved in this browser: ${plural(trades.length, 'trade')}. Nothing is uploaded anywhere. Export a backup now and then, or before you clear your browser data.`
                    : 'This browser is blocking storage, so your data only lasts until the tab closes. Export a backup before you leave.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={async () => {
                  const r = await saveFile(`edgelab-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json');
                  if (r === 'failed') toast('This page cannot save files here. Use Copy backup instead and paste it into a .json file.', 'error');
                }}
              >
                Export backup
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(await exportBackup());
                    toast('Backup copied. Paste it into a text file and save it as .json.', 'success');
                  } catch {
                    toast('Copying was blocked by the browser. Use Export backup instead.', 'error');
                  }
                }}
              >
                Copy backup
              </Button>
              <Button onClick={() => fileRef.current?.click()}>Restore from backup</Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const r = await importBackup(await f.text());
                    toast(`Restored ${plural(r.trades, 'trade')} and ${plural(r.sessions, 'session')}.`, 'success');
                  } catch (err) {
                    toast((err as Error).message, 'error');
                  }
                }}
              />
            </div>
            <p className="text-[13px] text-fg-3">Backups contain your journal, sessions and settings. Imported candle files are not included; keep the original CSVs.</p>
            <div className="flex flex-wrap gap-2 border-t border-ink-700 pt-3">
              {samples > 0 && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await deleteTrades(trades.filter((t) => t.sample).map((t) => t.id));
                    toast('Sample trades removed');
                  }}
                >
                  Remove {plural(samples, 'sample trade')}
                </Button>
              )}
              <Button
                variant="danger"
                onClick={async () => {
                  if (await confirm({ title: 'Delete all data?', body: 'Every trade, replay session, imported candle file and setting is deleted. This cannot be undone.', confirmLabel: 'Delete everything', danger: true })) {
                    await clearAll();
                    toast('All data deleted');
                  }
                }}
              >
                Delete all data
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Currency values for cross pairs">
          <p className="mb-3 text-[13px] text-fg-2">
            P&L of pairs like EURGBP is converted to your account currency with these values (USD per unit). Pairs that contain your account currency always use the exact trade price.
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Object.entries(settings.usdValue).map(([ccy, v]) => (
              <Field key={ccy} label={ccy}>
                <input
                  type="number"
                  step="any"
                  className="field type-data"
                  value={v}
                  disabled={ccy === 'USD'}
                  onChange={(e) => updateSettings({ usdValue: { ...settings.usdValue, [ccy]: Number(e.target.value) || 0 } })}
                />
              </Field>
            ))}
          </div>
        </Panel>

        <Panel title="Contract specs" bodyClass="p-0">
          <div className="max-h-[360px] overflow-auto">
            <table className="table-data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Pip size</th>
                  <th className="num">Units per lot</th>
                  <th className="num">Decimals</th>
                </tr>
              </thead>
              <tbody>
                {instruments.map((i) => (
                  <tr key={i.symbol}>
                    <td className="font-medium">{i.symbol}</td>
                    <td className="num">
                      <input className="field h-7 min-h-0 w-[100px] py-0 text-right type-data" type="number" step="any" value={i.pipSize} onChange={(e) => setInstrument(i.symbol, { pipSize: Number(e.target.value) || i.pipSize })} />
                    </td>
                    <td className="num">
                      <input className="field h-7 min-h-0 w-[110px] py-0 text-right type-data" type="number" step="any" value={i.contractSize} onChange={(e) => setInstrument(i.symbol, { contractSize: Number(e.target.value) || i.contractSize })} />
                    </td>
                    <td className="num">
                      <input className="field h-7 min-h-0 w-[70px] py-0 text-right type-data" type="number" step="1" value={i.digits} onChange={(e) => setInstrument(i.symbol, { digits: Math.max(0, Math.round(Number(e.target.value))) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="About" className="xl:col-span-2">
          <div className="space-y-1.5 text-[13px] text-fg-2">
            <p>EdgeLab 0.1. Charts by TradingView Lightweight Charts™ (Apache 2.0). Typeface Archivo by Omnibus-Type (SIL Open Font License). Sample EURUSD hourly data from the backtesting.py project.</p>
            <p>EdgeLab is a practice and review tool. Backtest results are simulated and do not guarantee future performance.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

import type { TradeRecord } from '../core/types';
import type { SessionRecord, Settings } from './db';
import { useCapability, waitForHost } from '../lib/host';

/**
 * Optional sync to the per-user document store a Claude artifact host provides.
 * The local IndexedDB copy stays the working copy; this mirrors trades, sessions and settings
 * so a journal survives a cleared browser and follows the trader to other devices.
 *
 * Layout (the viewer's private subtree; <scope> is "edgelab" for guest data and
 * "edgelab-<accountId>" for a password-protected account):
 *   data/users/<uid>/<scope>                      settings + deletion markers
 *   data/users/<uid>/<scope>/trades/<YYYY-MM.n>     up to 200 trades per document
 *   data/users/<uid>/<scope>/sessions/<id>          one replay session per document
 *
 * With a cipher (password-protected accounts) every payload is sealed on the device first,
 * so the store only ever holds ciphertext: end-to-end encrypted sync.
 */

/** Seals and opens payloads; built from an account key. */
export interface Cipher {
  seal(value: unknown): Promise<string>;
  open<T>(text: string): Promise<T>;
}

interface Snap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  path: string;
  get(): Promise<Snap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): ColRef;
}
interface ColRef {
  get(): Promise<{ docs: Snap[] }>;
  doc(id: string): DocRef;
}
interface DB {
  doc(path: string): DocRef;
}
interface User {
  id(): Promise<string | null>;
  can?(name: string): Promise<boolean | null> | boolean | null;
}

export type CloudStatus = 'off' | 'connecting' | 'synced' | 'readonly' | 'error';

type Tombs = Record<string, number>;
const CHUNK = 200;
const MAX_DOC_CHARS = 240_000;
const TOMB_TTL = 180 * 86_400_000;

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const stamp = (x: { updatedAt: number }) => (x.updatedAt < 1e11 ? x.updatedAt * 1000 : x.updatedAt);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Union of two copies; the newer edit wins and deletion markers keep removed items removed. */
export function mergeRecords<T extends { id: string; updatedAt: number }>(local: T[], remote: T[], tombs: Tombs): T[] {
  const out = new Map<string, T>();
  for (const r of remote) out.set(r.id, r);
  for (const l of local) {
    const r = out.get(l.id);
    if (!r) {
      const t = tombs[l.id];
      if (t !== undefined && t >= stamp(l)) continue;
      out.set(l.id, l);
    } else if (stamp(l) > stamp(r)) out.set(l.id, l);
  }
  return [...out.values()];
}

export interface CloudSnapshot {
  exists: boolean;
  trades: TradeRecord[];
  sessions: SessionRecord[];
  settings?: Settings;
  tradeTombs: Tombs;
  sessionTombs: Tombs;
}

export class CloudStore {
  private home: DocRef;
  private cipher?: Cipher;
  private chain: Promise<void> = Promise.resolve();
  private buckets = new Map<string, string>();
  private sessionStamps = new Map<string, number>();
  private homeJson = '';
  private tradeTombs: Tombs = {};
  private sessionTombs: Tombs = {};
  private knownTrades: Set<string> | null = null;
  private settings: Settings | null = null;
  private pending = new Map<string, { ref: DocRef; body: Record<string, unknown> | null }>();
  private inflight = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private warnedLarge = new Set<string>();
  status: CloudStatus = 'synced';
  onStatus?: (s: CloudStatus, message?: string) => void;

  constructor(db: DB, uid: string, scope = 'edgelab', cipher?: Cipher) {
    this.home = db.doc(`data/users/${uid}/${scope}`);
    this.cipher = cipher;
  }

  async load(): Promise<CloudSnapshot> {
    const [h, tb, ss] = await withTimeout(Promise.all([this.home.get(), this.home.collection('trades').get(), this.home.collection('sessions').get()]), 12_000);
    const hd = h.exists ? (h.data() as Record<string, unknown>) : undefined;
    this.tradeTombs = (hd?.deletedTrades as Tombs) ?? {};
    this.sessionTombs = (hd?.deletedSessions as Tombs) ?? {};
    if (hd?.settingsEnc && this.cipher) this.settings = await this.cipher.open<Settings>(hd.settingsEnc as string);
    else this.settings = (hd?.settings as Settings) ?? null;
    this.homeJson = hd ? this.homeKey() : '';
    const trades: TradeRecord[] = [];
    for (const d of tb.docs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      if (typeof data.enc === 'string' && !this.cipher) continue;
      const list = typeof data.enc === 'string' ? await this.cipher!.open<TradeRecord[]>(data.enc) : ((data.trades as TradeRecord[]) ?? []);
      trades.push(...list);
      this.buckets.set(d.id, JSON.stringify(clean(list)));
    }
    const sessions: SessionRecord[] = [];
    for (const d of ss.docs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      if (typeof data.enc === 'string' && !this.cipher) continue;
      const s = typeof data.enc === 'string' ? await this.cipher!.open<SessionRecord>(data.enc) : (data as unknown as SessionRecord);
      sessions.push(s);
      this.sessionStamps.set(s.id, s.updatedAt);
    }
    return { exists: !!h.exists, trades, sessions, settings: this.settings ?? undefined, tradeTombs: this.tradeTombs, sessionTombs: this.sessionTombs };
  }

  /** Resolves once every queued sync step has been handed to the write queue. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(step: () => Promise<void>): void {
    this.chain = this.chain.then(step).catch(() => this.setStatus('error', 'Could not sync the latest change. It is saved in this browser.'));
  }

  /** Mirror the full trade list; only documents whose content changed are written. */
  syncTrades(trades: TradeRecord[]): void {
    this.enqueue(() => this.doSyncTrades(trades));
  }

  syncSessions(sessions: SessionRecord[]): void {
    this.enqueue(() => this.doSyncSessions(sessions));
  }

  syncSettings(settings: Settings): void {
    this.enqueue(async () => {
      this.settings = settings;
      await this.writeHome();
    });
  }

  /** Delete everything under this scope (used when an account is deleted or guest data moves). */
  clearAll(): void {
    this.enqueue(async () => {
      this.knownTrades = new Set([...this.knownTrades ?? [], ...this.idsInBuckets()]);
      await this.doSyncTrades([]);
      await this.doSyncSessions([]);
      this.write(this.home, null);
    });
  }

  private idsInBuckets(): string[] {
    const ids: string[] = [];
    for (const json of this.buckets.values()) for (const t of JSON.parse(json) as TradeRecord[]) ids.push(t.id);
    return ids;
  }

  private async doSyncTrades(trades: TradeRecord[]): Promise<void> {
    if (this.status === 'readonly') return;
    const ids = new Set(trades.map((t) => t.id));
    let tombsChanged = false;
    if (this.knownTrades) {
      for (const id of this.knownTrades) {
        if (!ids.has(id)) {
          this.tradeTombs[id] = Date.now();
          tombsChanged = true;
        }
      }
    }
    this.knownTrades = ids;

    const byMonth = new Map<string, TradeRecord[]>();
    for (const t of trades) {
      const m = new Date(t.entryTime * 1000).toISOString().slice(0, 7);
      const list = byMonth.get(m);
      if (list) list.push(t);
      else byMonth.set(m, [t]);
    }
    const next = new Map<string, string>();
    for (const [m, list] of byMonth) {
      list.sort((a, b) => a.entryTime - b.entryTime || (a.id < b.id ? -1 : 1));
      for (let i = 0; i * CHUNK < list.length; i++) next.set(`${m}.${i}`, JSON.stringify(clean(list.slice(i * CHUNK, (i + 1) * CHUNK))));
    }
    const col = this.home.collection('trades');
    for (const [k, json] of next) {
      if (this.buckets.get(k) !== json) {
        this.buckets.set(k, json);
        const list = JSON.parse(json);
        this.write(col.doc(k), this.cipher ? { enc: await this.cipher.seal(list) } : { trades: list });
      }
    }
    for (const k of [...this.buckets.keys()]) {
      if (!next.has(k)) {
        this.buckets.delete(k);
        this.write(col.doc(k), null);
      }
    }
    if (tombsChanged) await this.writeHome();
  }

  private async doSyncSessions(sessions: SessionRecord[]): Promise<void> {
    if (this.status === 'readonly') return;
    const col = this.home.collection('sessions');
    const ids = new Set(sessions.map((s) => s.id));
    for (const s of sessions) {
      if (this.sessionStamps.get(s.id) === s.updatedAt) continue;
      this.sessionStamps.set(s.id, s.updatedAt);
      const plain = clean(s) as unknown as Record<string, unknown>;
      const body = this.cipher ? { id: s.id, updatedAt: s.updatedAt, enc: await this.cipher.seal(plain) } : plain;
      if (JSON.stringify(body).length > MAX_DOC_CHARS) {
        if (!this.warnedLarge.has(s.id)) {
          this.warnedLarge.add(s.id);
          this.onStatus?.(this.status, `"${s.name}" has too many trades to sync; it stays saved on this device.`);
        }
        continue;
      }
      this.write(col.doc(s.id), body, 4000);
    }
    let tombsChanged = false;
    for (const id of [...this.sessionStamps.keys()]) {
      if (!ids.has(id)) {
        this.sessionStamps.delete(id);
        this.sessionTombs[id] = Date.now();
        tombsChanged = true;
        this.write(col.doc(id), null);
      }
    }
    if (tombsChanged) await this.writeHome();
  }

  /** Comparable snapshot of what the home document should hold (before sealing). */
  private homeKey(): string {
    return JSON.stringify(clean({ settings: this.publicSettings(), deletedTrades: this.tradeTombs, deletedSessions: this.sessionTombs }));
  }

  /** Without a cipher, API keys never leave the device. */
  private publicSettings(): Settings | null {
    if (!this.settings) return null;
    return this.cipher ? this.settings : { ...this.settings, apiKeys: {} };
  }

  private async writeHome(): Promise<void> {
    if (this.status === 'readonly') return;
    const now = Date.now();
    const prune = (t: Tombs) => Object.fromEntries(Object.entries(t).filter(([, v]) => now - v < TOMB_TTL).slice(-3000));
    this.tradeTombs = prune(this.tradeTombs);
    this.sessionTombs = prune(this.sessionTombs);
    const json = this.homeKey();
    if (json === this.homeJson) return;
    this.homeJson = json;
    const settings = this.publicSettings();
    const body = this.cipher
      ? { settingsEnc: settings ? await this.cipher.seal(settings) : null, deletedTrades: this.tradeTombs, deletedSessions: this.sessionTombs, schema: 2 }
      : { settings, deletedTrades: this.tradeTombs, deletedSessions: this.sessionTombs, schema: 2 };
    this.write(this.home, clean(body));
  }

  /**
   * One write at a time per document; a burst of changes collapses into the latest body.
   * `delayMs` holds the write back so a replay that saves every second costs one write every few.
   */
  private write(ref: DocRef, body: Record<string, unknown> | null, delayMs = 0): void {
    this.pending.set(ref.path, { ref, body });
    if (this.inflight.has(ref.path) || this.timers.has(ref.path)) return;
    if (delayMs > 0) {
      this.timers.set(
        ref.path,
        setTimeout(() => {
          this.timers.delete(ref.path);
          if (!this.inflight.has(ref.path)) void this.drain(ref.path);
        }, delayMs),
      );
    } else void this.drain(ref.path);
  }

  private async drain(path: string): Promise<void> {
    this.inflight.add(path);
    try {
      while (this.pending.has(path) && this.status !== 'readonly') {
        const job = this.pending.get(path)!;
        this.pending.delete(path);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (job.body) await job.ref.set(job.body);
            else await job.ref.delete();
            if (this.status === 'error') this.setStatus('synced');
            break;
          } catch (e) {
            const code = (e as { code?: string })?.code;
            if (code === 'invalid_argument' && job.body && attempt === 0 && JSON.stringify(job.body).length < MAX_DOC_CHARS) {
              // A well-formed write was refused: this viewer may only read here.
              this.setStatus('readonly', 'You can view this page but not save to it, so your data stays in this browser.');
              return;
            }
            if ((code === 'unavailable' || code === 'resource_exhausted') && attempt === 0) {
              await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
              continue;
            }
            this.setStatus('error', code === 'quota_exceeded' ? 'Cloud storage for this page is full. Your data is still saved in this browser.' : 'Could not sync the latest change. It is saved in this browser.');
            break;
          }
        }
      }
    } finally {
      this.inflight.delete(path);
    }
  }

  private setStatus(s: CloudStatus, message?: string) {
    this.status = s;
    this.onStatus?.(s, message);
  }
}

interface HostStore {
  db: DB;
  uid: string;
}

let hostStore: Promise<HostStore | null> | null = null;

/** The host's document store and this viewer's id, or null outside an artifact host. */
export function hostDocumentStore(): Promise<HostStore | null> {
  hostStore ??= (async () => {
    const host = await waitForHost(2500);
    if (!host) return null;
    const [db, user] = await Promise.all([useCapability<DB>('db'), useCapability<User>('user')]);
    if (!db || !user) return null;
    try {
      const uid = await user.id();
      return uid ? { db, uid } : null;
    } catch {
      return null;
    }
  })();
  return hostStore;
}

/** Connect to the host's document store, or resolve null when there is none. */
export async function connectCloud(scope = 'edgelab', cipher?: Cipher): Promise<CloudStore | null> {
  const hs = await hostDocumentStore();
  return hs ? new CloudStore(hs.db, hs.uid, scope, cipher) : null;
}

/** Account list (salts and checks only, never passwords or keys) so accounts appear on new devices. */
export async function cloudAccountsDoc(): Promise<DocRef | null> {
  const hs = await hostDocumentStore();
  return hs ? hs.db.doc(`data/users/${hs.uid}/edgelab-accounts`) : null;
}

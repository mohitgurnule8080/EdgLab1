import { openDB, type IDBPDatabase } from 'idb';
import type { ProfileMeta } from './vault';
import { cloudAccountsDoc } from '../store/cloud';
import { deleteDatabase } from '../store/db';

/**
 * The list of accounts on this device. It holds only public metadata (name, salt, iteration
 * count and a sealed check value), never a password or key. When EdgeLab runs inside an
 * artifact host the list is mirrored to the viewer's private store, so an account created on a
 * laptop can be unlocked on a phone.
 */

export const GUEST_DB = 'edgelab';
export const accountDbName = (id: string) => `edgelab-a-${id}`;
export const accountScope = (id: string) => `edgelab-${id}`;

export interface AccountsRegistry {
  list(): Promise<ProfileMeta[]>;
  save(meta: ProfileMeta): Promise<void>;
  remove(id: string): Promise<void>;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;

function registryDb(): Promise<IDBPDatabase | null> {
  dbPromise ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      return await Promise.race([
        openDB('edgelab-accounts', 1, {
          upgrade(d) {
            if (!d.objectStoreNames.contains('accounts')) d.createObjectStore('accounts', { keyPath: 'id' });
          },
        }),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
    } catch {
      return null;
    }
  })();
  return dbPromise;
}

const memory = new Map<string, ProfileMeta>();

async function readCloud(): Promise<ProfileMeta[]> {
  try {
    const ref = await cloudAccountsDoc();
    if (!ref) return [];
    const snap = await Promise.race([ref.get(), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    return snap && snap.exists ? ((snap.data()?.accounts as ProfileMeta[]) ?? []) : [];
  } catch {
    return [];
  }
}

async function writeCloud(list: ProfileMeta[]): Promise<void> {
  try {
    const ref = await cloudAccountsDoc();
    await ref?.set({ accounts: JSON.parse(JSON.stringify(list)) });
  } catch {
    /* the local list still works */
  }
}

async function localList(): Promise<ProfileMeta[]> {
  const db = await registryDb();
  if (!db) return [...memory.values()];
  try {
    return (await db.getAll('accounts')) as ProfileMeta[];
  } catch {
    return [...memory.values()];
  }
}

async function localPut(meta: ProfileMeta): Promise<void> {
  memory.set(meta.id, meta);
  const db = await registryDb();
  try {
    await db?.put('accounts', meta);
  } catch {
    /* memory copy is enough for this visit */
  }
}

export const accounts: AccountsRegistry = {
  async list() {
    const local = await localList();
    return local.sort((a, b) => a.createdAt - b.createdAt);
  },
  async save(meta) {
    await localPut(meta);
    const cloud = await readCloud();
    await writeCloud([...cloud.filter((m) => m.id !== meta.id), meta]);
  },
  async remove(id) {
    memory.delete(id);
    const db = await registryDb();
    try {
      await db?.delete('accounts', id);
    } catch {
      /* ignore */
    }
    await deleteDatabase(accountDbName(id));
    const cloud = await readCloud();
    if (cloud.some((m) => m.id === id)) await writeCloud(cloud.filter((m) => m.id !== id));
  },
};

/** Accounts that exist in the viewer's cloud store but not yet on this device. */
export async function cloudOnlyAccounts(): Promise<ProfileMeta[]> {
  const [local, cloud] = await Promise.all([localList(), readCloud()]);
  const ids = new Set(local.map((m) => m.id));
  return cloud.filter((m) => !ids.has(m.id));
}

/**
 * Remember the last account used on this device, so the login screen can preselect it.
 * Passing null records guest mode, which reopens straight into the guest journal next time.
 */
export function rememberLastAccount(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem('edgelab:last-account', id);
      localStorage.setItem('edgelab:last-mode', 'account');
    } else localStorage.setItem('edgelab:last-mode', 'guest');
  } catch {
    /* storage may be blocked */
  }
}

export function lastModeWasGuest(): boolean {
  try {
    return localStorage.getItem('edgelab:last-mode') === 'guest';
  } catch {
    return false;
  }
}

export function lastAccount(): string | null {
  try {
    return localStorage.getItem('edgelab:last-account');
  } catch {
    return null;
  }
}

// Wrong-password cooldown: 5 free attempts, then 30 s, doubling each further miss.
const fails = new Map<string, { count: number; until: number }>();

export function cooldownLeft(id: string): number {
  const f = fails.get(id);
  return f ? Math.max(0, Math.ceil((f.until - Date.now()) / 1000)) : 0;
}

export function recordFailure(id: string): number {
  const f = fails.get(id) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + 30_000 * 2 ** (f.count - 5);
  fails.set(id, f);
  return cooldownLeft(id);
}

export function clearFailures(id: string): void {
  fails.delete(id);
}

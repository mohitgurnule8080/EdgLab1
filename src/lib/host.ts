/**
 * Optional bridge to the page host. When EdgeLab is published as a Claude artifact, the host
 * injects `window.claude.use(name)`, which hands out capabilities such as a per-user document
 * store and file downloads. In a normal deployment (Vercel, Netlify, GitHub Pages) there is
 * no host, every helper here returns null, and the app falls back to plain browser APIs.
 */

interface Host {
  use(name: string): Promise<unknown>;
}

function currentHost(): Host | null {
  const c = (globalThis as { claude?: Host }).claude;
  return c && typeof c.use === 'function' ? c : null;
}

/** Wait briefly for the host to appear; resolves null in a normal deployment. */
export async function waitForHost(ms = 2500): Promise<Host | null> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const h = currentHost();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 100));
  }
  return currentHost();
}

export async function useCapability<T>(name: string, timeoutMs = 10_000): Promise<T | null> {
  const h = currentHost();
  if (!h) return null;
  try {
    return (await Promise.race([h.use(name), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])) as T | null;
  } catch {
    return null;
  }
}

interface Downloads {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}

export type SaveOutcome = 'saved' | 'declined' | 'failed';

/** Save a generated file: through the host when there is one, otherwise a normal download. */
export async function saveFile(filename: string, text: string, type = 'text/csv'): Promise<SaveOutcome> {
  if (currentHost()) {
    const dl = await useCapability<Downloads>('downloads', 4000);
    if (!dl) return 'failed';
    try {
      await dl.save({ filename, data: text });
      return 'saved';
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

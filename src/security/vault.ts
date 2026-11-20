/**
 * Client-side encryption for EdgeLab accounts.
 *
 * A password never leaves the device and is never stored. It is stretched with PBKDF2-SHA-256
 * (600,000 iterations, OWASP's current guidance) into an AES-256-GCM key, and every journal
 * record is sealed with that key and a fresh random 96-bit IV before it is written anywhere.
 * A small "check" value sealed at account creation lets the app tell a wrong password from a
 * right one without storing anything that reveals the password.
 */

export const KDF_ITERATIONS = 600_000;
const CHECK_TEXT = 'edgelab:v1';

export interface Sealed {
  iv: string;
  ct: string;
}

export interface ProfileMeta {
  id: string;
  name: string;
  salt: string;
  iterations: number;
  check: Sealed;
  createdAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** Throws if the key is wrong or the data was tampered with (GCM authenticates it). */
export async function unseal<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ct));
  return JSON.parse(decoder.decode(pt)) as T;
}

/** Compact "iv.ct" form for places that store a single string. */
export const packSealed = (s: Sealed) => `${s.iv}.${s.ct}`;
export function unpackSealed(text: string): Sealed {
  const i = text.indexOf('.');
  return { iv: text.slice(0, i), ct: text.slice(i + 1) };
}

export async function createProfile(name: string, password: string, iterations = KDF_ITERATIONS): Promise<{ meta: ProfileMeta; key: CryptoKey }> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, iterations);
  const id = toBase64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, 'x');
  const meta: ProfileMeta = { id, name: name.trim(), salt: toBase64(salt), iterations, check: await seal(key, CHECK_TEXT), createdAt: Date.now() };
  return { meta, key };
}

/** The account's key, or null when the password is wrong. */
export async function unlockProfile(meta: ProfileMeta, password: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, fromBase64(meta.salt), meta.iterations);
  try {
    return (await unseal<string>(key, meta.check)) === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/** Rough strength estimate: length and variety. Good enough to steer people away from "123456". */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: 'Enter a password' };
  const common = /^(password|qwerty|123456|111111|abc123|iloveyou|admin|letmein|forex|trading)/i.test(pw);
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/\d/.test(pw)) variety++;
  if (/[^a-zA-Z0-9]/.test(pw)) variety++;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (variety >= 3) score++;
  if (pw.length >= 16 || (pw.length >= 12 && variety === 4)) score++;
  if (common || pw.length < 8) score = Math.min(score, 1);
  const s = score as Strength['score'];
  return { score: s, label: ['Too short', 'Weak', 'Okay', 'Strong', 'Very strong'][s] };
}

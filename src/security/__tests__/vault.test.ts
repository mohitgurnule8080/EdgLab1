import { describe, expect, it } from 'vitest';
import { createProfile, fromBase64, packSealed, passwordStrength, seal, toBase64, unlockProfile, unpackSealed, unseal } from '../vault';

const FAST = 1000; // keep tests quick; production uses 600,000 iterations

describe('vault', () => {
  it('unlocks with the right password only', async () => {
    const { meta, key } = await createProfile('Trader', 'correct horse battery', FAST);
    expect(await unlockProfile(meta, 'correct horse battery')).not.toBeNull();
    expect(await unlockProfile(meta, 'wrong password')).toBeNull();
    const sealed = await seal(key, { pnl: 400 });
    const again = await unlockProfile(meta, 'correct horse battery');
    expect(await unseal(again!, sealed)).toEqual({ pnl: 400 });
  });

  it('never stores the password and uses a fresh IV per record', async () => {
    const { meta, key } = await createProfile('A', 'hunter2hunter2', FAST);
    expect(JSON.stringify(meta)).not.toContain('hunter2');
    const a = await seal(key, 'same');
    const b = await seal(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(fromBase64(a.iv)).toHaveLength(12);
  });

  it('detects tampering', async () => {
    const { key } = await createProfile('A', 'pw-pw-pw-pw', FAST);
    const s = await seal(key, { notes: 'secret setup' });
    const bytes = fromBase64(s.ct);
    bytes[0] ^= 1;
    await expect(unseal(key, { iv: s.iv, ct: toBase64(bytes) })).rejects.toBeTruthy();
  });

  it('round-trips large payloads and the packed form', async () => {
    const { key } = await createProfile('A', 'pw-pw-pw-pw', FAST);
    const big = { list: Array.from({ length: 5000 }, (_, i) => ({ id: i, notes: 'x'.repeat(20) })) };
    const s = await seal(key, big);
    expect(await unseal(key, unpackSealed(packSealed(s)))).toEqual(big);
  });

  it('rates passwords', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('123456789').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('forexking2026').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('Gold&London-2026').score).toBeGreaterThanOrEqual(3);
  });
});

// src/game/rng.ts
// Small deterministic RNG for debugging (seeded). Not crypto-safe.

export class XorShift32 {
  private x: number;

  constructor(seed: number) {
    // Avoid 0 state.
    this.x = (seed | 0) || 0x12345678;
  }

  nextU32(): number {
    // xorshift32
    let x = this.x | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x | 0;
    // Convert signed int to unsigned
    return (this.x >>> 0);
  }

  nextFloat01(): number {
    // [0,1)
    return this.nextU32() / 4294967296;
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error("maxExclusive must be > 0");
    return Math.floor(this.nextFloat01() * maxExclusive);
  }

  pickWeighted<T extends string>(weights: Record<T, number>, enabled?: Record<T, boolean>): T {
    let total = 0;
    const keys = Object.keys(weights) as T[];
    for (const k of keys) {
      const w = weights[k] ?? 0;
      if (enabled && enabled[k] === false) continue;
      if (w > 0) total += w;
    }
    if (total <= 0) {
      throw new Error("No selectable items in weights (total <= 0).");
    }
    let r = this.nextFloat01() * total;
    for (const k of keys) {
      if (enabled && enabled[k] === false) continue;
      const w = weights[k] ?? 0;
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return k;
    }
    // Fallback (shouldn't happen due to float)
    return keys.find(k => !enabled || enabled[k] !== false) as T;
  }
}

// Deterministic PRNG (splitmix32-style integer hash chain); the only randomness in fdm/.
export class Rng {
  s: number;
  constructor(seed: string | number) {
    let h = 2166136261 >>> 0;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    this.s = h || 1;
  }
  next(): number { // [0, 1)
    let z = (this.s = (this.s + 0x9e3779b9) >>> 0);
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  }
  normal(): number { // sum of 4 uniforms, unit variance (deterministic, no log/cos)
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }
}

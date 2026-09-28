// Deterministic transcendental functions for the flight model. Math.sin / exp / pow / atan2 … are not specified to
// the last bit and differ between V8 versions (Node vs Chrome gave a 1-ulp split in 12 steps); these use only
// operations IEEE 754 fixes exactly (+ − × ÷ sqrt, comparisons, floor) in a fixed order, so every engine computes the
// same bits. Accuracy is a few ulp: range reduction plus Taylor / atanh series far past double precision.
const PI = 3.141592653589793, PIO2_1 = 1.5707963267341256, PIO2_2 = 6.077100506506192e-11, PIO2_3 = 2.0222662487959506e-21;
const INV_PIO2 = 0.6366197723675814, LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10, INV_LN2 = 1.4426950408889634;

const buf = new DataView(new ArrayBuffer(8));
// 2^k exactly (k integer, −1022 ≤ k ≤ 1023)
function pow2i(k: number): number {
  if (k > 1023) return Infinity; if (k < -1022) return 0;
  buf.setUint32(0, (k + 1023) << 20); buf.setUint32(4, 0);
  return buf.getFloat64(0);
}

// sin / cos of a reduced argument |r| ≤ π/4 (Taylor to the 21st / 20th power, Horner)
function ksin(r: number): number { const z = r * r; return r * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800 + z * (-1 / 1307674368000 + z * (1 / 355687428096000 + z * (-1 / 121645100408832000 + z / 51090942171709440000)))))))))); }
function kcos(r: number): number { const z = r * r; return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200 + z * (1 / 20922789888000 + z * (-1 / 6402373705728000 + z / 2432902008176640000))))))))); }
function reduce(x: number): [number, number] { // x = n·π/2 + r
  const n = Math.round(x * INV_PIO2);
  const r = ((x - n * PIO2_1) - n * PIO2_2) - n * PIO2_3;
  return [n, r];
}
export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [n, r] = reduce(x), q = ((n % 4) + 4) % 4;
  return q === 0 ? ksin(r) : q === 1 ? kcos(r) : q === 2 ? -ksin(r) : -kcos(r);
}
export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [n, r] = reduce(x), q = ((n % 4) + 4) % 4;
  return q === 0 ? kcos(r) : q === 1 ? -ksin(r) : q === 2 ? -kcos(r) : ksin(r);
}
export function tan(x: number): number { return sin(x) / cos(x); }

export function exp(x: number): number {
  if (x !== x) return NaN; if (x > 709.78) return Infinity; if (x < -745.2) return 0;
  const k = Math.round(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO; // |r| ≤ ln2/2
  let s = 1, t = 1;
  for (let i = 1; i <= 17; i++) { t = t * r / i; s += t; }
  return k < -1020 ? s * pow2i(k + 60) * pow2i(-60) : s * pow2i(k);
}
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  // x = m · 2^e with m in [√½, √2)
  buf.setFloat64(0, x);
  let e = ((buf.getUint32(0) >>> 20) & 0x7ff);
  let m: number;
  if (e === 0) { return log(x * 18014398509481984) - 54 * (LN2_HI + LN2_LO); } // subnormal: scale by 2^54
  e -= 1023; buf.setUint32(0, (buf.getUint32(0) & 0x800fffff) | (1023 << 20)); m = buf.getFloat64(0);
  if (m > 1.4142135623730951) { m = m / 2; e += 1; }
  const s = (m - 1) / (m + 1), z = s * s;
  let p = 0; for (let i = 23; i >= 3; i -= 2) p = (p + 1 / i) * z;
  const lm = 2 * s * (1 + p);
  return e * LN2_HI + (e * LN2_LO + lm);
}
export function pow(a: number, b: number): number {
  if (b === 0) return 1; if (a === 1) return 1; if (b === 1) return a;
  if (a < 0) { if (Math.floor(b) !== b) return NaN; const r = exp(b * log(-a)); return (Math.abs(b) % 2 === 1) ? -r : r; }
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (b === 2) return a * a; if (b === 0.5) return Math.sqrt(a);
  return exp(b * log(a));
}
export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0; let a = neg ? -x : x, off = 0;
  if (a > 1) { a = 1 / a; off = 1; }
  // two half-angle reductions: atan(a) = 4 atan(t), |t| ≤ tan(π/16)
  let t = a / (1 + Math.sqrt(1 + a * a)); t = t / (1 + Math.sqrt(1 + t * t));
  const z = t * t; let p = 0;
  for (let i = 27; i >= 3; i -= 2) p = (((i - 1) / 2) % 2 === 1 ? -1 : 1) / i + p * z; // alternating series, Horner from the top
  let r = 4 * (t + t * z * p);
  if (off) r = PI / 2 - r;
  return neg ? -r : r;
}
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : 0;
}
export function asin(x: number): number { return x >= 1 ? PI / 2 : x <= -1 ? -PI / 2 : atan2(x, Math.sqrt((1 - x) * (1 + x))); }
export function acos(x: number): number { return x >= 1 ? 0 : x <= -1 ? PI : atan2(Math.sqrt((1 - x) * (1 + x)), x); }
export function hypot(...v: number[]): number { let s = 0; for (const a of v) s += a * a; return Math.sqrt(s); }
export function tanh(x: number): number { if (x > 20) return 1; if (x < -20) return -1; const e2 = exp(2 * x); return (e2 - 1) / (e2 + 1); }

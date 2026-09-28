// Small vector / quaternion kit for the flight model. Plain number arrays, no allocation in the hot path beyond
// what callers pass in. Frames: NED world (north, east, down), body (x forward, y right, z down).
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number]; // w, x, y, z — rotates body → NED

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const DEG = Math.PI / 180;
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048;
export const G0 = 9.80665;

// v in body → NED
export function rotate(q: Q4, v: V3): V3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
// v in NED → body
export function unrotate(q: Q4, v: V3): V3 { return rotate([q[0], -q[1], -q[2], -q[3]], v); }

export function qmul(a: Q4, b: Q4): Q4 {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
export function qnorm(q: Q4): Q4 { const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }

// Euler (heading ψ, pitch θ, bank φ; aerospace 3-2-1) ↔ quaternion
export function qFromEuler(psi: number, theta: number, phi: number): Q4 {
  const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2), cp = Math.cos(theta / 2), sp = Math.sin(theta / 2), cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
export function eulerFromQ(q: Q4): { psi: number; theta: number; phi: number } {
  const [w, x, y, z] = q;
  const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { psi, theta, phi };
}
// integrate q by body rates ω over dt (exact rotation of the constant-rate step)
export function qIntegrate(q: Q4, w: V3, dt: number): Q4 {
  const a = len(w) * dt;
  if (a < 1e-12) return q;
  const s = Math.sin(a / 2) / (a / dt), c = Math.cos(a / 2);
  return qnorm(qmul(q, [c, w[0] * s, w[1] * s, w[2] * s]));
}
export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;
export const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

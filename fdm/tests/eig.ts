// Eigenvalues of a small real matrix: characteristic polynomial by Faddeev–LeVerrier, roots by Durand–Kerner.
export type C = [number, number];
const cm = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cd = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
export function charPoly(A: number[][]): number[] { // monic, highest power first: [1, c1, …, cn]
  const n = A.length;
  let M = A.map((r) => r.map(() => 0));
  const c = [1];
  for (let k = 1; k <= n; k++) {
    // M_k = A M_{k−1} + c_{k−1} I ; c_k = −trace(A M_k) / k
    const AM = A.map((r, i) => r.map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    M = AM.map((r, i) => r.map((v, j) => v + (i === j ? c[k - 1] : 0)));
    const AMk = A.map((r, i) => r.map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    let tr = 0; for (let i = 0; i < n; i++) tr += AMk[i][i];
    c.push(-tr / k);
  }
  return c;
}
export function roots(p: number[]): C[] {
  const n = p.length - 1;
  const ev = (z: C): C => { let r: C = [p[0], 0]; for (let i = 1; i <= n; i++) r = [r[0] * z[0] - r[1] * z[1] + p[i], r[0] * z[1] + r[1] * z[0]]; return r; };
  const scale = 1 + Math.max(...p.slice(1).map(Math.abs));
  let z: C[] = Array.from({ length: n }, (_, k) => { const a = 2 * Math.PI * k / n + 0.4; return [scale * 0.5 * Math.cos(a), scale * 0.5 * Math.sin(a)]; });
  for (let it = 0; it < 2000; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let den: C = [1, 0];
      z.forEach((zj, j) => { if (j !== i) den = cm(den, [zi[0] - zj[0], zi[1] - zj[1]]); });
      const d = cd(ev(zi), den);
      moved = Math.max(moved, Math.hypot(d[0], d[1]));
      return [zi[0] - d[0], zi[1] - d[1]];
    });
    if (moved < 1e-13) break;
  }
  return z.map((r) => [r[0], Math.abs(r[1]) < 1e-9 ? 0 : r[1]]);
}
export const eig = (A: number[][]): C[] => roots(charPoly(A));

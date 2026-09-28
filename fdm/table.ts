// Coefficient tables. Every row carries its source id and VERIFIED / APPROX (SPEC §3); gate F0 checks them.
export type Status = 'VERIFIED' | 'APPROX';
export interface Scalar { v: number; src: string; st: Status; note?: string }
// 1-D: rows [x, y, src, st]; 2-D: cols = column keys (e.g. flap degrees), rows [x, y0, y1, …, src, st]
export interface Table1 { x: string; rows: [number, number, string, Status][] }
export interface Table2 { x: string; col: string; cols: number[]; rows: (number | string)[][] }

export function lerp1(t: Table1, x: number): number {
  const r = t.rows, n = r.length;
  if (x <= r[0][0]) return r[0][1];
  if (x >= r[n - 1][0]) return r[n - 1][1];
  let i = 1; while (r[i][0] < x) i++;
  const a = r[i - 1], b = r[i], u = (x - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * u;
}
// bilinear in (x, column value)
export function lerp2(t: Table2, x: number, c: number): number {
  const cols = t.cols, nc = cols.length;
  let j = 0; while (j < nc - 2 && cols[j + 1] < c) j++;
  const cu = nc === 1 ? 0 : Math.min(1, Math.max(0, (c - cols[j]) / (cols[j + 1] - cols[j])));
  const r = t.rows, n = r.length;
  const col = (row: (number | string)[], k: number) => row[1 + k] as number;
  let i = 1;
  const xs = (row: (number | string)[]) => row[0] as number;
  let u = 0;
  if (x <= xs(r[0])) { i = 1; u = 0; } else if (x >= xs(r[n - 1])) { i = n - 1; u = 1; } else { while (xs(r[i]) < x) i++; u = (x - xs(r[i - 1])) / (xs(r[i]) - xs(r[i - 1])); }
  const at = (k: number) => col(r[i - 1], k) + (col(r[i], k) - col(r[i - 1], k)) * u;
  if (nc === 1) return at(0);
  return at(j) + (at(j + 1) - at(j)) * cu;
}
export const S = (v: number, src: string, st: Status, note?: string): Scalar => (note ? { v, src, st, note } : { v, src, st });

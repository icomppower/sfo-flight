// The ground the aircraft meets: the title's terrain square (the same Float32 heights and bilinear formula as the
// engine's HeightField, so the wheels touch what is drawn), the low-detail ring beyond it (30 m band, 120 m outer,
// flat water), the paved mask around the airport and the roof grid of buildings and landmarks. Pure: typed arrays in,
// no IO — the browser (src/game/worlddata.js) and the gates (gates/lib/world.mjs) load the same files.
import { SURF, type Ground } from './sim.ts';

export interface Grid { data: Float32Array | Int16Array | Uint16Array | Uint8Array; res: number; cell: number; originX: number; originZ: number }
export interface WorldArrays {
  square: { heights: Float32Array; res: number; size: number }; // engine terrain (row 0 = north, x east)
  band?: Grid & { data: Int16Array }; // ring band, decimetres, −32768 = water
  outer?: Grid & { data: Int16Array }; // ring outer
  paved?: Grid & { data: Uint8Array };
  roofs?: Grid & { data: Uint16Array }; // (top + 50 m) × 10, 0 = open
  runways?: RunwayRect[]; // title frame, NASR ends, pavement half width
  lift?: number; // override of RUNWAY_LIFT (gate fixtures)
}
export const WATER = -32768;
// the drawn runway pavement stands this far above the terrain (src/game/airfield.js): wheels roll on it
export const RUNWAY_LIFT = 0.32;
export interface RunwayRect { ax: number; az: number; bx: number; bz: number; halfW: number }

export class WorldGround implements Ground {
  w: WorldArrays; half: number; texel: number;
  constructor(w: WorldArrays) { this.w = w; this.half = w.square.size / 2; this.texel = w.square.size / w.square.res; }

  // terrain in the square: HeightField.heightAt verbatim (cell-centred samples, clamp outside → −90)
  private sq(x: number, z: number): number {
    const { res, heights } = this.w.square, texel = this.texel, origin = -this.half;
    const fx = (x - origin) / texel - 0.5, fz = (z - origin) / texel - 0.5;
    if (fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1) return -90;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * res + i;
    const a = heights[k], b = heights[k + 1], c = heights[k + res], d = heights[k + res + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  // a ring grid: vertex-centred samples; water counts as 0 m
  private ring(g: Grid & { data: Int16Array }, x: number, z: number): number {
    const fx = (x - g.originX) / g.cell, fz = (z - g.originZ) / g.cell;
    if (fx < 0 || fz < 0 || fx >= g.res - 1 || fz >= g.res - 1) return NaN;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * g.res + i, D = g.data;
    const v = (q: number) => (D[q] === WATER ? 0 : D[q] / 10);
    return (v(k) * (1 - tx) + v(k + 1) * tx) * (1 - tz) + (v(k + g.res) * (1 - tx) + v(k + g.res + 1) * tx) * tz;
  }
  private ringWater(g: Grid & { data: Int16Array }, x: number, z: number): boolean | null {
    const i = Math.round((x - g.originX) / g.cell), j = Math.round((z - g.originZ) / g.cell);
    if (i < 0 || j < 0 || i >= g.res || j >= g.res) return null;
    return g.data[j * g.res + i] === WATER;
  }
  inSquare(x: number, z: number): boolean { return Math.abs(x) < this.half - this.texel && Math.abs(z) < this.half - this.texel; }

  // title-frame helpers (x east, z south)
  onRunway(x: number, z: number): boolean {
    for (const r of this.w.runways || []) {
      const dx = r.bx - r.ax, dz = r.bz - r.az, L2 = dx * dx + dz * dz, t = ((x - r.ax) * dx + (z - r.az) * dz) / L2;
      if (t < 0 || t > 1) continue;
      const px = r.ax + dx * t - x, pz = r.az + dz * t - z;
      if (px * px + pz * pz <= r.halfW * r.halfW) return true;
    }
    return false;
  }
  heightXZ(x: number, z: number): number {
    if (this.inSquare(x, z)) { const h = this.sq(x, z); return this.onRunway(x, z) ? h + (this.w.lift ?? RUNWAY_LIFT) : Math.max(h, this.pavedXZ(x, z) ? -90 : 0); }
    const { band, outer } = this.w;
    let h = band ? this.ring(band, x, z) : NaN;
    if (Number.isNaN(h) && outer) h = this.ring(outer, x, z);
    return Number.isNaN(h) ? 0 : h;
  }
  pavedXZ(x: number, z: number): boolean {
    const p = this.w.paved; if (!p) return false;
    const i = Math.floor((x - p.originX) / p.cell), j = Math.floor((z - p.originZ) / p.cell);
    return i >= 0 && j >= 0 && i < p.res && j < p.res && p.data[j * p.res + i] === 1;
  }
  surfaceXZ(x: number, z: number): number {
    if (this.pavedXZ(x, z)) return SURF.PAVED;
    if (this.inSquare(x, z)) return this.sq(x, z) < 0 ? SURF.WATER : SURF.GROUND;
    const { band, outer } = this.w;
    let wtr = band ? this.ringWater(band, x, z) : null;
    if (wtr == null && outer) wtr = this.ringWater(outer, x, z);
    return wtr ? SURF.WATER : SURF.GROUND;
  }
  roofXZ(x: number, z: number): number {
    const r = this.w.roofs; if (!r) return -Infinity;
    const i = Math.floor((x - r.originX) / r.cell), j = Math.floor((z - r.originZ) / r.cell);
    if (i < 0 || j < 0 || i >= r.res || j >= r.res) return -Infinity;
    const v = r.data[j * r.res + i];
    return v ? v / 10 - 50 : -Infinity;
  }
  // Ground (NED: n = −z, e = x)
  height(n: number, e: number): number { return this.heightXZ(e, -n); }
  surface(n: number, e: number): number { return this.surfaceXZ(e, -n); }
  roof(n: number, e: number): number { return this.roofXZ(e, -n); }
}

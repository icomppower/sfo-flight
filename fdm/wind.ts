// Wind: the reported mean wind (from `dir`, `kt`, at 10 m), a 1/7-power boundary-layer profile, and turbulence as
// first-order Dryden-form filtered noise with the MIL-F-8785C low-altitude scales and intensities (§3.7.3), driven by
// the seeded Rng. The gust spread in the METAR (G) scales the intensity. NED output, m/s.
import { Rng } from './rng.ts';
import { KT, FT } from './math.ts';

export interface WindSpec { dir: number; kt: number; gustKt: number; turbulence?: number }

export class Wind {
  spec: WindSpec; rng: Rng; u = 0; v = 0; w = 0; on: boolean;
  constructor(spec: WindSpec, seed: string | number) { this.spec = spec; this.rng = new Rng('wind:' + seed); this.on = (spec.turbulence ?? 1) > 0; }
  // mean wind toward NED at height agl (m)
  mean(agl: number, out: number[]): number[] {
    const h = Math.min(Math.max(agl, 1), 500);
    const s = this.spec.kt * KT * Math.pow(h / 10, 1 / 7);
    const d = this.spec.dir * Math.PI / 180;
    out[0] = -s * Math.cos(d); out[1] = -s * Math.sin(d); out[2] = 0;
    return out;
  }
  // advance the turbulence filters one step and add them to the mean wind; tas = airspeed for the length scales
  step(agl: number, tas: number, dt: number, out: number[]): number[] {
    this.mean(agl, out);
    const k = this.spec.turbulence ?? 1;
    if (!this.on || k <= 0) return out;
    const hft = Math.min(Math.max(agl / FT, 10), 2000);
    const lowF = Math.min(hft, 1000);
    const w20 = Math.max(this.spec.kt, 3) * KT * Math.pow(20 * FT / 10, 1 / 7);
    const gustF = 1 + Math.min(2, Math.max(0, this.spec.gustKt - this.spec.kt) / Math.max(this.spec.kt, 5));
    const sw = 0.1 * w20 * gustF * k;
    const suv = sw / Math.pow(0.177 + 0.000823 * lowF, 0.4);
    const Lw = hft * FT, Luv = hft / Math.pow(0.177 + 0.000823 * lowF, 1.2) * FT;
    const V = Math.max(tas, 5);
    const au = Math.exp(-V * dt / Luv), aw = Math.exp(-V * dt / Lw);
    this.u = au * this.u + suv * Math.sqrt(1 - au * au) * this.rng.normal();
    this.v = au * this.v + suv * Math.sqrt(1 - au * au) * this.rng.normal();
    this.w = aw * this.w + sw * Math.sqrt(1 - aw * aw) * this.rng.normal();
    // u along the mean wind, v across it, w vertical (down)
    const d = this.spec.dir * Math.PI / 180, cn = -Math.cos(d), ce = -Math.sin(d);
    out[0] += this.u * cn - this.v * ce; out[1] += this.u * ce + this.v * cn; out[2] += this.w;
    return out;
  }
}

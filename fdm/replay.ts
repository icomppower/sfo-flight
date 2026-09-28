// Replay: a flight is (aircraft, start, weather, seed) + the control sequence, step by step. Inputs are quantized
// before they reach the Sim (live and in replay alike), stored as changes only, and the run is fingerprinted by an
// FNV-1a hash over the state's float64 bytes once per simulated second and at the end: the same log gives the same
// hash in Node and in the browser (gate F1).
import { Sim, type Controls, type Start, type Weather, type Ground, neutralControls } from './sim.ts';
import type { AircraftData } from './aircraft/types.ts';

const KEYS: (keyof Controls)[] = ['elev', 'ail', 'rud', 'flap', 'gear', 'brakeL', 'brakeR', 'park', 'spoiler', 'trim', 'tiller', 'autobrake', 'mixture', 'mags', 'starter', 'master', 'ap', 'mcpHdg', 'mcpAlt', 'mcpVs', 'mcpSpd'];
const Q = 1024;
export function quantize(c: Controls): Controls {
  for (const k of KEYS) (c as any)[k] = Math.round((c as any)[k] * Q) / Q;
  for (let i = 0; i < c.thr.length; i++) c.thr[i] = Math.round(c.thr[i] * Q) / Q;
  return c;
}

export interface Log { v: 1; aircraft: string; start: Start; weather: Weather; seed: string; steps: number; changes: (number | string)[][] }

export class Recorder {
  log: Log; prev: Controls;
  constructor(ac: AircraftData, start: Start, weather: Weather, seed: string) {
    this.log = { v: 1, aircraft: ac.id, start, weather, seed, steps: 0, changes: [] };
    this.prev = neutralControls(ac);
  }
  // call with the quantized controls of each step, before sim.step
  add(c: Controls): void {
    const s = this.log.steps, p = this.prev;
    for (const k of KEYS) if ((c as any)[k] !== (p as any)[k]) { this.log.changes.push([s, k, Math.round((c as any)[k] * Q)]); (p as any)[k] = (c as any)[k]; }
    for (let i = 0; i < c.thr.length; i++) if (c.thr[i] !== p.thr[i]) { this.log.changes.push([s, 'thr' + i, Math.round(c.thr[i] * Q)]); p.thr[i] = c.thr[i]; }
    this.log.steps++;
  }
}

export class Hasher {
  h = 0x811c9dc5 >>> 0; buf = new Float64Array(32); bytes = new Uint8Array(this.buf.buffer);
  add(sim: Sim): void {
    const b = this.buf; let n = 0;
    for (const v of sim.pos) b[n++] = v; for (const v of sim.vel) b[n++] = v; for (const v of sim.q) b[n++] = v; for (const v of sim.w) b[n++] = v;
    b[n++] = sim.rpm; for (const v of sim.n1) b[n++] = v; b[n++] = sim.fuel; b[n++] = sim.trimPos; b[n++] = sim.de; b[n++] = sim.da; b[n++] = sim.dr; b[n++] = sim.t;
    let h = this.h;
    const by = this.bytes;
    for (let i = 0; i < n * 8; i++) { h ^= by[i]; h = Math.imul(h, 16777619) >>> 0; }
    this.h = h;
  }
  hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

// run a log from the start; `each` sees the sim after every step (the replay camera / director reads it)
export function replay(log: Log, ac: AircraftData, ground?: Ground, each?: (sim: Sim, step: number) => void): { sim: Sim; hash: string } {
  const sim = new Sim(ac, { start: log.start, weather: log.weather, seed: log.seed, ground });
  const c = neutralControls(ac);
  const hs = new Hasher();
  let k = 0;
  const ch = log.changes;
  for (let s = 0; s < log.steps; s++) {
    while (k < ch.length && ch[k][0] === s) {
      const [, key, v] = ch[k++] as [number, string, number];
      if (key.startsWith('thr')) c.thr[Number(key.slice(3))] = v / Q; else (c as any)[key] = v / Q;
    }
    sim.step(c);
    if (each) each(sim, s);
    if ((s + 1) % 120 === 0) hs.add(sim);
  }
  hs.add(sim);
  return { sim, hash: hs.hex() };
}

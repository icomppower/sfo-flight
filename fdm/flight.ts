// One flight: the Sim plus the heavy's autopilot, the landing scorer, the replay recorder and the hash — the loop
// the page runs 120 times a second and the loop a replay re-runs, identically.
import { Sim, type Controls, type Start, type Weather, type Ground, neutralControls } from './sim.ts';
import { trimFly } from './pilot.ts';
import { Autopilot } from './autopilot.ts';
import { Scorer, type RunwayEnd } from './score.ts';
import { Recorder, Hasher, quantize, type Log } from './replay.ts';
import type { IlsDef } from './ils.ts';
import type { AircraftData } from './aircraft/types.ts';

export interface World { ground?: Ground; ils: IlsDef[]; runways: RunwayEnd[] }

export class Flight {
  sim: Sim; ap: Autopilot | null; initial: Controls; scorer: Scorer; rec: Recorder; hash = new Hasher(); applied: Controls;
  ac: AircraftData; start: Start; weather: Weather; seed: string; world: World;
  constructor(ac: AircraftData, start: Start, weather: Weather, seed: string, world: World) {
    this.ac = ac; this.start = start; this.weather = weather; this.seed = seed; this.world = world;
    this.sim = new Sim(ac, { start, weather, seed, ground: world.ground });
    this.initial = neutralControls(ac);
    this.initial.flap = start.flap ?? 0; this.initial.gear = start.gear ?? 1;
    if (start.alt != null) {
      // airborne start: trim in calm air at the start's speed and flight path, then take the state over
      const t = trimFly(ac, { alt: start.alt, cas: start.cas ?? 100, gamma: start.gamma ?? 0, flap: start.flap ?? 0, gear: start.gear ?? (ac.gearRetract ? 0 : 1), mass: start.mass, hdg: start.hdg, seconds: 200 });
      this.sim.adopt(t.sim);
      this.initial.thr = t.c.thr.slice();
    } else if (start.engineOn === false) { this.initial.mixture = 0; this.initial.mags = 0; this.initial.master = 0; }
    if (start.alt == null && start.park) this.initial.park = 1;
    this.ap = ac.engine.kind === 'turbofan' ? new Autopilot(world.ils) : null;
    this.scorer = new Scorer(world.runways);
    this.rec = new Recorder(ac, start, weather, seed, this.initial);
    this.applied = neutralControls(ac);
  }
  step(pilot: Controls): void {
    quantize(pilot);
    this.rec.add(pilot);
    const c = this.applied;
    Object.assign(c, pilot); c.thr = pilot.thr.slice();
    if (this.ap) this.ap.apply(this.sim, c);
    this.sim.step(c);
    this.scorer.update(this.sim);
    if (this.sim.steps % 120 === 0) this.hash.add(this.sim);
  }
  get log(): Log { return this.rec.log; }
  static replay(log: Log, ac: AircraftData, world: World, each?: (f: Flight, i: number) => void): Flight {
    const f = new Flight(ac, log.start, log.weather, log.seed, world);
    const c = { ...f.initial, thr: f.initial.thr.slice() };
    const Q = 1024; let k = 0;
    for (let s = 0; s < log.steps; s++) {
      while (k < log.changes.length && log.changes[k][0] === s) {
        const [, key, v] = log.changes[k++] as [number, string, number];
        if (key.startsWith('thr')) c.thr[Number(key.slice(3))] = v / Q; else (c as any)[key] = v / Q;
      }
      f.step(c);
      if (each) each(f, s);
    }
    return f;
  }
  finalHash(): string { const h = new Hasher(); h.h = this.hash.h; h.add(this.sim); return h.hex(); }
}

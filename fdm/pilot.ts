// The scripted test pilot: simple, deterministic control laws that fly the Sim for trimming (airborne starts),
// the headless gates (F1–F4) and the page's scripted flights. It writes Controls; it never touches Sim state.
// Not the 777's autopilot (fdm/autopilot.ts), which is a product feature with its own modes.
import { type Sim, type Controls, DT } from './sim.ts';
import { clamp, DEG, KT, FT, wrap180 } from './math.ts';

export interface Gains { spdP: number; spdI: number; gamI: number; gamP: number; th: number; q: number; ph: number; p: number; r: number; beta: number; thrP: number; thrI: number; gamAlt: number; trimK: number; hdgK: number; maxBank: number }
export const GAINS: Record<string, Gains> = {
  c172: { spdP: 0.006, spdI: 0.0015, gamI: 1.2, gamP: 0.6, th: 2.2, q: 0.9, ph: 1.6, p: 0.35, r: 0.8, beta: 1.5, thrP: 0.06, thrI: 0.015, gamAlt: 0.004, trimK: 3, hdgK: 1.2, maxBank: 25 },
  b77w: { spdP: 0.004, spdI: 0.0006, gamI: 0.3, gamP: 0.35, th: 3.5, q: 2.6, ph: 2.2, p: 1.2, r: 1.5, beta: 2.0, thrP: 0.035, thrI: 0.006, gamAlt: 0.0022, trimK: 6, hdgK: 1.0, maxBank: 25 },
};

export interface Target {
  alt?: number; // m MSL (altitude hold via γ)
  vs?: number; // m/s (vertical speed hold via γ) — ignored when alt is set
  gamma?: number; // rad
  pitch?: number; // rad (direct pitch hold)
  cas?: number; // kt: speed by throttle (default) or by pitch when speedOnPitch
  speedOnPitch?: boolean;
  thr?: number; // fixed thrust lever 0..1 (overrides the speed loop)
  hdg?: number; // deg true (heading via bank)
  bank?: number; // rad (direct bank hold)
  track?: { n: number; e: number; crs: number }; // fly the line through (n, e) on course crs (deg): lateral guidance
  ball?: boolean; // coordinate with rudder (β → 0)
  noTrim?: boolean;
}

export class TestPilot {
  sim: Sim; g: Gains; iThr = 0; thrBase: number; gamSpd: number | null = null; thetaCmd: number | null = null;
  constructor(sim: Sim, thrBase = 0.6) { this.sim = sim; this.g = GAINS[sim.ac.id]; this.thrBase = thrBase; }

  fly(c: Controls, T: Target): Controls {
    const s = this.sim, g = this.g, e = s.euler;
    const V = Math.max(s.tas, 10);
    const gamma = D.asin(clamp(-s.vel[2] / Math.max(D.hypot(s.vel[0], s.vel[1], s.vel[2]), 1), -1, 1));
    // ---- vertical: γ command → pitch command → elevator
    let thCmd: number;
    if (T.pitch != null) thCmd = T.pitch;
    else {
      let gCmd = T.gamma ?? 0;
      if (T.speedOnPitch && T.cas != null) {
        // speed on pitch: too fast → climb steeper (an integrating γ command on the speed error)
        const err = s.cas - T.cas;
        if (this.gamSpd == null) this.gamSpd = gamma;
        this.gamSpd = clamp(this.gamSpd + err * g.spdI * DT, -0.25, 0.3);
        gCmd = this.gamSpd + err * g.spdP;
      } else if (T.alt != null) gCmd = clamp((T.alt - s.altMsl) * g.gamAlt * (60 / Math.max(V, 30)), -0.12, 0.12);
      else if (T.vs != null) gCmd = clamp(T.vs / V, -0.2, 0.25);
      // flight-path loop: the pitch command integrates the γ error (a θ command built from α feeds back on itself)
      if (this.thetaCmd == null) this.thetaCmd = e.theta;
      this.thetaCmd = clamp(this.thetaCmd + (gCmd - gamma) * g.gamI * DT, -0.35, 0.45);
      thCmd = this.thetaCmd + (gCmd - gamma) * g.gamP;
    }
    const thErr = thCmd - e.theta;
    let elev = -(g.th * thErr - g.q * s.w[1]);
    c.elev = clamp(elev, -1, 1);
    // offload the elevator into trim (nose-up elevator → nose-up trim)
    c.trim = T.noTrim ? 0 : clamp(-c.elev * g.trimK, -1, 1);
    // ---- speed via thrust
    if (T.thr != null) c.thr = c.thr.map(() => T.thr!);
    else if (T.cas != null && !T.speedOnPitch) {
      const err = T.cas - s.cas;
      this.iThr = clamp(this.iThr + err * g.thrI * DT, -1, 1);
      const t = clamp(this.thrBase + this.iThr + err * g.thrP, 0, 1);
      c.thr = c.thr.map(() => t);
    }
    // ---- lateral: heading / track → bank → aileron; rudder for coordination
    let phCmd = 0;
    if (T.bank != null) phCmd = T.bank;
    else if (T.track) {
      const crs = T.track.crs * DEG;
      const dn = s.pos[0] - T.track.n, de = s.pos[1] - T.track.e;
      const xte = -D.sin(crs) * dn + D.cos(crs) * de; // + right of the line
      const trk = D.atan2(s.vel[1], s.vel[0]);
      const intercept = clamp(-xte * 0.004, -0.5, 0.5);
      const hdgErr = wrap180((crs + intercept - trk) / DEG) * DEG;
      phCmd = clamp(hdgErr * g.hdgK * 1.5, -g.maxBank * DEG, g.maxBank * DEG);
    } else if (T.hdg != null) {
      const hdgErr = wrap180(T.hdg - e.psi / DEG) * DEG;
      phCmd = clamp(hdgErr * g.hdgK, -g.maxBank * DEG, g.maxBank * DEG);
    }
    c.ail = clamp(g.ph * (phCmd - e.phi) - g.p * s.w[0], -1, 1);
    if (T.ball !== false && !s.onGround) c.rud = clamp(g.beta * s.beta * 4, -1, 1); // right pedal drives β negative
    return c;
  }
}

// Trim by flying: settle the aircraft at (alt, cas, γ, flap, gear) in calm air and return the state to start from.
import { Sim as SimClass, neutralControls, CALM, flatGround } from './sim.ts';
import type { AircraftData } from './aircraft/types.ts';
import * as D from './dmath.ts';
export interface Trimmed { sim: Sim; c: Controls }
export function trimFly(ac: AircraftData, o: { alt: number; cas: number; gamma?: number; flap?: number; gear?: number; mass?: number; hdg?: number; seconds?: number }): Trimmed {
  const sim = new SimClass(ac, { start: { n: 0, e: 0, alt: o.alt, hdg: o.hdg ?? 0, cas: o.cas, gamma: o.gamma ?? 0, flap: o.flap ?? 0, gear: o.gear ?? (ac.gearRetract ? 0 : 1), mass: o.mass }, weather: CALM, seed: 'trim', ground: flatGround(-3000) });
  const c = neutralControls(ac);
  c.flap = o.flap ?? 0; c.gear = o.gear ?? (ac.gearRetract ? 0 : 1);
  const p = new TestPilot(sim, ac.id === 'c172' ? 0.6 : 0.45);
  const n = Math.round((o.seconds ?? 240) * 120);
  const gam = (o.gamma ?? 0) * DEG;
  for (let i = 0; i < n; i++) {
    // hold the altitude (γ = 0) or the flight-path angle, the speed, wings level on the start heading
    p.fly(c, gam ? { gamma: gam, cas: o.cas, hdg: o.hdg ?? 0 } : { alt: o.alt, cas: o.cas, hdg: o.hdg ?? 0 });
    sim.step(c);
    if (gam) { /* keep the altitude band: a descending trim run restarts at the target altitude */ if (sim.altMsl < o.alt - 150) sim.pos[2] = -o.alt; }
  }
  c.trim = 0;
  return { sim, c };
}
void KT; void FT;

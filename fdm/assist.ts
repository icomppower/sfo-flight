// GAME ASSIST: the light single's autopilot for AUTO LAND (M1.2). The real C172 has none (or at most a single-axis
// wing leveller) — this is a game aid, labelled GAME ASSIST wherever it shows (DECISIONS D22). Modes: wing leveller
// (LVL), heading (HDG), localizer (LOC) and rollout on the lateral side; altitude (ALT), vertical speed (VS), glide
// slope (GS) and flare on the vertical side; speed by throttle. Built on the scripted pilot's control laws
// (fdm/pilot.ts TestPilot, the ones F7 / F9 land the aircraft with), wrapped with mode logic, captures, the flare,
// rollout braking and a bank limit near the ground. Deterministic; writes Controls only.
import { type Sim, type Controls } from './sim.ts';
import { TestPilot, GAINS, type Target } from './pilot.ts';
import { ilsDeviation, type IlsDef, type IlsDev } from './ils.ts';
import { clamp, DEG, FT, KT, wrap180 } from './math.ts';
import * as D from './dmath.ts';

export type ALat = 'LVL' | 'HDG' | 'LOC' | 'ROLLOUT';
export type AVert = 'ALT' | 'VS' | 'GS' | 'FLARE';

export class GameAssist {
  on = false; lat: ALat = 'LVL'; vert: AVert = 'ALT';
  hdg = 0; alt = 0; vs = 0; spd = 70; // deg (grid), m MSL, m/s, KIAS
  ils: IlsDef | null = null; dev: IlsDev | null = null; locArm = false; gsArm = false;
  bankMax = 25; bankLow = 25; // deg; bankLow applies below 100 ft
  flareFt = 15; tdPitch = 4; climbKt = 74; flareThr = 0; kFlSink = 0.05; flSinkMax = 0.08; gsGamI = 0.6; gsGamP = 0.6; thrOffFt = 5; kGs = 0.006; gsLim = 0.035; flareSink = 0; flareTh = 0; brake = 0; stopped = false; disconnectReason = '';
  tp: TestPilot | null = null; private _d = {} as IlsDev;

  engage(s: Sim): void { this.on = true; this.tp = new TestPilot(s, 0.6); this.alt = s.altMsl; this.hdg = ((s.euler.psi / DEG) + 360) % 360; this.stopped = false; this.brake = 0; this.disconnectReason = ''; }
  off(reason: string): void { this.on = false; this.lat = 'LVL'; this.vert = 'ALT'; this.locArm = this.gsArm = false; this.disconnectReason = reason; }
  setVert(v: AVert): void { if (this.vert !== v) { this.vert = v; if (this.tp) { this.tp.thetaCmd = null; this.tp.gamSpd = null; } } }

  apply(s: Sim, c: Controls): Controls {
    if (!this.on || !this.tp) return c;
    if (this.tp.sim !== s) this.tp = new TestPilot(s, 0.6);
    const e = s.euler, I = this.ils;
    this.dev = I ? ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl, this._d) : null;
    const d = this.dev;
    const radAlt = s.altMsl - Math.max(s.groundH, 0) - s.ac.model.gearGround;
    // captures
    if (this.locArm && d && d.valid && Math.abs(d.locDots) < 1.6) { this.lat = 'LOC'; this.locArm = false; }
    if (this.gsArm && d && this.lat === 'LOC' && d.gsDots > -1.0 && d.gsDots < 0.6) { this.setVert('GS'); this.gsArm = false; }
    if (this.vert === 'GS' && radAlt < this.flareFt * FT && !s.onGround) { this.setVert('FLARE'); this.flareSink = Math.abs(s.vel[2]); this.flareTh = clamp(e.theta, -1.5 * DEG, 2 * DEG); this.flareThr = c.thr[0]; }
    if (s.onGround && (this.vert === 'FLARE' || this.lat === 'LOC')) this.lat = 'ROLLOUT';
    const T: Target = {};
    // lateral
    if (this.lat === 'HDG') T.hdg = this.hdg;
    else if (this.lat === 'LOC' && I) T.track = { n: I.thrN, e: I.thrE, crs: I.crs };
    else T.bank = 0;
    // vertical
    if (this.vert === 'ALT') T.alt = this.alt;
    else if (this.vert === 'VS' && this.vs > 0) { T.cas = Math.max(this.climbKt, Math.min(this.spd, 80)); T.speedOnPitch = true; T.thr = 1; } // climb: Vy on pitch, full power
    else if (this.vert === 'VS') T.vs = this.vs;
    else if (this.vert === 'GS' && I && d) {
      const gsGround = -D.atan(D.tan(I.gsDeg * DEG) * s.gs / Math.max(D.hypot(s.vel[0], s.vel[1], s.vel[2]), 1));
      T.gamma = gsGround + clamp(-d.gsErrM * this.kGs, -this.gsLim, this.gsLim);
    }
    if (this.vert === 'FLARE') {
      // rotate from the approach attitude toward the touchdown attitude as the height goes (mains first), trimmed by
      // the sink-rate error; power off
      const h = Math.max(radAlt, 0), vsCmd = -Math.max(h / (this.flareFt * FT) * this.flareSink, 0.3);
      T.pitch = this.flareTh + (this.tdPitch * DEG - this.flareTh) * clamp(1 - h / (this.flareFt * FT), 0, 1) + clamp((vsCmd + s.vel[2]) * this.kFlSink, -0.03, this.flSinkMax);
      // power: from the flare's entry setting down to idle at thrOffFt, never more (a balloon is not flown away)
      T.thr = s.onGround || s.vel[2] > 0 ? 0 : this.flareThr * clamp((h - this.thrOffFt * FT) / ((this.flareFt - this.thrOffFt) * FT), 0, 1);
    } else if (this.lat === 'ROLLOUT') { T.pitch = e.theta; T.thr = 0; delete T.track; T.bank = 0; }
    else if (T.cas == null) T.cas = this.spd;
    // bank limit: the assist's own, tighter near the ground
    // bank limit (tighter near the ground) and, on the glide slope, softer flight-path gains (gusts)
    const g = GAINS.c172, lim = radAlt < 100 * FT ? Math.min(this.bankMax, this.bankLow) : this.bankMax, gs = this.vert === 'GS';
    const gamI = gs ? this.gsGamI : g.gamI, gamP = gs ? this.gsGamP : g.gamP;
    if (this.tp.g.maxBank !== lim || this.tp.g.gamI !== gamI || this.tp.g.gamP !== gamP) this.tp.g = { ...g, maxBank: lim, gamI, gamP };
    this.tp.fly(c, T);
    if (T.bank === 0 && lim < 25) c.ail = clamp(c.ail, -1, 1);
    // rollout: nose wheel onto the centreline, wings level, brakes below 50 kt to a stop, then the parking brake
    if (this.lat === 'ROLLOUT' && I) {
      const dn = s.pos[0] - I.thrN, de = s.pos[1] - I.thrE, lat = -dn * D.sin(I.crs * DEG) + de * D.cos(I.crs * DEG);
      c.rud = clamp(wrap180(I.crs - e.psi / DEG) * DEG * 5 - lat * 0.01, -1, 1);
      c.ail = 0;
      this.brake = s.cas < 50 ? 1 : 0;
      c.brakeL = c.brakeR = this.brake;
      if (s.gs < 0.3) { this.stopped = true; c.park = 1; c.brakeL = c.brakeR = 0; this.off('rollout complete'); }
    }
    return c;
  }
}
void KT;

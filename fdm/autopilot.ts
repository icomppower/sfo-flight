// The heavy twin's autopilot and autothrottle (MCP): HDG SEL, ALT HOLD (with capture), V/S, SPD, LOC and APP
// (LOC + G/S) with capture, then FLARE at 50 ft, RETARD, ROLLOUT on the localizer, disengage at taxi speed.
// It reads the Sim and the ILS and rewrites the pilot's Controls before the step; the pilot's yoke beyond half
// deflection disconnects it. Deterministic (part of the replayed loop, fdm/flight.ts).
import { type Sim, type Controls, DT } from './sim.ts';
import { ilsDeviation, type IlsDef, type IlsDev } from './ils.ts';
import { clamp, DEG, KT, FT, wrap180 } from './math.ts';
import * as D from './dmath.ts';

export const AP_EVENT = { AP: 1, AT: 2, HDG: 3, ALT: 4, VS: 5, LOC: 6, APP: 7, OFF: 8 } as const;
export type Lat = 'ROLL' | 'HDG' | 'LOC' | 'ROLLOUT';
export type Vert = 'PITCH' | 'ALT' | 'ALT*' | 'VS' | 'GS' | 'FLARE';

export class Autopilot {
  on = false; at = false; lat: Lat = 'ROLL'; vert: Vert = 'PITCH'; locArm = false; gsArm = false;
  ils: IlsDef[]; ilsSel: IlsDef | null = null; dev: IlsDev | null = null;
  thetaCmd = 0; alphaLp = 0; gI = 0; nzF = 1; nzI = 0; kGam = 0.5; kNz = 3.5; kNzI = 1.5; kQ = 6; kAt = 0.035; gsKmax = 3; flareMin = 0.6; kFlareGam = 0.525; spdF = 0; thrI = 0; thr = 0.5; flareSink = 0; flareTheta = 0; retard = false; altCapT = 0; disconnectReason = '';
  private _d = {} as IlsDev;
  constructor(ils: IlsDef[]) { this.ils = ils; }

  // the ILS tuned: the runway end whose localizer the aircraft is best aligned with (within 35° and 25 NM)
  tune(s: Sim): IlsDef | null {
    let best: IlsDef | null = null, bestScore = 1e9;
    const hdg = (s.euler.psi / DEG + 360) % 360;
    for (const I of this.ils) {
      const d = ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl, this._d);
      if (!d.valid || d.distNm > 25 || d.distNm < -3) continue;
      const score = Math.abs(wrap180(hdg - I.crs)) + Math.abs(d.locDots) * 5;
      if (score < bestScore) { bestScore = score; best = I; }
    }
    return best;
  }

  event(code: number, s: Sim, c: Controls): void {
    if (!code) return;
    const e = s.euler;
    if (code === AP_EVENT.AP) { if (this.on) this.off('pilot'); else { this.on = true; this.thetaCmd = e.theta; this.alphaLp = s.alpha; this.gI = 0; this.nzI = 0; this.nzF = s.nz; if (this.lat === 'ROLL') this.lat = 'HDG'; if (this.vert === 'PITCH') this.vert = 'VS'; } }
    else if (code === AP_EVENT.AT) { this.at = !this.at; this.thrI = 0; this.thr = c.thr[0]; }
    else if (code === AP_EVENT.HDG) { this.lat = 'HDG'; this.locArm = false; }
    else if (code === AP_EVENT.ALT) { this.vert = 'ALT'; this.gsArm = false; }
    else if (code === AP_EVENT.VS) { this.vert = 'VS'; this.gsArm = false; }
    else if (code === AP_EVENT.LOC) { this.locArm = !this.locArm; }
    else if (code === AP_EVENT.APP) { this.locArm = true; this.gsArm = true; }
    else if (code === AP_EVENT.OFF) { this.off('pilot'); this.at = false; }
  }
  off(reason: string): void { this.on = false; this.lat = 'ROLL'; this.vert = 'PITCH'; this.locArm = this.gsArm = false; this.retard = false; this.disconnectReason = reason; }

  // rewrite the controls for this step
  apply(s: Sim, c: Controls): Controls {
    this.event(c.ap, s, c);
    if (this.on && (Math.abs(c.elev) > 0.5 || Math.abs(c.ail) > 0.5)) this.off('override');
    this.ilsSel = this.tune(s);
    this.dev = this.ilsSel ? ilsDeviation(this.ilsSel, s.pos[0], s.pos[1], s.altMsl, this._d) : null;
    const e = s.euler, V = Math.max(s.tas, 30);
    const radAlt = s.altMsl - Math.max(s.groundH, 0) - s.ac.model.gearGround;
    // ---- autothrottle (also on without the autopilot)
    if (this.at) {
      if (this.retard || this.lat === 'ROLLOUT') { this.thr = Math.max(0, this.thr - DT / 2); }
      else {
        // gust-tolerant speed: airspeed complemented with the inertial along-track acceleration (τ 4 s), so the
        // thrust answers the energy trend, not every gust
        const acc = (s.forceB[0] / s.mass - 9.80665 * D.sin(e.theta)) / KT; // kt/s, inertial along the body
        if (this.spdF === 0) this.spdF = s.cas;
        this.spdF += acc * DT + (s.cas - this.spdF) * DT / 4;
        const err = c.mcpSpd - this.spdF;
        this.thrI = clamp(this.thrI + err * 0.004 * DT, -0.6, 0.6);
        this.thr = clamp(0.45 + this.thrI + err * this.kAt - acc * 0.08, 0.0, 1);
      }
      c.thr = c.thr.map(() => this.thr);
    }
    if (!this.on) return c;
    // ---- captures
    const d = this.dev;
    if (this.locArm && d && this.lat !== 'LOC' && Math.abs(d.locDots) < 1.6) { this.lat = 'LOC'; this.locArm = false; }
    if (this.gsArm && d && this.lat === 'LOC' && d.gsDots < 0.3 && d.gsDots > -1.2) { this.vert = 'GS'; this.gsArm = false; }
    if ((this.vert === 'VS' || this.vert === 'PITCH') && Math.abs(c.mcpAlt * FT - s.altMsl) < Math.max(60, Math.abs(s.vel[2]) * 6)) { this.vert = 'ALT*'; this.altCapT = 0; }
    if (this.vert === 'ALT*') { this.altCapT += DT; if (Math.abs(c.mcpAlt * FT - s.altMsl) < 8 && Math.abs(s.vel[2]) < 1) this.vert = 'ALT'; }
    if (this.vert === 'GS' && radAlt < 50 * FT && !s.onGround) { this.vert = 'FLARE'; this.flareSink = Math.max(1.5, -(-s.vel[2])); this.flareTheta = e.theta; }
    if (this.vert === 'FLARE' && radAlt < 25 * FT) this.retard = true;
    if (s.onGround && (this.vert === 'FLARE' || this.lat === 'LOC')) { this.lat = 'ROLLOUT'; }
    // ---- lateral
    const trk = D.atan2(s.vel[1], s.vel[0]);
    let phCmd = 0;
    if (this.lat === 'HDG') phCmd = clamp(wrap180(c.mcpHdg - e.psi / DEG) * DEG * 1.0, -25 * DEG, 25 * DEG);
    else if (this.lat === 'LOC' && d && this.ilsSel) {
      // track the centreline: intercept angle from the cross-track, flown as a ground track (wind-corrected)
      const xteRate = -D.sin(this.ilsSel.crs * DEG) * s.vel[0] + D.cos(this.ilsSel.crs * DEG) * s.vel[1];
      const want = this.ilsSel.crs * DEG + clamp(-d.xte * 0.0035 - xteRate * 0.02, -0.5, 0.5);
      phCmd = clamp(wrap180((want - trk) / DEG) * DEG * 1.6, -25 * DEG, 25 * DEG);
      if (radAlt < 300 * FT) phCmd = clamp(phCmd, -8 * DEG, 8 * DEG);
    }
    if (this.lat === 'ROLLOUT' && this.ilsSel) {
      // on the ground: rudder / nose wheel onto the centreline, wings level; off at taxi speed
      const hdgErr = wrap180(this.ilsSel.crs - e.psi / DEG) * DEG;
      c.rud = clamp(hdgErr * 4 - (d ? d.xte : 0) * 0.03 - s.w[2] * 1.5, -1, 1);
      c.ail = clamp(-2 * e.phi, -1, 1);
      c.elev = 0.15;
      c.trim = 0;
      if (s.gs < 30 * KT) { c.rud = 0; this.off('rollout complete'); this.at = false; }
      return c;
    }
    if (this.lat !== 'ROLL') c.ail = clamp(2.2 * (phCmd - e.phi) - 1.2 * s.w[0], -1, 1);
    else c.ail = clamp(2.2 * (0 - e.phi) - 1.2 * s.w[0], -1, 1);
    // ---- vertical: flight-path command → pitch command → elevator, stabilizer trim offloads the elevator
    const Vg = D.hypot(s.vel[0], s.vel[1], s.vel[2]);
    const gamma = D.asin(clamp(-s.vel[2] / Math.max(Vg, 1), -1, 1));
    let gCmd = gamma, pitchDirect: number | null = null;
    if (this.vert === 'VS') gCmd = clamp(c.mcpVs * FT / 60 / V, -0.15, 0.15);
    else if (this.vert === 'ALT' || this.vert === 'ALT*') gCmd = clamp((c.mcpAlt * FT - s.altMsl) * 0.004 * (70 / V) - 0 * gamma, -0.1, 0.1);
    else if (this.vert === 'GS' && d && this.ilsSel) {
      // glide path over the ground (wind-corrected), a height-error term whose gain grows as the beam narrows, and
      // a rate term (the flight-path error) for damping
      const I = this.ilsSel;
      const dist = Math.max(300, -d.along + D.hypot(I.gsN - I.thrN, I.gsE - I.thrE));
      const k = 0.003 * Math.min(this.gsKmax, Math.max(1, 3000 / dist));
      const gsGround = -D.atan(D.tan(I.gsDeg * DEG) * D.hypot(s.vel[0], s.vel[1]) / Math.max(Vg, 1));
      gCmd = gsGround + clamp(-d.gsErrM * k, -0.04, 0.04);
    } else if (this.vert === 'FLARE') {
      // exponential flare: sink proportional to height, flown through the same load-factor loop
      const vsCmd = -Math.max(radAlt / (50 * FT) * this.flareSink, this.flareMin);
      gCmd = D.asin(clamp(vsCmd / Math.max(Vg, 1), -0.2, 0.2));
    }
    // flight-path loop through a load-factor inner loop (C*-style): γ error → γ̇ command → nz command → elevator.
    // Commanding nz skips the ~2 s lag between pitch attitude and flight path.
    this.nzF += (s.nz - this.nzF) * Math.min(1, DT / 0.1);
    if (pitchDirect != null) {
      c.elev = clamp(-(3.5 * (pitchDirect - e.theta) - 2.6 * s.w[1]), -1, 1);
    } else if (this.vert === 'PITCH') {
      c.elev = clamp(2.6 * s.w[1], -1, 1);
    } else {
      const gdot = clamp((gCmd - gamma) * (this.vert === 'FLARE' ? this.kFlareGam : this.kGam), -0.05, 0.05);
      const nzCmd = D.cos(gamma) / Math.max(0.5, D.cos(e.phi)) + V * gdot / 9.80665;
      const en = nzCmd - this.nzF;
      const sch = clamp(3600 / Math.max(s.qbar, 800), 0.25, 3); // elevator power grows with dynamic pressure
      this.nzI = clamp(this.nzI + en * this.kNzI * sch * DT, -0.6, 0.6);
      c.elev = clamp(-(this.kNz * sch * en + this.nzI) + this.kQ * Math.sqrt(sch) * s.w[1], -1, 1);
    }
    c.trim = clamp(-c.elev * 6, -1, 1);
    return c;
  }
}

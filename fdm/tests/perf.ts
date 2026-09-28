// Scripted performance flights for gate F2 (and the fitting of the APPROX coefficients): each returns the measured
// value in the units of SPEC-THRESHOLDS.md. ISA sea level, calm, flat paved runway at 0 m unless noted.
import { Sim, neutralControls, flatGround, CALM, type Controls, DT } from '../sim.ts';
import { TestPilot, trimFly } from '../pilot.ts';
import { lerp2 } from '../table.ts';
import { DEG, KT, FT, clamp } from '../math.ts';
import type { AircraftData } from '../aircraft/types.ts';

const peakAlpha = (ac: AircraftData, flap: number) => { let b = -1, ab = 0; for (let a = 0; a <= 30; a += 0.05) { const v = lerp2(ac.aero.CL, a, flap); if (v > b) { b = v; ab = a; } } return ab; };

// 1-g stall: from a level trim at 1.3 VS, idle, hold altitude with pitch; the stall speed is the CAS at which the
// wing reaches the CL peak (the 1-g stall, 14 CFR 25.103 style entry at about 1 kt/s)
export function stallSpeed(ac: AircraftData, flapIdx: number, mass: number, guessKt: number): { kcas: number; decel: number; alphaPk: number; elevAtStall: number } {
  const alt = 1000;
  const { sim } = trimFly(ac, { alt, cas: guessKt * 1.3, flap: flapIdx, gear: 1, mass, seconds: 120 });
  sim.ground = flatGround(-2000);
  const c = neutralControls(ac); c.flap = flapIdx; c.gear = 1;
  const p = new TestPilot(sim);
  const apk = peakAlpha(ac, ac.flaps.detents[flapIdx]);
  let v0 = sim.cas, t0 = sim.t, out = 0, el = 0;
  for (let i = 0; i < 120 * 120; i++) {
    p.fly(c, { alt, thr: 0, hdg: 0 });
    c.trim = 0; // hold the trim (the stall entry is flown on the elevator)
    sim.step(c);
    if (sim.alpha / DEG >= apk) { out = sim.cas; el = c.elev; break; }
  }
  return { kcas: out, decel: (v0 - out) / Math.max(1e-6, sim.t - t0), alphaPk: apk, elevAtStall: el };
}

// best-rate climb: full (C172) / climb thrust (777), speed held on pitch; rate averaged over the window
export function climbRate(ac: AircraftData, o: { cas: number; flapIdx: number; gear: number; mass: number; thr: number; from: number; to: number }): { fpm: number; rpm: number; n1: number } {
  const { sim } = trimFly(ac, { alt: o.from * FT - 200, cas: o.cas, flap: o.flapIdx, gear: o.gear, mass: o.mass, seconds: 90 });
  sim.ground = flatGround(-2000);
  const c = neutralControls(ac); c.flap = o.flapIdx; c.gear = o.gear;
  const p = new TestPilot(sim);
  let tA = -1, hA = 0, rpm = 0, n1 = 0;
  for (let i = 0; i < 120 * 900; i++) {
    p.fly(c, { cas: o.cas, speedOnPitch: true, thr: o.thr, hdg: 0 });
    sim.step(c);
    const ft = sim.altMsl / FT;
    if (tA < 0 && ft >= o.from) { tA = sim.t; hA = sim.altMsl; }
    if (tA >= 0 && ft >= o.to) return { fpm: (sim.altMsl - hA) / FT / ((sim.t - tA) / 60), rpm, n1 };
    rpm = sim.rpm; n1 = sim.n1[0] ?? 0;
    if (sim.crashed) break;
  }
  return { fpm: 0, rpm, n1 };
}

// ground roll and distance to a screen height; rotation at vr (KCAS) to `pitchDeg`
export function takeoff(ac: AircraftData, o: { flapIdx: number; mass: number; vr: number; pitchDeg: number; screenFt: number; rotRate: number; rotGain?: number; groundPitchMax?: number }): { rollFt: number; screenDistFt: number; vlof: number; v35: number; tailstrike: boolean; crashed: string | null } {
  const sim = new Sim(ac, { start: { n: 0, e: 0, hdg: 0, flap: o.flapIdx, mass: o.mass }, ground: flatGround(0), weather: CALM });
  const c = neutralControls(ac); c.flap = o.flapIdx; c.brakeL = c.brakeR = 1;
  c.thr = c.thr.map(() => 1);
  // full power against the brakes until it has spooled (C172: full static RPM; 777: N1 ≥ 95 % of target)
  for (let i = 0; i < 120 * 8; i++) sim.step(c);
  c.brakeL = c.brakeR = 0;
  const n0 = sim.pos[0];
  const p = new TestPilot(sim);
  let roll = 0, vlof = 0, dist = 0, v35 = 0, rotating = false, pitchCmd = sim.euler.theta;
  const gearH = ac.model.gearGround;
  for (let i = 0; i < 120 * 180; i++) {
    const e = sim.euler;
    if (!rotating && sim.cas >= o.vr) rotating = true;
    if (rotating) pitchCmd = Math.min((sim.onGround ? Math.min(o.pitchDeg, o.groundPitchMax ?? 99) : o.pitchDeg) * DEG, pitchCmd + o.rotRate * DEG * DT);
    // on the runway: keep the heading with rudder / nose wheel; hold the nose down before rotation
    if (!rotating) { c.elev = 0; c.trim = 0; c.rud = clamp(-(e.psi) * 6, -1, 1); c.ail = 0; }
    else {
      p.fly(c, { pitch: pitchCmd, thr: 1, bank: 0 }); c.trim = 0;
      // rotation: a firmer pull than the cruise pitch loop (the nose wheel carries part of the weight)
      if (sim.onGround) { c.elev = clamp(-(o.rotGain ?? 6) * (pitchCmd - e.theta) + 1.5 * sim.w[1], -1, 1); c.rud = clamp(-(e.psi) * 6, -1, 1); }
    }
    sim.step(c);
    if (!roll && rotating && !sim.onGround) { roll = sim.pos[0] - n0; vlof = sim.cas; }
    const hgt = sim.altMsl - gearH;
    if (roll && hgt >= o.screenFt * FT) { dist = sim.pos[0] - n0; v35 = sim.cas; break; }
    if (sim.crashed) break;
  }
  return { rollFt: roll / FT, screenDistFt: dist / FT, vlof, v35, tailstrike: sim.tailstrike, crashed: sim.crashed };
}

// landing from a stabilised 3° approach: distance from 50 ft to a stop and the ground roll
export function landing(ac: AircraftData, o: { flapIdx: number; mass: number; vapp: number; flareFt: number; spoilers: boolean; brake: number }): { from50Ft: number; rollFt: number; sinkFpm: number; tdCas: number; crashed: string | null } {
  const gearH = ac.model.gearGround;
  const startH = 500 * FT;
  const { sim } = trimFly(ac, { alt: startH + gearH, cas: o.vapp, gamma: -3, flap: o.flapIdx, gear: 1, mass: o.mass, seconds: 150 });
  // place it on the glidepath toward a threshold at n = 0 (aiming 300 m past it), runway along +n
  const aim = 300, dx = startH / Math.tan(3 * DEG);
  sim.pos = [aim - dx, 0, -(startH + gearH)];
  sim.ground = flatGround(0);
  const c = neutralControls(ac); c.flap = o.flapIdx; c.gear = 1; c.spoiler = o.spoilers ? -1 : 0;
  const p = new TestPilot(sim, ac.id === 'c172' ? 0.35 : 0.5);
  p.thetaCmd = sim.euler.theta;
  let n50 = NaN, nTd = NaN, sink = 0, tdCas = 0, flaring = false, thetaFlare = 0, sink0 = 0;
  for (let i = 0; i < 120 * 400; i++) {
    const h = sim.altMsl - gearH, e = sim.euler;
    if (Number.isNaN(n50) && h <= 50 * FT) n50 = sim.pos[0];
    if (Number.isNaN(nTd)) {
      if (h > o.flareFt * FT) {
        // glidepath: γ toward the aim point
        const dist = aim - sim.pos[0];
        const gpH = dist * Math.tan(3 * DEG);
        p.fly(c, { gamma: -3 * DEG + (h > 100 * FT ? clamp((gpH - h) * 0.01, -0.03, 0.03) : 0), cas: o.vapp, track: { n: 0, e: 0, crs: 0 } });
        thetaFlare = e.theta;
      } else {
        // flare: idle, sink rate proportional to height, pitch up
        // flare: idle, a sink-rate target proportional to height, flown directly on pitch (the flight-path loop is
        // too slow for a few-second manoeuvre)
        if (!flaring) { flaring = true; sink0 = Math.abs(sim.vel[2]); thetaFlare = e.theta; }
        const vsCmd = -Math.max(h / (o.flareFt * FT) * sink0, ac.id === 'c172' ? 0.35 : 0.5);
        const pitch = thetaFlare + clamp((vsCmd + sim.vel[2]) * (ac.id === 'c172' ? 0.05 : 0.06), -0.02, 0.14);
        p.fly(c, { pitch, thr: 0, track: { n: 0, e: 0, crs: 0 } });
      }
    } else {
      // on the ground: idle, derotate, brakes, keep straight
      c.thr = c.thr.map(() => 0);
      c.elev = ac.id === 'c172' ? 0 : 0.3; c.trim = 0; c.ail = 0;
      c.rud = clamp(-e.psi * 6 - sim.pos[1] * 0.02, -1, 1);
      const tAfter = sim.t - (sim.touchdowns[0]?.t ?? sim.t);
      const b = tAfter > (ac.id === 'c172' ? 0.8 : 1.5) ? o.brake : 0;
      c.brakeL = c.brakeR = b;
      if (ac.id === 'c172' && tAfter > 0.5) c.flap = 0; // short-field technique: flaps up for braking
    }
    sim.step(c);
    if ((globalThis as any).__trace) (globalThis as any).__trace(sim, c);
    if (Number.isNaN(nTd) && sim.touchdowns.length) { nTd = sim.touchdowns[0].n; sink = sim.touchdowns[0].sinkFpm; tdCas = sim.touchdowns[0].cas; }
    if (!Number.isNaN(nTd) && sim.gs < 0.3) break;
    if (sim.crashed) break;
  }
  void flaring; void thetaFlare; void KT;
  return { from50Ft: (sim.pos[0] - n50) / FT, rollFt: (sim.pos[0] - nTd) / FT, sinkFpm: sink, tdCas, crashed: sim.crashed };
}

export type { Controls };

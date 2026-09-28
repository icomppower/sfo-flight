// Autopilot flights for gate F4: MCP holds (HDG, ALT, V/S, SPD) and the coupled ILS from 9 NM to 50 ft.
import { neutralControls, flatGround, SURF, type Weather, type Controls } from '../sim.ts';
import { Flight, type World } from '../flight.ts';
import { AP_EVENT } from '../autopilot.ts';
import { ilsDeviation, type IlsDef } from '../ils.ts';
import { DEG, FT, KT, wrap180 } from '../math.ts';
import { B77W } from '../aircraft/b77w.ts';
import * as D from '../dmath.ts';

export const WIND_SET: { name: string; w: Weather }[] = [
  { name: 'calm', w: { wind: { dir: 0, kt: 0, gustKt: 0, turbulence: 0 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 } },
  { name: '280/15G22', w: { wind: { dir: 280, kt: 15, gustKt: 22 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 } },
  { name: '330/18', w: { wind: { dir: 330, kt: 18, gustKt: 18 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 } },
  { name: '240/12G20', w: { wind: { dir: 240, kt: 12, gustKt: 20 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 } },
];

const press = (c: Controls, code: number) => { c.ap = code; };

// holds: engage with a target, settle, then measure the worst error over a window
export function holds(world: World, w: Weather): Record<string, number> {
  const out: Record<string, number> = {};
  const mk = () => new Flight(B77W, { n: 20000, e: 20000, alt: 5000 * FT, hdg: 0, cas: 250, flap: 0, gear: 0, mass: 280000 }, w, 'f4', { ...world, ground: flatGround(0, SURF.WATER) });
  const run = (setup: (c: Controls) => void, seconds: number, measureFrom: number, err: (f: Flight, c: Controls) => number) => {
    const f = mk(); const c: Controls = { ...f.initial, thr: f.initial.thr.slice() };
    c.mcpHdg = 0; c.mcpAlt = 5000; c.mcpVs = 0; c.mcpSpd = 250;
    press(c, AP_EVENT.AP); f.step(c); c.ap = 0;
    press(c, AP_EVENT.AT); f.step(c); c.ap = 0;
    setup(c);
    let worst = 0;
    for (let i = 0; i < seconds * 120; i++) { f.step(c); c.ap = 0; if (i >= measureFrom * 120) worst = Math.max(worst, Math.abs(err(f, c))); }
    return worst;
  };
  out.hdg = run((c) => { c.mcpHdg = 90; press(c, AP_EVENT.HDG); press(c, AP_EVENT.ALT); }, 150, 90, (f) => wrap180(f.sim.euler.psi / DEG - 90));
  out.alt = run((c) => { c.mcpAlt = 7000; c.mcpVs = 1500; press(c, AP_EVENT.VS); }, 240, 150, (f) => (f.sim.altMsl / FT - 7000));
  out.vs = run((c) => { c.mcpVs = -1000; c.mcpAlt = 0; press(c, AP_EVENT.VS); }, 90, 45, (f) => f.sim.vsFpm + 1000);
  out.spd = run((c) => { c.mcpSpd = 220; press(c, AP_EVENT.ALT); }, 180, 110, (f) => f.sim.cas - 220);
  return out;
}

// coupled ILS: start 9 NM out, established, 170 kt flaps 20, gear down; flaps 30 and Vref+5 at 6 NM; APP armed.
export function coupledIls(world: World, I: IlsDef, w: Weather, groundH: number): { maxLoc: number; maxGs: number; worstAt: number; landed: boolean; flight: Flight } {
  const d0 = 9 * 1852;
  const cn = D.cos(I.crs * DEG), ce = D.sin(I.crs * DEG);
  const n = I.thrN - cn * d0, e = I.thrE - ce * d0;
  const gsD = d0 + D.hypot(I.gsN - I.thrN, I.gsE - I.thrE);
  const alt = I.gsH + gsD * D.tan(I.gsDeg * DEG);
  const f = new Flight(B77W, { n, e, alt, hdg: I.crs, cas: 170, gamma: -I.gsDeg, flap: 4, gear: 1, mass: 230000 }, w, process.env.SEED || 'f4-ils', { ...world, ground: flatGround(groundH, SURF.PAVED) });
  const c: Controls = { ...f.initial, thr: f.initial.thr.slice() };
  c.mcpHdg = I.crs; c.mcpAlt = 3000; c.mcpSpd = 170; c.spoiler = -1; c.autobrake = 3;
  press(c, AP_EVENT.AP); f.step(c); c.ap = 0;
  press(c, AP_EVENT.AT); f.step(c); c.ap = 0;
  press(c, AP_EVENT.APP); f.step(c); c.ap = 0;
  let maxLoc = 0, maxGs = 0, worstAt = 0, done = false;
  for (let i = 0; i < 120 * 400 && !f.sim.crashed; i++) {
    const dv = ilsDeviation(I, f.sim.pos[0], f.sim.pos[1], f.sim.altMsl);
    if (dv.distNm < 6 && c.flap < 6) { c.flap = 6; c.mcpSpd = 154; }
    f.step(c);
    const ra = f.sim.altMsl - groundH - B77W.model.gearGround;
    if (!done) {
      if (ra <= 50 * FT) done = true;
      else { if (Math.abs(dv.locDots) > maxLoc) { maxLoc = Math.abs(dv.locDots); } if (Math.abs(dv.gsDots) > maxGs) { maxGs = Math.abs(dv.gsDots); worstAt = dv.distNm; } }
    }
    if (f.scorer.landing?.complete) break;
  }
  void KT; void neutralControls;
  return { maxLoc, maxGs, worstAt, landed: !!f.scorer.landing?.complete, flight: f };
}

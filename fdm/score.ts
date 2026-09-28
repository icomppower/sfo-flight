// Landing score (SPEC §4: touchdown rate, centreline, touchdown zone) against the runway end the aircraft landed
// on, and the flight's outcome. Runways from sfo-airport/1 (title frame x east, z south) → NED.
import type { Sim, TouchdownEvent } from './sim.ts';
import { DEG, FT, wrap180 } from './math.ts';

export interface RunwayEnd { id: string; thrN: number; thrE: number; crs: number; widthM: number; lengthM: number }
export function runwaysFromAirport(ap: { runways: { id: string; widthM: number; ends: { id: string; hdg: number; thr: number[]; end: number[] }[] }[] }): RunwayEnd[] {
  const out: RunwayEnd[] = [];
  for (const r of ap.runways) for (const [i, E] of r.ends.entries()) {
    const F = r.ends[1 - i];
    const L = Math.hypot(F.end[0] - E.thr[0], F.end[1] - E.thr[1]);
    const crs = ((Math.atan2(F.end[0] - E.thr[0], -(F.end[1] - E.thr[1])) * 180 / Math.PI) + 360) % 360; // surveyed, not the rounded heading
    out.push({ id: E.id, thrN: -E.thr[1], thrE: E.thr[0], crs, widthM: r.widthM, lengthM: L });
  }
  return out;
}

export interface Landing {
  runway: string | null; sinkFpm: number; xteM: number; alongM: number; inTdz: boolean; bounces: number;
  sinkScore: number; clScore: number; tdzScore: number; score: number; grade: string; t: number; cas: number;
  stoppedM?: number; complete: boolean;
}

const lin = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + (y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));

export function scoreTouchdown(td: TouchdownEvent, rw: RunwayEnd[]): Landing {
  let best: RunwayEnd | null = null, bx = 0, ba = 0;
  for (const R of rw) {
    if (Math.abs(wrap180(td.hdg - R.crs)) > 30) continue;
    const cn = Math.cos(R.crs * DEG), ce = Math.sin(R.crs * DEG), dn = td.n - R.thrN, de = td.e - R.thrE;
    const along = dn * cn + de * ce, xte = -dn * ce + de * cn;
    if (along < -600 || along > R.lengthM + 100 || Math.abs(xte) > R.widthM * 2) continue;
    if (!best || Math.abs(xte) < Math.abs(bx)) { best = R; bx = xte; ba = along; }
  }
  const sink = td.sinkFpm;
  const sinkScore = sink <= 240 ? 100 : lin(sink, 240, 720, 100, 0);
  const clScore = best ? lin(Math.abs(bx), 0, best.widthM / 2, 100, 0) : 0;
  const tdzScore = !best ? 0 : ba < 0 ? 0 : ba < 150 ? lin(ba, 0, 150, 60, 100) : ba <= 610 ? 100 : ba <= 914 ? lin(ba, 610, 914, 100, 50) : lin(ba, 914, 1500, 50, 0);
  const score = Math.round(0.4 * sinkScore + 0.3 * clScore + 0.3 * tdzScore);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { runway: best ? best.id : null, sinkFpm: sink, xteM: bx, alongM: ba, inTdz: !!best && ba >= 0 && ba <= 914, bounces: 0, sinkScore, clScore, tdzScore, score, grade, t: td.t, cas: td.cas, complete: false };
}

export class Scorer {
  rw: RunwayEnd[]; landing: Landing | null = null; seen = 0;
  constructor(rw: RunwayEnd[]) { this.rw = rw; }
  update(s: Sim): void {
    if (s.touchdowns.length > this.seen) {
      if (!this.landing) this.landing = scoreTouchdown(s.touchdowns[0], this.rw);
      else this.landing.bounces = s.touchdowns.length - 1;
      this.seen = s.touchdowns.length;
    }
    if (this.landing && !this.landing.complete && s.onGround && s.gs < 1) {
      this.landing.complete = true;
      const R = this.rw.find((r) => r.id === this.landing!.runway);
      if (R) { const cn = Math.cos(R.crs * DEG), ce = Math.sin(R.crs * DEG); this.landing.stoppedM = (s.pos[0] - R.thrN) * cn + (s.pos[1] - R.thrE) * ce; }
    }
    void FT;
  }
  reset(): void { this.landing = null; this.seen = 0; }
}

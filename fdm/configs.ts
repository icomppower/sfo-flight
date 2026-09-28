// M1.1 TAKEOFF CONFIG / LANDING CONFIG: what each button sets, per aircraft. Configuration only — never a flight
// control input. Trim settings are the stabilizer / tab position trimFly (fdm/pilot.ts) finds for the condition named
// in each row, in calm air; F9 re-runs trimFly and checks these numbers (decision D19).
import { type AircraftData } from './aircraft/types.ts';

export interface TakeoffCfg { park: 0; flap: number; trim: number; mixture?: 1; spoiler?: 0; autobrake?: number; mcpAlt?: number; atArm?: boolean; spdIsV2?: boolean }
export interface LandingCfg { flap: number; trim?: number; gear?: 1; spoiler?: -1; autobrake?: number; bugKt?: number; vrefAdd?: number; ilsNm: number; ilsDeg: number }

// 777: trim for V2 + 10 (178 KIAS), flaps 15, gear down, γ +5° at these masses (kg → trim)
export const B77W_TO_TRIM: [number, number][] = [[220000, 0.0066], [260000, -0.0023], [300000, -0.0106], [351533, -0.0207]];
export const RTO = 6;

export const CONFIGS = {
  c172: {
    // POH normal takeoff: flaps 0–10°; 10° chosen. Trim: 70 KIAS, flaps 10°, full power, γ +4°.
    takeoff: { park: 0, flap: 1, trim: 0.0205, mixture: 1 } as TakeoffCfg,
    // POH normal landing: flaps 30°, 60–70 KIAS → bug 65. Trim: 65 KIAS, flaps 30°, γ −3°.
    landing: { flap: 3, trim: 0.0065, bugKt: 65, ilsNm: 0, ilsDeg: 0 } as LandingCfg,
  },
  b77w: {
    // ACAP 777-300ER takeoff flaps 5 / 15 / 20: 15 (the runway start's setting, F2's field length). Autobrake RTO,
    // spoilers disarmed, MCP SPD = V2, HDG = runway heading, ALT 3,000, A/T armed (TO/GA engages it).
    takeoff: { park: 0, flap: 3, trim: NaN, spoiler: 0, autobrake: RTO, mcpAlt: 3000, atArm: true, spdIsV2: true } as TakeoffCfg,
    // flaps 30, gear down, spoilers armed, autobrake 3, SPD = Vref30 + 5 for the mass; within 12 NM of an SFO ILS
    // and 45° of its course it also arms LOC + APP.
    landing: { flap: 6, gear: 1, spoiler: -1, autobrake: 3, vrefAdd: 5, ilsNm: 12, ilsDeg: 45 } as LandingCfg,
  },
};

export function takeoffTrim(ac: AircraftData, mass: number): number {
  if (ac.id !== 'b77w') return CONFIGS.c172.takeoff.trim;
  const T = B77W_TO_TRIM;
  if (mass <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (mass <= T[i][0]) { const [m0, t0] = T[i - 1], [m1, t1] = T[i]; return t0 + (t1 - t0) * (mass - m0) / (m1 - m0); }
  return T[T.length - 1][1];
}
// Vref30 scales with √mass (constant CL at 1.23 VSR); 149 kt at MLW 251,290 kg (ACAP, fdm/aircraft/b77w.ts)
export function vref(ac: AircraftData, mass: number): number {
  if (ac.id !== 'b77w') return ac.vspeeds.vapp;
  return ac.vspeeds.vref30 * Math.sqrt(mass / ac.mass.mlw.v);
}

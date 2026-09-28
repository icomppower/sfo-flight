// International Standard Atmosphere (ICAO Doc 7488 / US Standard Atmosphere 1976, troposphere), with a
// temperature offset and sea-level pressure (QNH) from the weather. Airspeeds: CAS from impact pressure
// (isentropic, subsonic), EAS, Mach.
import { FT } from './math.ts';

export const RHO0 = 1.225, P0 = 101325, T0 = 288.15, A0 = 340.294, LAPSE = 0.0065, R = 287.05287, GAMMA = 1.4;

export interface Air { rho: number; p: number; T: number; a: number; sigma: number }

export function atmosphere(hM: number, dT = 0, qnhPa = P0): Air {
  const h = Math.min(Math.max(hM, -500), 11000);
  const Tstd = T0 - LAPSE * h;
  const p = qnhPa * Math.pow(Tstd / T0, 5.25588);
  const T = Tstd + dT;
  const rho = p / (R * T);
  return { rho, p, T, a: Math.sqrt(GAMMA * R * T), sigma: rho / RHO0 };
}

// calibrated airspeed from true airspeed (subsonic isentropic)
export function casFromTas(tas: number, air: Air): number {
  const M = tas / air.a;
  const qc = air.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
export function tasFromCas(cas: number, air: Air): number {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / A0) ** 2, 3.5) - 1);
  const M = Math.sqrt(5 * (Math.pow(qc / air.p + 1, 2 / 7) - 1));
  return M * air.a;
}
// pressure altitude (ft) for an altimeter set to qnh (what the altimeter shows)
export function indicatedAltFt(hM: number, dT = 0, qnhPa = P0, setPa = P0): number {
  const p = atmosphere(hM, dT, qnhPa).p;
  return (T0 / LAPSE) * (1 - Math.pow(p / setPa, 1 / 5.25588)) / FT;
}

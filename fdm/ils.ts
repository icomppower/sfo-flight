// ILS receiver: localizer and glide-path deviation (DDM and dots) from the geometry of one runway end, per ICAO
// Annex 10 Vol I §3.1: localizer 0.155 DDM at ±105 m at the threshold (course-sector half angle from the antenna
// distance), glide path 0.0875 DDM at 0.12 θ from the path. Display: 2 dots full scale (LOC 1 dot = 0.0775 DDM,
// G/S 1 dot = 0.0875 DDM). The localizer antenna stands 300 m past the far end; the glide-path origin where the path
// crosses the threshold at the published TCH.
import { DEG, FT } from './math.ts';

export interface IlsDef {
  id: string; // runway end, e.g. "28R"
  thrN: number; thrE: number; thrH: number; // threshold (m, NED from the title origin; MSL height of the TDZ)
  crs: number; // runway true course (deg)
  gsDeg: number; tchFt: number;
  locN: number; locE: number; // localizer antenna
  gsN: number; gsE: number; gsH: number; // glide-path origin (on the centreline, TCH / tan θ past the threshold)
}
export interface IlsDev { loc: number; gs: number; locDots: number; gsDots: number; xte: number; along: number; distNm: number; gsErrM: number; valid: boolean }

// from a sfo-airport/1 runway end (title frame x east, z south) and the opposite end
export function ilsFromAirport(end: { id: string; hdg: number; thr: number[]; tdzeM: number; gsDeg: number | null; tchFt: number | null }, far: { end: number[] }): IlsDef {
  // true course from the surveyed ends (NASR's heading is rounded to 1°: 0.5° is 150 m at 9 NM)
  const gx = far.end[0] - end.thr[0], gz = far.end[1] - end.thr[1];
  const crs = ((Math.atan2(gx, -gz) / DEG) + 360) % 360;
  const ux = Math.sin(crs * DEG), uz = -Math.cos(crs * DEG); // title frame, x east z south
  const loc = [far.end[0] + ux * 300, far.end[1] + uz * 300];
  const gs = end.gsDeg ?? 3, tch = end.tchFt ?? 50;
  const d = tch * FT / Math.tan(gs * DEG);
  return { id: end.id, thrN: -end.thr[1], thrE: end.thr[0], thrH: end.tdzeM, crs, gsDeg: gs, tchFt: tch, locN: -loc[1], locE: loc[0], gsN: -(end.thr[1] + uz * d), gsE: end.thr[0] + ux * d, gsH: end.tdzeM };
}

export function ilsDeviation(I: IlsDef, n: number, e: number, h: number, out?: IlsDev): IlsDev {
  const o = out || ({} as IlsDev);
  const cn = Math.cos(I.crs * DEG), ce = Math.sin(I.crs * DEG);
  // along-course distance past the threshold (negative on final) and cross-track (+ right of the centreline)
  const dn = n - I.thrN, de = e - I.thrE;
  o.along = dn * cn + de * ce;
  o.xte = -dn * ce + de * cn;
  // localizer angle, seen from the antenna, relative to the back course
  const ln = n - I.locN, le = e - I.locE;
  const aAlong = -(ln * cn + le * ce), aX = -ln * ce + le * cn;
  const ang = Math.atan2(aX, aAlong);
  const dLoc = Math.hypot(I.thrN - I.locN, I.thrE - I.locE);
  const half = Math.atan2(105, dLoc);
  o.loc = 0.155 * ang / half;
  o.locDots = o.loc / 0.0775;
  // glide path: elevation angle from the path origin
  const gn = n - I.gsN, ge = e - I.gsE;
  const hd = Math.max(1, -(gn * cn + ge * ce));
  const elev = Math.atan2(h - I.gsH, Math.hypot(hd, 0));
  o.gs = 0.0875 * (elev - I.gsDeg * DEG) / (0.12 * I.gsDeg * DEG);
  o.gsDots = o.gs / 0.0875;
  o.gsErrM = (h - I.gsH) - hd * Math.tan(I.gsDeg * DEG);
  o.distNm = -o.along / 1852;
  o.valid = aAlong > 0 && Math.abs(ang) < 35 * DEG && -o.along > -500;
  return o;
}

// Start positions → the flight model's Start (NED: n = −z, e = x; headings on the UTM grid).
const FT = 0.3048, NM = 1852, D = Math.PI / 180;
export const STARTS = ['ramp', 'rampCold', 'runway', 'final9', 'final3', 'ggb'];
export const RUNWAYS = ['28R', '28L', '1R', '1L', '10L', '10R', '19L', '19R'];
// configuration per aircraft and start: speed KCAS, flap detent index, gear, mass kg, flight-path angle
const CFG = {
  c172: { final9: { cas: 90, flap: 0, gamma: -3 }, final3: { cas: 70, flap: 2, gamma: -3 }, ggb: { cas: 100, flap: 0, gamma: 0, altFt: 1500 }, mass: 1080 },
  b77w: { final9: { cas: 170, flap: 4, gamma: -3 }, final3: { cas: 154, flap: 6, gamma: -3 }, ggb: { cas: 250, flap: 0, gamma: 0, altFt: 3000 }, mass: 250000, takeoffMass: 300000 },
};
export function makeStart(kind, acId, rwyId, W) {
  const { airport, ils } = W, g = airport.trueNorthGridDeg, C = CFG[acId];
  const end = airport.runways.flatMap((r) => r.ends.map((e, i) => ({ e, far: r.ends[1 - i], r }))).find((x) => x.e.id === rwyId) || airport.runways[0].ends[0];
  const crsOf = (e, far) => ((Math.atan2(far.end[0] - e.thr[0], -(far.end[1] - e.thr[1])) / D) + 360) % 360;
  if (kind === 'ramp' || kind === 'rampCold') {
    const p = airport.places.ramp;
    return { n: -p.z, e: p.x, hdg: p.hdgTrue + g, mass: acId === 'b77w' ? C.takeoffMass : C.mass, flap: 0, engineOn: kind !== 'rampCold', park: true };
  }
  if (kind === 'runway') {
    const crs = crsOf(end.e, end.far), s = 60; // just past the runway end (the displaced threshold area is usable for takeoff)
    const x = end.e.end[0] + Math.sin(crs * D) * s, z = end.e.end[1] - Math.cos(crs * D) * s;
    return { n: -z, e: x, hdg: crs, mass: acId === 'b77w' ? C.takeoffMass : C.mass, flap: acId === 'b77w' ? 3 : 1 };
  }
  if (kind === 'final9' || kind === 'final3') {
    const I = ils.find((i) => i.id === rwyId) || ils.find((i) => i.id === '28R');
    const d = (kind === 'final9' ? 9 : 3) * NM, cn = Math.cos(I.crs * D), ce = Math.sin(I.crs * D);
    const gsD = d + Math.hypot(I.gsN - I.thrN, I.gsE - I.thrE);
    const cfg = C[kind];
    return { n: I.thrN - cn * d, e: I.thrE - ce * d, alt: I.gsH + gsD * Math.tan(I.gsDeg * D), hdg: I.crs, cas: cfg.cas, gamma: cfg.gamma, flap: cfg.flap, gear: 1, mass: C.mass };
  }
  // over the Golden Gate
  const p = airport.places.goldenGate, cfg = C.ggb;
  return { n: -p.z, e: p.x, alt: cfg.altFt * FT, hdg: p.hdgTrue + g, cas: cfg.cas, gamma: 0, flap: cfg.flap, gear: acId === 'b77w' ? 0 : 1, mass: C.mass };
}

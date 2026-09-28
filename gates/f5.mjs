// F5 World:
//  - every ground start (the ramp, eight runway ends; both aircraft) settles with its model origin (the main-gear
//    ground point) within F5.surfaceM of the surface the page draws there (engine terrain, + the runway overlay);
//  - the NASR runways line up with the terrain (flattened onto the published end elevations) and with the NAIP
//    imagery: the across-runway luminance profile of the 2 m image is symmetric about the NASR centreline within
//    F5.thresholdM;
//  - collisions: flights into San Bruno Mountain (terrain), the tallest structure (building), the bay (water) and a
//    hillside in the low-detail ring (terrain) end in those crashes.
// --negative: the flight model rolling on bare terrain under the runway overlay, runways shifted 60 m, the roof grid
// emptied and the water flag lost must each fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { readTiff } from 'harbor-engine/tools/geo/tiff.mjs';
import { loadWorld, decodeSquare } from './lib/world.mjs';
import { WorldGround, RUNWAY_LIFT } from '../fdm/world.ts';
import { Flight } from '../fdm/flight.ts';
import { CALM } from '../fdm/sim.ts';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';
import { makeStart, RUNWAYS } from '../src/game/starts.js';

const T = readThresholds(), AC = { c172: C172, b77w: B77W }, oE = 558000, oN = 4163000;
const naip = readTiff(readFileSync(join(root, 'data/raw/naip-airport.tif')));
const sq = decodeSquare();
// the drawn surface, computed independently of fdm/world.ts: the engine's bilinear heightAt + the runway overlay
function drawn(x, z, airport) {
  const { res, size, heights } = sq, texel = size / res, fx = (x + size / 2) / texel - 0.5, fz = (z + size / 2) / texel - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * res + i;
  let h = (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - tz) + (heights[k + res] * (1 - tx) + heights[k + res + 1] * tx) * tz;
  for (const r of airport.runways) { const [a, b] = r.ends, dx = b.end[0] - a.end[0], dz = b.end[1] - a.end[1], L2 = dx * dx + dz * dz, t = ((x - a.end[0]) * dx + (z - a.end[1]) * dz) / L2; if (t >= 0 && t <= 1 && Math.hypot(a.end[0] + dx * t - x, a.end[1] + dz * t - z) <= r.widthM / 2) { h += RUNWAY_LIFT; break; } }
  return h;
}
function settle(W, acId, kind, rwy) {
  const f = new Flight(AC[acId], makeStart(kind, acId, rwy, W), CALM, 'f5', { ground: W.ground, ils: W.ils, runways: W.runways });
  const c = { ...f.initial, thr: f.initial.thr.slice() }; c.brakeL = c.brakeR = 1;
  for (let i = 0; i < 120 * 4; i++) f.step(c);
  const o = f.sim.renderOrigin();
  return { x: o[1], z: -o[0], y: -o[2], crashed: f.sim.crashed, wheels: f.sim.wow.filter(Boolean).length, n: f.sim.wow.length };
}
function alignment(airport, shift = 0) {
  const [, , , e0, n0] = naip.tags[33922], cell = naip.tags[33550][0];
  const px = (x, z) => { const i = Math.floor((x + oE - e0) / cell), j = Math.floor((n0 - (oN - z)) / cell); if (i < 0 || j < 0 || i >= naip.width || j >= naip.height) return null; const k = j * naip.width + i; return (naip.bands[0][k] + naip.bands[1][k] + naip.bands[2][k]) / 3; };
  return airport.runways.map((r) => {
    const [a, b] = r.ends, L = Math.hypot(b.end[0] - a.end[0], b.end[1] - a.end[1]), u = [(b.end[0] - a.end[0]) / L, (b.end[1] - a.end[1]) / L], rt = [-u[1], u[0]];
    const p = new Map();
    for (let w = -160; w <= 160; w += 2) { let s = 0, n = 0; for (let st = 200; st < L - 200; st += 7) { const v = px(a.end[0] + u[0] * st + rt[0] * (w + shift), a.end[1] + u[1] * st + rt[1] * (w + shift)); if (v != null) { s += v; n++; } } p.set(w, s / n); }
    let best = 0, bs = Infinity;
    for (let c = -80; c <= 80; c += 2) { let d = 0; for (let k = 2; k <= 60; k += 2) d += Math.abs(p.get(c + k) - p.get(c - k)); if (d < bs) { bs = d; best = c; } }
    return { id: r.id, axis: best };
  });
}
// a C172 flying hands-off (trimmed) from `from` toward `to` at altitude alt (m) or on a descent
function collide(W, from, to, alt, gamma = 0) {
  const hdg = (Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180 / Math.PI + 360) % 360;
  const f = new Flight(C172, { n: -from[1], e: from[0], alt, hdg, cas: 100, gamma, flap: 0, gear: 1 }, CALM, 'f5-col', { ground: W.ground, ils: W.ils, runways: W.runways });
  const c = { ...f.initial, thr: f.initial.thr.slice() };
  for (let i = 0; i < 120 * 180 && !f.sim.crashed; i++) f.step(c);
  return f.sim.crashed;
}

function check({ world = loadWorld(), shift = 0 } = {}) {
  const W = world, fail = [], req = (ok, m) => { if (!ok) fail.push(m); };
  // ---- starts on the surface
  let worst = 0;
  for (const acId of ['c172', 'b77w']) for (const [kind, rwys] of [['ramp', ['28R']], ['runway', RUNWAYS]]) for (const rwy of rwys) {
    const s = settle(W, acId, kind, rwy), d = s.y - drawn(s.x, s.z, W.airport);
    worst = Math.max(worst, Math.abs(d));
    req(!s.crashed && s.wheels === s.n, `${acId} ${kind} ${rwy}: crashed ${s.crashed}, ${s.wheels}/${s.n} wheels on the ground`);
    req(Math.abs(d) <= T['F5.surfaceM'], `${acId} ${kind} ${rwy}: model origin ${d.toFixed(3)} m from the drawn surface (≤ ${T['F5.surfaceM']})`);
  }
  console.log(`starts: worst model-origin offset ${worst.toFixed(3)} m over 18 ground starts`);
  // ---- runways vs terrain and imagery
  const air = shift ? JSON.parse(JSON.stringify(W.airport)) : W.airport;
  if (shift) for (const r of air.runways) { const [a, b] = r.ends, L = Math.hypot(b.end[0] - a.end[0], b.end[1] - a.end[1]), rt = [-(b.end[1] - a.end[1]) / L, (b.end[0] - a.end[0]) / L]; for (const e of r.ends) { e.end = [e.end[0] + rt[0] * shift, e.end[1] + rt[1] * shift]; } }
  for (const r of air.runways) for (const e of r.ends) {
    const h = W.ground.heightXZ(e.end[0], e.end[1]) - RUNWAY_LIFT;
    req(Math.abs(h - e.elevM) <= T['F5.surfaceM'], `runway end ${e.id}: terrain ${h.toFixed(2)} m vs NASR ${e.elevM.toFixed(2)} m`);
  }
  const al = alignment(air);
  console.log(`imagery: NAIP symmetry axis vs NASR centreline ${al.map((a) => `${a.id} ${a.axis} m`).join(', ')}`);
  for (const a of al) req(Math.abs(a.axis) <= T['F5.thresholdM'], `runway ${a.id}: the NAIP runway is ${a.axis} m off the NASR centreline (≤ ${T['F5.thresholdM']})`);
  // ---- collisions
  let peak = [0, 0], ph = -1e9; // highest terrain in the square's west half (San Bruno Mountain)
  for (let x = -11500; x < -2000; x += 60) for (let z = -11500; z < -3000; z += 60) { const h = W.ground.heightXZ(x, z); if (h > ph) { ph = h; peak = [x, z]; } }
  const cTerrain = collide(W, [peak[0] + 2500, peak[1] + 1500], peak, ph - 40);
  // the structure standing tallest above its own ground (the SFO tower, 67 m); fly into it at 60 % of its height
  let above = -1e9, rp = [-3618.6, -378.2], top = 67; const R = W.arrays.roofs;
  if (R && R.data.some((v) => v)) for (let j = 0; j < R.res; j++) for (let i = 0; i < R.res; i++) { const v = R.data[j * R.res + i]; if (!v) continue; const x = R.originX + (i + 0.5) * R.cell, z = R.originZ + (j + 0.5) * R.cell, a = v / 10 - 50 - W.ground.heightXZ(x, z); if (a > above) { above = a; rp = [x, z]; top = v / 10 - 50; } }
  const gnd = W.ground.heightXZ(rp[0], rp[1]), tall = top - gnd;
  const cBuilding = collide(W, [rp[0] + 1200, rp[1] + 300], rp, gnd + tall * 0.6);
  const cWater = collide(W, [6000, 3000], [9000, 5000], 120, -8);
  let rpk = null, rh = -1e9; // the highest point of the 30 m band outside the square (e.g. Twin Peaks, Mount Sutro)
  if (W.ring) for (let x = -23500; x < 23500; x += 90) for (let z = -23500; z < 23500; z += 90) { if (Math.abs(x) < 12500 && Math.abs(z) < 12500) continue; const h = W.ground.heightXZ(x, z); if (h > rh) { rh = h; rpk = [x, z]; } }
  const away = rpk ? [rpk[0] + Math.sign(rpk[0] || 1) * 1800, rpk[1] + Math.sign(rpk[1] || 1) * 1800] : null;
  const cRing = rpk ? collide(W, away, rpk, rh - 30) : 'no ring';
  console.log(`collisions: San Bruno Mountain ${ph.toFixed(0)} m → ${cTerrain}; tallest structure ${tall.toFixed(0)} m above its ground → ${cBuilding}; bay → ${cWater}; ring hillside ${rh.toFixed(0)} m → ${cRing}`);
  req(cTerrain === 'terrain', `flight into San Bruno Mountain ended ${cTerrain}`);
  req(cBuilding === 'building', `flight into the ${tall.toFixed(0)} m structure ended ${cBuilding}`);
  req(cWater === 'water', `descent into the bay ended ${cWater}`);
  req(cRing === 'terrain', `flight into a ring hillside ended ${cRing}`);
  return fail;
}

const variant = (patch) => { const W = loadWorld(); const arrays = { ...W.arrays, ...patch }; return { ...W, arrays, ground: new WorldGround(arrays) }; };
if (process.argv[1]?.endsWith('f5.mjs')) await gate('F5', () => check(), [
  ['rolling on bare terrain under the runway overlay', () => check({ world: variant({ lift: 0 }) })],
  ['runways shifted 60 m', () => check({ shift: 60 })],
  ['roof grid emptied', () => { const W = loadWorld(); return check({ world: variant({ roofs: { ...W.arrays.roofs, data: new Uint16Array(W.arrays.roofs.data.length) } }) }); }],
  ['water flag lost', () => { const W = loadWorld(); const h = Float32Array.from(W.arrays.square.heights, (v) => Math.max(v, 0.05)); return check({ world: variant({ square: { ...W.arrays.square, heights: h } }) }); }],
]);

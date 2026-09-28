// The flight model's world in Node, from the same baked files the page loads (src/game/worlddata.js): the engine's
// terrain tiles decoded exactly as the engine does, the ring grids, the paved mask, the roof grid, the ILS and runways.
import { inflateSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './common.mjs';
import { WorldGround } from '../../fdm/world.ts';
import { ilsFromAirport } from '../../fdm/ils.ts';
import { runwaysFromAirport } from '../../fdm/score.ts';

const pub = join(root, 'public');
const J = (f) => JSON.parse(readFileSync(join(pub, f), 'utf8'));
const inf = (f) => { const b = inflateSync(readFileSync(join(pub, f))); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };

export function decodeSquare() {
  const index = J('terrain/index.json'), { res, tile, size } = index, h = new Float32Array(res * res);
  for (const f of index.files) { const b = inflateSync(readFileSync(join(pub, 'terrain', f.name))); for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) h[(f.j * tile + y) * res + f.i * tile + x] = b.readInt16LE((y * tile + x) * 2) / 100; }
  return { heights: h, res, size };
}
let cache = null;
export function loadWorld({ ring = true } = {}) {
  if (cache && ring) return cache;
  const airport = J('flight/airport.json'), col = J('flight/collision.json');
  const paved = inf('flight/' + col.paved.file), roofs = inf('flight/' + col.roofs.file);
  const arrays = {
    square: decodeSquare(),
    paved: { data: paved, res: col.paved.res, cell: col.paved.cell, originX: col.paved.originX, originZ: col.paved.originZ },
    roofs: { data: new Uint16Array(roofs.buffer.slice(roofs.byteOffset, roofs.byteOffset + roofs.byteLength)), res: col.roofs.res, cell: col.roofs.cell, originX: col.roofs.origin, originZ: col.roofs.origin },
  };
  let ringIdx = null;
  if (ring && existsSync(join(pub, 'ring/index.json'))) {
    ringIdx = J('ring/index.json');
    for (const k of ['band', 'outer']) { const R = ringIdx[k], b = inf('ring/' + R.file); arrays[k] = { data: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), res: R.res, cell: R.cell, originX: R.originX, originZ: R.originZ }; }
  }
  const ils = [];
  for (const r of airport.runways) for (const [i, E] of r.ends.entries()) if (E.ils || E.gsDeg) ils.push(ilsFromAirport(E, r.ends[1 - i]));
  arrays.runways = airport.runways.map((r) => ({ ax: r.ends[0].end[0], az: r.ends[0].end[1], bx: r.ends[1].end[0], bz: r.ends[1].end[1], halfW: r.widthM / 2 }));
  const w = { airport, ring: ringIdx, arrays, ground: new WorldGround(arrays), ils, runways: runwaysFromAirport(airport) };
  if (ring) cache = w;
  return w;
}

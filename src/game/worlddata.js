// Loads what the flight model needs from public/: the terrain square (the engine's own heights, already in memory),
// the ring grids, the paved mask and the roof grid → a WorldGround (fdm/world.ts); the ILS and runways from
// airport.json. The same files feed the gates (gates/lib/world.mjs).
import { WorldGround } from '../../fdm/world.ts';
import { ilsFromAirport } from '../../fdm/ils.ts';
import { runwaysFromAirport } from '../../fdm/score.ts';

const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';
async function json(f) { const r = await fetch(base() + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); }
async function inflate(f) {
  const r = await fetch(base() + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(r.body.pipeThrough(ds)).arrayBuffer());
}
export async function loadWorld(app) {
  const [airport, collision, ring, metars] = await Promise.all([json('flight/airport.json'), json('flight/collision.json'), json('ring/index.json').catch(() => null), json('flight/metars.json')]);
  const [paved, roofs] = await Promise.all([inflate('flight/' + collision.paved.file), inflate('flight/' + collision.roofs.file)]);
  const td = app.terrainData;
  const arrays = {
    square: { heights: td.heights, res: td.res, size: td.size },
    paved: { data: paved, res: collision.paved.res, cell: collision.paved.cell, originX: collision.paved.originX, originZ: collision.paved.originZ },
    roofs: { data: new Uint16Array(roofs.buffer, roofs.byteOffset, roofs.byteLength / 2), res: collision.roofs.res, cell: collision.roofs.cell, originX: collision.roofs.origin, originZ: collision.roofs.origin },
  };
  if (ring) {
    const [b, o] = await Promise.all([inflate('ring/' + ring.band.file), inflate('ring/' + ring.outer.file)]);
    arrays.band = { data: new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2), res: ring.band.res, cell: ring.band.cell, originX: ring.band.originX, originZ: ring.band.originZ };
    arrays.outer = { data: new Int16Array(o.buffer, o.byteOffset, o.byteLength / 2), res: ring.outer.res, cell: ring.outer.cell, originX: ring.outer.originX, originZ: ring.outer.originZ };
  }
  const ground = new WorldGround(arrays);
  const ils = [];
  for (const r of airport.runways) for (const [i, E] of r.ends.entries()) if (E.ils || E.gsDeg) ils.push(ilsFromAirport(E, r.ends[1 - i]));
  return { airport, ring, metars: metars.picks, arrays, ground, ils, runways: runwaysFromAirport(airport) };
}

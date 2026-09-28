// The low-detail ring (SPEC §4 M1): terrain beyond the 24 km square out to 60 km, from the cached 30 m USGS 3DEP and
// NOAA NCEI rasters and the 60 m NAIP image (pipelines/data/sources.mjs RING). Two height grids (Int16 decimetres
// above local MSL, −32768 = water drawn flat at 0 m; vertex-centred): a 30 m band over the 48 km square around the
// title (the Golden Gate, the city, San Bruno Mountain, the East Bay shore) and a 120 m grid over the full 120 km
// square. The image is colour-matched to the engine's own aerial map where they overlap (per-channel linear fit over
// land) and written as JPEG (macOS sips). Deterministic for a given cache and OS.
//   node pipelines/ring/build.mjs → public/ring/{band.bin, outer.bin, imagery.jpg, index.json}
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTiff } from 'harbor-engine/tools/geo/tiff.mjs';
import { RING, writeRgbTiff } from '../data/sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const raw = join(root, 'data/raw'), out = join(root, 'public/ring');
const map = JSON.parse(readFileSync(join(root, 'map.json'), 'utf8'));
const { originE, originN } = map.frame;
const WATER = -32768;

export function mslOffset() {
  const d = JSON.parse(readFileSync(join(raw, 'noaa-datums-9414523.json'), 'utf8')), v = (n) => d.datums.find((x) => x.name === n).value;
  return v('MSL') - v('NAVD88');
}

// bilinear sample of a pixel-centred raster at UTM (E, N)
function sampler(t) {
  const [, , , e0, n0] = t.tags[33922], cell = t.tags[33550][0], W = t.width, H = t.height, D = t.data;
  return (E, N) => {
    const fx = (E - e0) / cell - 0.5, fy = (n0 - N) / cell - 0.5;
    const i = Math.max(0, Math.min(W - 2, Math.floor(fx))), j = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - i)), ty = Math.max(0, Math.min(1, fy - j)), k = j * W + i;
    const a = D[k], b = D[k + 1], c = D[k + W], d = D[k + W + 1];
    const bad = (v) => !Number.isFinite(v) || v < -1000 || v > 9000;
    if (bad(a) || bad(b) || bad(c) || bad(d)) { const good = [a, b, c, d].filter((v) => !bad(v)); return good.length ? good.reduce((s, v) => s + v, 0) / good.length : NaN; }
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

export function heights({ land, sea, msl }, { half, cell }) {
  const res = Math.round(2 * half / cell) + 1, g = new Int16Array(res * res);
  let water = 0;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = -half + i * cell, z = -half + j * cell, E = originE + x, N = originN - z;
    const B = sea(E, N), T = land(E, N);
    // water: NCEI seabed below −1 m (MSL) or no land data; else 3DEP land (NCEI where 3DEP is missing)
    let v;
    if ((Number.isFinite(B) && B - msl < -1) || (!Number.isFinite(T) && !(Number.isFinite(B) && B - msl > 0))) { v = WATER; water++; }
    else v = Math.max(-3276, Math.min(32767, Math.round(((Number.isFinite(T) ? T : B) - msl) * 10)));
    g[j * res + i] = v;
  }
  return { data: g, res, cell, originX: -half, originZ: -half, water };
}

// colour: fit the ring image to the engine's aerial map (land pixels of the square), per channel r' = a r + b
export function imagery() {
  const t = readTiff(readFileSync(join(raw, 'ring-naip.tif')));
  const W = t.width, H = t.height, cell = t.tags[33550][0], [, , , e0, n0] = t.tags[33922];
  const ti = JSON.parse(readFileSync(join(root, 'public/terrain/index.json'), 'utf8'));
  const A = ti.aerial, aer = inflateSync(readFileSync(join(root, 'public/terrain', A.file)));
  const half = map.frame.size / 2;
  const sums = [0, 1, 2].map(() => ({ n: 0, x: 0, y: 0, xx: 0, xy: 0 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const E = e0 + (x + 0.5) * cell, N = n0 - (y + 0.5) * cell, lx = E - originE, lz = originN - N;
    if (Math.abs(lx) >= half || Math.abs(lz) >= half) continue;
    const ai = Math.floor((lx + half) / A.cell), aj = Math.floor((lz + half) / A.cell), ak = (aj * A.width + ai) * 3;
    if (!aer[ak] && !aer[ak + 1] && !aer[ak + 2]) continue; // engine water
    const k = y * W + x;
    for (let c = 0; c < 3; c++) { const s = sums[c], r = t.bands[c][k], a = aer[ak + c]; s.n++; s.x += r; s.y += a; s.xx += r * r; s.xy += r * a; }
  }
  const fit = sums.map((s) => { const a = (s.n * s.xy - s.x * s.y) / (s.n * s.xx - s.x * s.x); return { a, b: (s.y - a * s.x) / s.n }; });
  const bands = [0, 1, 2].map(() => new Uint8Array(W * H));
  const OCEAN = [34, 52, 66];
  for (let k = 0; k < W * H; k++) {
    const r = t.bands[0][k], g = t.bands[1][k], b = t.bands[2][k];
    const empty = r === 0 && g === 0 && b === 0;
    for (let c = 0; c < 3; c++) bands[c][k] = empty ? OCEAN[c] : Math.max(0, Math.min(255, Math.round(fit[c].a * t.bands[c][k] + fit[c].b)));
  }
  return { width: W, height: H, cell, originX: e0 - originE, originZ: originN - n0, bands, fit };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(out, { recursive: true });
  const msl = mslOffset();
  const land = sampler(readTiff(readFileSync(join(raw, 'ring-3dep.tif')))), sea = sampler(readTiff(readFileSync(join(raw, 'ring-ncei.tif'))));
  const band = heights({ land, sea, msl }, { half: 24000, cell: 30 }), outer = heights({ land, sea, msl }, { half: 60000, cell: 120 });
  const Z = { level: 9 }, sha = (b) => createHash('sha256').update(b).digest('hex');
  const bb = deflateSync(Buffer.from(band.data.buffer), Z), ob = deflateSync(Buffer.from(outer.data.buffer), Z);
  writeFileSync(join(out, 'band.bin'), bb); writeFileSync(join(out, 'outer.bin'), ob);
  const img = imagery();
  const tif = join(out, 'imagery.tif');
  writeFileSync(tif, writeRgbTiff({ width: img.width, height: img.height, bands: img.bands, cell: img.cell, originE: RING.minE, originN: RING.maxN }));
  const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', tif, '--out', join(out, 'imagery.jpg')], { encoding: 'utf8' });
  rmSync(tif);
  if (r.status !== 0) throw new Error('sips: ' + r.stderr);
  const jpg = readFileSync(join(out, 'imagery.jpg'));
  const index = {
    format: 'sfo-flight-ring/1', water: WATER, heights: 'Int16LE decimetres above local MSL (NAVD88 + ' + msl.toFixed(3) + ' m), vertex-centred, row 0 = north, zlib deflate',
    band: { file: 'band.bin', res: band.res, cell: band.cell, originX: band.originX, originZ: band.originZ, waterVertices: band.water, sha256: sha(bb) },
    outer: { file: 'outer.bin', res: outer.res, cell: outer.cell, originX: outer.originX, originZ: outer.originZ, waterVertices: outer.water, sha256: sha(ob) },
    imagery: { file: 'imagery.jpg', width: img.width, height: img.height, cell: img.cell, originX: img.originX, originZ: img.originZ, fit: img.fit, sha256: sha(jpg) },
    sources: ['ring-3dep.tif', 'ring-ncei.tif', 'ring-naip.tif', 'noaa-datums-9414523.json', 'public/terrain/aerial.bin (colour reference)'],
  };
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(`ring: band ${band.res}² @ ${band.cell} m (${(bb.length / 1e6).toFixed(2)} MB, ${band.water} water), outer ${outer.res}² @ ${outer.cell} m (${(ob.length / 1e6).toFixed(2)} MB), imagery ${img.width}² ${(jpg.length / 1e6).toFixed(2)} MB, fit ${JSON.stringify(img.fit.map((f) => [+f.a.toFixed(3), +f.b.toFixed(1)]))}`);
}

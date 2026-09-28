// Collision layers for the flight model (fdm/world.ts), baked from this title's own outputs so the aircraft and the
// picture agree: a paved mask (FAA NASR runway rectangles + OSM runways, taxiways and aprons) around the airport, and
// a roof grid (the top of the building and landmark meshes, LOD0) over the whole square. Deterministic, no network.
//   node pipelines/collision/build.mjs → public/flight/paved.bin, roofs.bin, collision.json
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLocal } from '../lib/utm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pub = join(root, 'public');
const Z = { level: 9 };

// ---- paved: 3 m cells over an 8.1 km box around the ARP
export function paved() {
  const apt = JSON.parse(readFileSync(join(pub, 'flight/airport.json'), 'utf8'));
  const cell = 3, span = 8100, res = span / cell, ox = apt.arp[0] - span / 2, oz = apt.arp[1] - span / 2;
  const m = new Uint8Array(res * res);
  const fillPoly = (pts) => { // pts [[x, z]…] title frame; scanline over cell centres
    let z0 = Infinity, z1 = -Infinity; for (const [, z] of pts) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.max(0, Math.floor((z0 - oz) / cell)); j <= Math.min(res - 1, Math.ceil((z1 - oz) / cell)); j++) {
      const zc = oz + (j + 0.5) * cell, xs = [];
      for (let k = 0; k < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length]; if ((az <= zc) !== (bz <= zc)) xs.push(ax + (zc - az) / (bz - az) * (bx - ax)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - ox) / cell - 0.5)); i <= Math.min(res - 1, Math.floor((xs[k + 1] - ox) / cell - 0.5)); i++) m[j * res + i] = 1;
    }
  };
  const band = (a, b, w) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2; fillPoly([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]); };
  // NASR runways: full length end to end, published width + 3 m shoulders
  for (const r of apt.runways) band(r.ends[0].end, r.ends[1].end, r.widthM + 6);
  // OSM: runway / taxiway lines at their width tag (or 23 m), aprons and closed ways as areas
  const osm = JSON.parse(readFileSync(join(root, 'data/raw/osm-airport.json'), 'utf8'));
  let areas = 0, lines = 0;
  for (const e of osm.elements) {
    const t = e.tags || {}, g = e.geometry; if (!g || !g.length) continue;
    const pts = g.map((p) => toLocal(p.lat, p.lon));
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
    if (t.aeroway === 'apron' || (closed && (t.aeroway === 'taxiway' || t.area === 'yes'))) { fillPoly(pts); areas++; }
    else if (t.aeroway === 'taxiway' || t.aeroway === 'runway') { const w = Number(t.width) || (t.aeroway === 'runway' ? 61 : 23); for (let k = 0; k + 1 < pts.length; k++) band(pts[k], pts[k + 1], w); lines++; }
  }
  return { mask: m, meta: { cell, res, originX: ox, originZ: oz, areas, lines, pavedCells: m.reduce((a, b) => a + b, 0) } };
}

// ---- roofs: 6 m cells over the square, the highest mesh surface over each cell centre (decimetres, uint16)
function glbTris(buf, off = [0, 0, 0]) {
  const jl = buf.readUInt32LE(12), J = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const binStart = 20 + jl + 8;
  const out = [];
  for (const node of J.nodes || []) {
    if (node.mesh == null) continue;
    const t = node.translation || [0, 0, 0];
    for (const pr of J.meshes[node.mesh].primitives) {
      const pa = J.accessors[pr.attributes.POSITION], pv = J.bufferViews[pa.bufferView];
      const P = new Float32Array(buf.buffer, buf.byteOffset + binStart + (pv.byteOffset || 0) + (pa.byteOffset || 0), pa.count * 3);
      let I;
      if (pr.indices != null) { const ia = J.accessors[pr.indices], iv = J.bufferViews[ia.bufferView]; const o = buf.byteOffset + binStart + (iv.byteOffset || 0) + (ia.byteOffset || 0); I = ia.componentType === 5125 ? new Uint32Array(buf.buffer.slice(o, o + ia.count * 4)) : new Uint16Array(buf.buffer.slice(o, o + ia.count * 2)); }
      else I = Uint32Array.from({ length: pa.count }, (_, k) => k);
      out.push({ P: Float32Array.from(P), I, t: [t[0] + off[0], t[1] + off[1], t[2] + off[2]] });
    }
  }
  return out;
}
export function roofs() {
  const map = JSON.parse(readFileSync(join(root, 'map.json'), 'utf8'));
  const size = map.frame.size, cell = 6, res = size / cell, o = -size / 2;
  const R = new Uint16Array(res * res);
  const raster = (prims) => {
    for (const { P, I, t } of prims) for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ax = P[a] + t[0], ay = P[a + 1] + t[1], az = P[a + 2] + t[2], bx = P[b] + t[0], by = P[b + 1] + t[1], bz = P[b + 2] + t[2], cx = P[c] + t[0], cy = P[c + 1] + t[1], cz = P[c + 2] + t[2];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - o) / cell)), i1 = Math.min(res - 1, Math.floor((Math.max(ax, bx, cx) - o) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - o) / cell)), j1 = Math.min(res - 1, Math.floor((Math.max(az, bz, cz) - o) / cell));
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = o + (i + 0.5) * cell, pz = o + (j + 0.5) * cell;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * ay + l2 * by + l3 * cy, v = Math.min(65535, Math.max(1, Math.round((y + 50) * 10)));
        if (v > R[j * res + i]) R[j * res + i] = v;
      }
    }
  };
  let tiles = 0;
  for (const f of readdirSync(join(pub, 'buildings')).filter((f) => /^b_\d+_\d+\.glb\.deflate$/.test(f)).sort()) { raster(glbTris(inflateSync(readFileSync(join(pub, 'buildings', f))))); tiles++; }
  const lm = JSON.parse(readFileSync(join(pub, 'landmarks/index.json'), 'utf8'));
  for (const L of lm.landmarks) raster(glbTris(readFileSync(join(pub, 'landmarks', L.lods[0].name)), [L.anchor[0], L.ground ?? 0, L.anchor[1]]));
  return { roofs: R, meta: { cell, res, origin: o, tiles, landmarks: lm.landmarks.map((l) => l.slug), encoding: 'uint16 LE: 0 = open; else (top + 50 m) × 10', roofCells: R.reduce((a, v) => a + (v ? 1 : 0), 0) } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(pub, 'flight'), { recursive: true });
  const p = paved(), r = roofs();
  const pb = deflateSync(Buffer.from(p.mask.buffer), Z), rb = deflateSync(Buffer.from(r.roofs.buffer), Z);
  writeFileSync(join(pub, 'flight/paved.bin'), pb); writeFileSync(join(pub, 'flight/roofs.bin'), rb);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const meta = { format: 'sfo-flight-collision/1', paved: { file: 'paved.bin', ...p.meta, sha256: sha(pb) }, roofs: { file: 'roofs.bin', ...r.meta, sha256: sha(rb) } };
  writeFileSync(join(pub, 'flight/collision.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(`collision: paved ${p.meta.pavedCells} cells (${p.meta.areas} areas, ${p.meta.lines} lines) ${(pb.length / 1024).toFixed(0)} KB; roofs ${r.meta.roofCells} cells from ${r.meta.tiles} tiles + ${r.meta.landmarks.length} landmarks ${(rb.length / 1024).toFixed(0)} KB`);
}

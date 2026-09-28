// The low-detail ring: terrain beyond the engine's 24 km square out to 60 km (public/ring, pipelines/ring/build.mjs).
// 6 km tiles of the 30 m band grid out to 24 km from the centre, 12 km tiles of the 120 m outer grid beyond; each
// tile has distance LODs, skirts against cracks, and the colour-matched
// NAIP image as its texture. Water sits just below sea level so the engine's ocean draws over it where it reaches.
import { BufferGeometry, BufferAttribute, Group, Mesh, Color, Vector2 } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine';
import { Texture } from 'harbor-engine/src/engine/gpu/Texture.js';
import { generateMipmaps } from 'harbor-engine/src/engine/gpu/Mipmaps.js';

const WATER = -32768, WATER_Y = -1.5;
// the band: 6 km tiles over the 48 km square minus the engine's 24 km; the outer ring: 12 km tiles to 60 km
const LAYOUT = [{ tile: 6000, half: 24000, hole: 12000, grid: 'band', steps: [1, 2, 4, 8] }, { tile: 12000, half: 60000, hole: 24000, grid: 'outer', steps: [1, 2, 4, 8] }];
const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';

async function imageTexture(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const data = new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer);
  const tex = new Texture({ label: 'ringImagery', width: bmp.width, height: bmp.height, format: 'rgba8unorm', mips: true, usage: ['sample', 'copyDst'], data });
  tex.getGPU(); generateMipmaps(tex);
  return tex;
}

export class Ring {
  constructor(index, arrays) { this.index = index; this.band = arrays.band; this.outer = arrays.outer; this.group = new Group(); this.group.name = 'ring'; this.tiles = []; this.triangles = 0; }

  async build(scene, quality = 'low') {
    const I = this.index.imagery;
    this.tex = await imageTexture(base() + 'ring/' + I.file);
    const img = I, u0 = img.originX, v0 = img.originZ, uw = img.width * img.cell, vh = img.height * img.cell;
    this.material = new Material({ name: 'ring-terrain', color: new Color(1, 1, 1), roughness: 0.95, metalness: 0,
      textures: { ringImagery: this.tex },
      uniforms: { imgOrigin: ['vec2f', new Vector2(u0, v0)], imgSize: ['vec2f', new Vector2(uw, vh)] },
      surface: /* wgsl */`
	let uv = ( in.P.xz - mat.imgOrigin ) / mat.imgSize;
	let c = pow( textureSample( ringImagery, smpLinearClamp, uv ).rgb, vec3f( 2.2 ) );
	let wet = step( in.P.y, -1.0 );
	s.albedo = mix( c, vec3f( 0.02, 0.05, 0.07 ), wet * 0.6 );
	s.roughness = mix( 0.95, 0.12, wet );` });
    this.lodDist = quality === 'high' ? [5000, 12000, 26000] : [3500, 9000, 22000];
    for (const Lay of LAYOUT) {
      const n = Math.round(2 * Lay.half / Lay.tile), grid = this[Lay.grid];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x0 = -Lay.half + i * Lay.tile, z0 = -Lay.half + j * Lay.tile;
        if (x0 >= -Lay.hole && x0 + Lay.tile <= Lay.hole && z0 >= -Lay.hole && z0 + Lay.tile <= Lay.hole) continue;
        const lods = Lay.steps.map((st) => this.tileMesh(grid, x0, z0, st, Lay.tile));
        const tile = { x: x0 + Lay.tile / 2, z: z0 + Lay.tile / 2, size: Lay.tile, lods, cur: -1 };
        for (const m of lods) { m.visible = false; this.group.add(m); }
        this.tiles.push(tile);
      }
    }
    scene.add(this.group);
  }

  h(grid, i, j) { const v = grid.data[j * grid.res + i]; return v === WATER ? WATER_Y : v / 10; }

  tileMesh(grid, x0, z0, step, TILE) {
    const c = grid.cell * step, n = Math.round(TILE / c), gi0 = Math.round((x0 - grid.originX) / grid.cell), gj0 = Math.round((z0 - grid.originZ) / grid.cell);
    const nv = (n + 1) * (n + 1), sk = 4 * (n + 1);
    const P = new Float32Array((nv + sk) * 3), Nn = new Float32Array((nv + sk) * 3), idx = [];
    const H = (a, b) => this.h(grid, Math.min(grid.res - 1, Math.max(0, gi0 + a * step)), Math.min(grid.res - 1, Math.max(0, gj0 + b * step)));
    for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) {
      const k = b * (n + 1) + a, y = H(a, b);
      P[k * 3] = x0 + a * c; P[k * 3 + 1] = y; P[k * 3 + 2] = z0 + b * c;
      const dx = H(a + 1, b) - H(a - 1, b), dz = H(a, b + 1) - H(a, b - 1), l = Math.hypot(dx, 2 * c, dz);
      Nn[k * 3] = -dx / l; Nn[k * 3 + 1] = 2 * c / l; Nn[k * 3 + 2] = -dz / l;
    }
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) { const k = b * (n + 1) + a; idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2); }
    // skirts: each edge vertex dropped 80 m
    let s = nv;
    const edge = (list) => { const first = s; for (const k of list) { P[s * 3] = P[k * 3]; P[s * 3 + 1] = P[k * 3 + 1] - 80; P[s * 3 + 2] = P[k * 3 + 2]; Nn[s * 3 + 1] = 1; s++; } for (let q = 0; q < list.length - 1; q++) { const a = list[q], b = list[q + 1], a2 = first + q, b2 = first + q + 1; idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); } };
    edge([...Array(n + 1).keys()]); edge([...Array(n + 1).keys()].map((a) => n * (n + 1) + a)); edge([...Array(n + 1).keys()].map((b) => b * (n + 1))); edge([...Array(n + 1).keys()].map((b) => b * (n + 1) + n));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(P, 3)); g.setAttribute('normal', new BufferAttribute(Nn, 3));
    g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere?.();
    const m = new Mesh(g, this.material); m.name = `ring_${step}`; m.userData.triangles = idx.length / 3; m.castShadow = false; m.receiveShadow = true;
    return m;
  }

  // choose each tile's level by the camera's horizontal distance to the tile centre
  update(camera) {
    const cx = camera.position.x, cz = camera.position.z, L = this.lodDist;
    let tris = 0;
    for (const t of this.tiles) {
      const d = Math.max(0, Math.hypot(t.x - cx, t.z - cz) - t.size * 0.7) * (6000 / t.size) ** 0.5;
      let lod = d < L[0] ? 0 : d < L[1] ? 1 : d < L[2] ? 2 : 3;
      lod = Math.min(lod, t.lods.length - 1);
      if (lod !== t.cur) { if (t.cur >= 0) t.lods[t.cur].visible = false; t.lods[lod].visible = true; t.cur = lod; }
      tris += t.lods[lod].userData.triangles;
    }
    this.triangles = tris;
  }
}

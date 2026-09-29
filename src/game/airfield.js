// The airfield the game owns: runway pavement and markings laid on the terrain from FAA NASR geometry
// (public/flight/airport.json), and the lighting (runway edge / threshold / end / centreline / touchdown-zone
// lights, PAPI, the ALSF-2 on 28R and MALSR on 28L over the bay on their piers). Lights are instanced cubes that
// the vertex shader scales with distance, so they stay visible as points from the tower or 5 miles out, and
// glow brighter at night (frame.night). Geometry in the title frame: x east, z south, y up (m above local MSL).
// M1.2: the approach lights, their sequenced flashers ("rabbit") and the PAPI are their own meshes: `approach.
// setBoost(b)` lights them up for AUTO LAND / GUIDE ME in any time of day, and `approach.update(eye)` sets each PAPI
// box white or red from the eye's elevation angle (papiRead, the one rule the page and gate F10 share).
import { BufferGeometry, BufferAttribute, BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, Vector2, Vector3 } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine';

const FT = 0.3048, D = Math.PI / 180;

// PAPI: four boxes left of the runway at the glide path's origin (TCH / tan θ past the threshold), numbered from the
// runway edge outward, set at θ + 0.5°, + 0.17°, − 0.17°, − 0.5° (FAA AC 150/5345-28): a box shows white when the eye
// is above its setting. On the path: the two inner red, the two outer white; low: all red; high: all white.
export const PAPI_SETTINGS = [0.5, 1 / 6, -1 / 6, -0.5];
export function papiRead(eye, unit) {
  return unit.boxes.map((b, k) => { const dx = eye[0] - b[0], dz = eye[2] - b[2], el = Math.atan2(eye[1] - b[1], Math.hypot(dx, dz)) / D; return el > unit.gsDeg + PAPI_SETTINGS[k] ? 'W' : 'R'; });
}
import { RUNWAY_LIFT } from '../../fdm/world.ts';
const LIFT = RUNWAY_LIFT; // pavement above the terrain surface (the terrain mesh morphs by a few centimetres); the flight model rolls on it

function quadStrip(P, N, I, pts, y) {
  // pts: [x, z] × 4 in order; y: height per point (array) or a function of (x, z)
  const o = P.length / 3;
  for (const [x, z] of pts) { const h = typeof y === 'function' ? y(x, z) : y; P.push(x, h, z); N.push(0, 1, 0); }
  I.push(o, o + 2, o + 1, o, o + 3, o + 2);
}

// a rectangle in runway coordinates: s along the runway from a reference point (m), w across (+ = right of the
// direction), length ls, width lw
function rect(P, N, I, ref, dir, s0, w0, ls, lw, hAt) {
  const [ux, uz] = dir, [rx, rz] = [- uz, ux]; // right of the direction (x east, z south: right of north is east)
  const pt = (s, w) => [ref[0] + ux * s + rx * w, ref[1] + uz * s + rz * w];
  const a = pt(s0, w0 - lw / 2), b = pt(s0, w0 + lw / 2), c = pt(s0 + ls, w0 + lw / 2), d = pt(s0 + ls, w0 - lw / 2);
  quadStrip(P, N, I, [a, d, c, b], hAt);
}

// 7-segment glyphs for runway numerals and L / R, 18.3 m tall (FAA 60 ft), 6 m wide, strokes 1.5 m
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', L: 'fed', R: 'abfgec' };
function glyph(P, N, I, ref, dir, s0, w0, ch, hAt) {
  const H = 18.3, W = 6, t = 1.5, segs = SEG[ch] || '';
  const bar = (s, w, ls, lw) => rect(P, N, I, ref, dir, s0 + s, w0 + w, ls, lw, hAt);
  // glyph frame: s runs "up" the glyph as read from the approach (numerals are read by a pilot on final: top of the
  // digit is farther down the runway), w runs left→right
  if (segs.includes('a')) bar(H - t, 0, t, W);           // top
  if (segs.includes('d')) bar(0, 0, t, W);               // bottom
  if (segs.includes('g')) bar(H / 2 - t / 2, 0, t, W);   // middle
  if (segs.includes('b')) bar(H / 2, W / 2 - t / 2, H / 2, t);   // upper right
  if (segs.includes('c')) bar(0, W / 2 - t / 2, H / 2, t);       // lower right
  if (segs.includes('f')) bar(H / 2, - W / 2 + t / 2, H / 2, t); // upper left
  if (segs.includes('e')) bar(0, - W / 2 + t / 2, H / 2, t);     // lower left
  if (ch === 'R') bar(0, W / 2 - t / 2, H / 2, t); // R: the lower right leg doubles as the tail
}

export function buildAirfield(airport, heightAt) {
  const group = new Group();
  group.name = 'airfield';
  const hAt = (x, z) => heightAt(x, z) + LIFT, hMark = (x, z) => heightAt(x, z) + LIFT + 0.04;
  const aP = [], aN = [], aI = [], mP = [], mN = [], mI = [];
  const lights = { white: [], red: [], green: [], amber: [], blue: [] };
  const als = { white: [], red: [] }, flashers = [], papis = []; // the approach set (M1.2)
  const light = (c, x, z, y = null) => lights[c].push([x, y ?? heightAt(x, z) + 0.6, z]);
  const piers = [];
  for (const rw of airport.runways) {
    const [A, B] = rw.ends, w = rw.widthM;
    const L = Math.hypot(B.end[0] - A.end[0], B.end[1] - A.end[1]);
    const u = [(B.end[0] - A.end[0]) / L, (B.end[1] - A.end[1]) / L]; // A.end → B.end (the direction of A's runway heading)
    const r = [- u[1], u[0]];
    // pavement: 60 m segments following the terrain
    for (let s = 0; s < L; s += 60) {
      const s1 = Math.min(L, s + 60);
      const pt = (ss, ww) => [A.end[0] + u[0] * ss + r[0] * ww, A.end[1] + u[1] * ss + r[1] * ww];
      quadStrip(aP, aN, aI, [pt(s, - w / 2), pt(s1, - w / 2), pt(s1, w / 2), pt(s, w / 2)], hAt);
    }
    // edge lines (0.9 m) both sides, full length
    for (const side of [- 1, 1]) rect(mP, mN, mI, A.end, u, 0, side * (w / 2 - 0.6), L, 0.9, hMark);
    // per end: threshold bar, numerals, aiming point, touchdown zone bars, centreline dashes, displaced-threshold arrows
    for (const [E, dir, ref0] of [[A, u, A.end], [B, [- u[0], - u[1]], B.end]]) {
      const disp = E.displacedFt * FT, thr = [ref0[0] + dir[0] * disp, ref0[1] + dir[1] * disp];
      const lda = L - disp - (E === A ? B.displacedFt : A.displacedFt) * FT;
      // displaced threshold: arrows (shafts + heads) on the centreline, and a bar at the threshold
      if (disp > 10) {
        for (let s = 10; s + 45 < disp; s += 60) { rect(mP, mN, mI, ref0, dir, s, 0, 30, 0.9, hMark); rect(mP, mN, mI, ref0, dir, s + 30, 0, 12, 4, hMark); }
        rect(mP, mN, mI, thr, dir, 0, 0, 1.5, w - 4, hMark);
      }
      // threshold stripes: 12 stripes (200 ft runways), 45 m long, 1.8 m wide, from 6 m past the threshold
      for (let k = 0; k < 12; k++) { const ww = (k - 5.5) * 3.6 + (k >= 6 ? 3.6 : - 3.6) * 0.5; rect(mP, mN, mI, thr, dir, 6, ww, 45, 1.8, hMark); }
      // numerals at 60 m: "28R" → digits side by side, L/R after
      const label = E.id.replace(/^0/, ''), chars = label.split(''), total = chars.length * 8 - 2;
      chars.forEach((ch, i) => glyph(mP, mN, mI, thr, dir, 62, (i * 8) - total / 2 + 3, ch, hMark));
      // aiming point: two bars 45 × 6 m at 300 m
      for (const side of [- 1, 1]) rect(mP, mN, mI, thr, dir, 300, side * 11, 45, 6, hMark);
      // touchdown zone: pairs of bars (3 / 2 / 1 stripes) at 150, 450, 600, 750, 900 m
      for (const [s, n] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) if (s + 25 < lda) for (const side of [- 1, 1]) for (let k = 0; k < n; k++) rect(mP, mN, mI, thr, dir, s, side * (11 + k * 2.4), 22, 1.8, hMark);
      // centreline dashes 36 m on / 24 m off from 110 m to the middle of the runway
      for (let s = 110; s + 36 < lda / 2 + 30; s += 60) rect(mP, mN, mI, thr, dir, s, 0, 36, 0.9, hMark);
      // ---- lights
      // threshold: green toward the approach, red (runway end) toward the runway, every 3 m across the width
      for (let ww = - w / 2 - 3; ww <= w / 2 + 3; ww += 3) { light('green', thr[0] + dir[0] * - 1 + r[0] * ww, thr[1] + dir[1] * - 1 + r[1] * ww); }
      for (let ww = - w / 2 + 3; ww <= w / 2 - 3; ww += 3) { const e = [ref0[0] + dir[0] * (L + 1), ref0[1] + dir[1] * (L + 1)]; light('red', e[0] + r[0] * ww, e[1] + r[1] * ww); }
      // touchdown zone barrettes (3 lights) every 30 m for 900 m, ILS runways
      if (E.ils) for (let s = 30; s <= 900 && s < lda; s += 30) for (const side of [- 1, 1]) for (let k = 0; k < 3; k++) light('white', thr[0] + dir[0] * s + r[0] * side * (11 + k * 1.5), thr[1] + dir[1] * s + r[1] * side * (11 + k * 1.5));
      // PAPI: four boxes left of the runway at the glide path's origin (see papiRead)
      if (E.ils) {
        const gs = E.gsDeg ?? 3, at = (E.tchFt ?? 50) * FT / Math.tan(gs * D), boxes = [];
        for (let k = 0; k < 4; k++) { const x = thr[0] + dir[0] * at - r[0] * (w / 2 + 15 + k * 9), z = thr[1] + dir[1] * at - r[1] * (w / 2 + 15 + k * 9); boxes.push([x, heightAt(x, z) + 0.9, z]); }
        papis.push({ id: E.id, gsDeg: gs, boxes });
      }
      // approach lighting over the bay: ALSF-2 (28R) 2400 ft, MALSR (28L) 1400 ft + RAIL to 2400 ft, on a pier
      if (E.approachLights) {
        const alsf = E.approachLights === 'ALSF2', back = [- dir[0], - dir[1]];
        const at = (s, ww) => [thr[0] + back[0] * s + r[0] * ww, thr[1] + back[1] * s + r[1] * ww];
        const pierY = heightAt(thr[0], thr[1]) + 2.6; // lights on a pier at runway height over the water
        // over the displaced-threshold pavement the lights are flush with it (a slab there would stand in the cockpit)
        const onPave = disp + 10;
        const yAt = (s, p) => (s < onPave ? heightAt(p[0], p[1]) + 0.45 : pierY);
        const L = (list, s, p) => list.push([p[0], yAt(s, p), p[1]]);
        // sequenced flashers: ALSF-2 one per station 1,000–2,400 ft, MALSR's RAIL 1,600–2,400 ft
        const fl = { id: E.id, thr: [thr[0], thr[1]], back, s0: (alsf ? 1000 : 1600) * FT, s1: 2400 * FT, list: [] };
        for (let ft = 100; ft <= 2400; ft += alsf ? 100 : 200) {
          const s = ft * FT;
          if (alsf || ft <= 1400) for (let k = - 2; k <= 2; k++) L(als.white, s, at(s, k * 1.1));
          else L(als.white, s, at(s, 0)); // RAIL
          if (alsf && ft <= 900) for (const side of [- 1, 1]) for (let k = 0; k < 3; k++) L(als.red, s, at(s, side * (9 + k * 1.1)));
          if (ft === 1000) for (let ww = - 15; ww <= 15; ww += 1.5) L(als.white, s, at(s, ww));
          if (ft === 500 && alsf) for (let ww = - 10; ww <= 10; ww += 1.5) L(als.white, s, at(s, ww));
          if (s >= fl.s0 - 1) { const p = at(s, 0); fl.list.push([p[0], yAt(s, p) + 0.5, p[1]]); }
        }
        flashers.push(fl);
        if (onPave + 5 < 2400 * FT) piers.push({ from: at(onPave + 5, 0), to: at(2400 * FT + 5, 0), y: pierY - 0.8, dir: back, r });
      }
    }
    // runway edge lights every 60 m (amber over the last 600 m of each end), centreline lights every 15 m (ILS runways)
    for (let s = 30; s < L; s += 60) for (const side of [- 1, 1]) light(s < 600 || s > L - 600 ? 'amber' : 'white', A.end[0] + u[0] * s + r[0] * side * (w / 2 + 1), A.end[1] + u[1] * s + r[1] * side * (w / 2 + 1));
    if (A.ils || B.ils) for (let s = 15; s < L; s += 15) light(s < 300 || s > L - 300 ? 'red' : 'white', A.end[0] + u[0] * s + r[0] * 0.5, A.end[1] + u[1] * s + r[1] * 0.5);
  }
  // pavement and markings meshes
  const mesh = (P, N, I, mat) => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3)); g.setIndex(new BufferAttribute(new Uint32Array(I), 1)); const m = new Mesh(g, mat); m.receiveShadow = true; m.frustumCulled = false; return m; };
  group.add(mesh(aP, aN, aI, new Material({ name: 'runway-asphalt', color: new Color(0.10, 0.10, 0.105), roughness: 0.92, metalness: 0,
    surface: /* wgsl */`
	// worn concrete / asphalt: fine grain plus tyre rubber toward the centreline of the touchdown zones is left to the markings
	let g = fract( sin( dot( floor( in.P.xz * 1.7 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	s.albedo = s.albedo * ( 0.85 + 0.3 * g );
	s.roughness = 0.9;` })));
  group.add(mesh(mP, mN, mI, new Material({ name: 'runway-paint', color: new Color(0.86, 0.86, 0.84), roughness: 0.7, metalness: 0 })));
  // approach-light piers: a walkway and posts over the water
  const pP = [], pN = [], pI = [];
  for (const p of piers) {
    const len = Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]);
    const box = (cx, cz, sx, sz, y0, y1) => {
      const c = [[cx - p.dir[0] * sx / 2 - p.r[0] * sz / 2, cz - p.dir[1] * sx / 2 - p.r[1] * sz / 2], [cx + p.dir[0] * sx / 2 - p.r[0] * sz / 2, cz + p.dir[1] * sx / 2 - p.r[1] * sz / 2], [cx + p.dir[0] * sx / 2 + p.r[0] * sz / 2, cz + p.dir[1] * sx / 2 + p.r[1] * sz / 2], [cx - p.dir[0] * sx / 2 + p.r[0] * sz / 2, cz - p.dir[1] * sx / 2 + p.r[1] * sz / 2]];
      const o = pP.length / 3;
      for (const yy of [y0, y1]) for (const [x, z] of c) { pP.push(x, yy, z); pN.push(0, 1, 0); }
      pI.push(o + 4, o + 6, o + 5, o + 4, o + 7, o + 6); // top
      for (let k = 0; k < 4; k++) { const a = o + k, b = o + (k + 1) % 4; pI.push(a, b, b + 4, a, b + 4, a + 4); }
    };
    box(p.from[0] + p.dir[0] * len / 2, p.from[1] + p.dir[1] * len / 2, len, 1.6, p.y - 0.3, p.y); // walkway
    for (let s = 0; s <= len; s += 30) box(p.from[0] + p.dir[0] * s, p.from[1] + p.dir[1] * s, 0.5, 0.5, - 3, p.y - 0.3); // posts
  }
  if (pP.length) group.add(mesh(pP, pN, pI, new Material({ name: 'als-pier', color: new Color(0.28, 0.27, 0.25), roughness: 0.85 })));
  // lights: instanced cubes scaled with distance, emissive by day and brighter at night
  const COL = { white: [1, 0.96, 0.85], red: [1, 0.12, 0.06], green: [0.15, 1, 0.35], amber: [1, 0.7, 0.15], blue: [0.2, 0.4, 1] };
  const cube = new BoxGeometry(0.34, 0.34, 0.34);
  const m = new Matrix4();
  let count = 0;
  for (const [c, list] of Object.entries(lights)) {
    if (!list.length) continue;
    // the cube grows with distance so a light stays a point of a few pixels at any range; `lens` (fov / 60, set by
    // the game every frame) keeps a telephoto shot from turning them into blocks
    const mat = new Material({ name: 'runway-light-' + c, color: new Color(...COL[c]), roughness: 0.4, metalness: 0,
      uniforms: { lens: ['f32', 1] },
      vertex: /* wgsl */`
	let centre = v.model[ 3 ].xyz;
	let d = distance( centre, frame.cameraPos );
	v.position = v.position * clamp( d / 420.0 * mat.lens, 1.0, 50.0 );`,
      surface: /* wgsl */`
	s.emissive = s.albedo * ( 2.5 + 14.0 * frame.night );
	s.albedo = s.albedo * 0.25;` });
    const im = new InstancedMesh(cube, mat, list.length);
    list.forEach(([x, y, z], i) => im.setMatrixAt(i, m.makeTranslation(x, y, z)));
    im.frustumCulled = false;
    im.name = 'lights-' + c;
    group.add(im);
    count += list.length;
  }
  // ---- the approach set: ALS (boostable), the rabbit, the PAPI (colours from the eye, per frame)
  const boostMats = [];
  const lightMat = (name, col, extraU = {}, vtx = '') => {
    const m = new Material({ name, color: new Color(...col), roughness: 0.4, metalness: 0, uniforms: { lens: ['f32', 1], boost: ['f32', 0], ...extraU },
      vertex: /* wgsl */`
	let centre = v.model[ 3 ].xyz;
	let d = distance( centre, frame.cameraPos );
	var k = clamp( d / 420.0 * mat.lens, 1.0, 50.0 ) * ( 1.0 + 0.8 * mat.boost );
	${vtx}
	v.position = v.position * k;`,
      surface: /* wgsl */`
	s.emissive = s.albedo * in.color.rgb * ( 2.5 + 14.0 * frame.night + 40.0 * mat.boost );
	s.albedo = s.albedo * 0.25;` });
    boostMats.push(m); return m;
  };
  const inst = (list, mat, name) => { const im = new InstancedMesh(cube, mat, list.length); list.forEach(([x, y, z], i) => im.setMatrixAt(i, m.makeTranslation(x, y, z))); im.frustumCulled = false; im.name = name; group.add(im); count += list.length; return im; };
  for (const c of ['white', 'red']) if (als[c].length) inst(als[c], lightMat('als-' + c, COL[c]), 'als-' + c);
  // the rabbit: one flash runs from the far end to the inner end twice a second, lit only when boosted or at night
  for (const fl of flashers) {
    const mat = lightMat('als-flash-' + fl.id, [1, 1, 1], { thr: ['vec2f', new Vector2(...fl.thr)], back: ['vec2f', new Vector2(...fl.back)], s0: ['f32', fl.s0], s1: ['f32', fl.s1], n: ['f32', fl.list.length] }, /* wgsl */`
	let sAlong = dot( centre.xz - mat.thr, mat.back );
	let pos = clamp( ( mat.s1 - sAlong ) / max( mat.s1 - mat.s0, 1.0 ), 0.0, 1.0 ); // 0 far … 1 inner
	let ph = fract( frame.time * 2.0 );
	let on = select( 0.0, 1.0, abs( ph - pos ) < 0.5 / max( mat.n - 1.0, 1.0 ) + 0.01 ) * max( mat.boost, frame.night );
	k = k * 2.2 * on;`);
    inst(fl.list, mat, 'als-flash-' + fl.id);
  }
  const papiList = papis.flatMap((u) => u.boxes);
  const papiMesh = papiList.length ? inst(papiList, lightMat('papi', [1, 1, 1]), 'papi') : null;
  const white = new Color(1, 0.96, 0.85), red = new Color(1, 0.12, 0.06);
  const approach = {
    papis, flashers, boost: 0, papiState: {},
    setBoost(b) { this.boost = b; for (const mt of boostMats) mt.uniforms.boost.value = b; },
    update(eye) {
      if (!papiMesh) return;
      let i = 0;
      for (const u of papis) { const rd = papiRead(eye, u); this.papiState[u.id] = rd.join(''); for (const c of rd) papiMesh.setColorAt(i++, c === 'W' ? white : red); }
      papiMesh.instanceColor.needsUpdate = true;
    },
  };
  approach.update([0, 1e4, 0]);
  group.userData = { lights: count, piers: piers.length, approach };
  return group;
}

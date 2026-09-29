// M1.2 approach visuals in the world: the glide-slope ribbon (a translucent corridor centred on the ILS path from the
// intercept point to the touchdown zone, toggled with V), the localizer centreline over the water, and the magenta
// route line of AUTO LAND / GUIDE ME on the ground. All unlit, emissive, double-sided; built on demand for the
// planned runway. Title frame: x east, z south, y up; the flight model's NED: n = −z, e = x.
import { BufferGeometry, BufferAttribute, Color, Group, Mesh } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine';
import { gsAltAt, RIBBON } from '../../fdm/route.ts';

const D = Math.PI / 180, NM = 1852;
export { RIBBON };

// the 3° path's centre at `s` m before the threshold (title frame) — the reference the ribbon is built on
export function pathPoint(I, s) { const cn = Math.cos(I.crs * D), ce = Math.sin(I.crs * D), n = I.thrN - cn * s, e = I.thrE - ce * s; return [e, gsAltAt(I, s), -n]; }

// unlit, premultiplied (the engine's translucent effects blend that way; 'normal' blending dropped out of the frame)
const unlit = (name, col, opacity, extra = {}) => new Material({ name, color: new Color(...col), lit: false, transparent: opacity < 1, opacity, side: 'double', depthWrite: true, blending: opacity < 1 ? 'premultiplied' : 'none', ...extra, // depth written: the water and sky passes that follow composite by depth
  // (dimmed at night: the exposure adapts to the dark and an unlit overlay would glare)
  surface: /* wgsl */`let k = mix( 1.0, ${(extra.nightK ?? 0.06).toFixed(3)}, frame.night ); let a = mat.opacity * mix( 1.0, 0.6, frame.night );
	s.emissive = s.albedo * 1.6 * a * k; s.albedo = s.albedo * a * k; s.alpha = a;` });
function mesh(P, I, mat) {
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  const N = new Float32Array(P.length); for (let i = 1; i < N.length; i += 3) N[i] = 1; g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(I), 1));
  const m = new Mesh(g, mat); m.frustumCulled = false; return m;
}

export class ApproachViz {
  constructor(scene, heightAt) { this.scene = scene; this.heightAt = heightAt; this.group = new Group(); this.group.name = 'approach-viz'; scene.add(this.group); this.ribbon = null; this.loc = null; this.route = null; this.key = ''; this.ribbonOn = true; this.offsetM = 0; }

  // ribbon + localizer line for runway `I` and aircraft `ac` from `dFafNm` (built once per runway / aircraft)
  setApproach(I, acId, dFafNm, dJoinNm) {
    const key = `${I.id}|${acId}|${dFafNm}|${this.offsetM}`;
    if (key === this.key) return;
    this.clearApproach(); this.key = key;
    const { halfW, halfH } = RIBBON[acId], cn = Math.cos(I.crs * D), ce = Math.sin(I.crs * D);
    const rx = cn, rz = ce; // right of the course in the title frame: right (NED) = (−ce, cn) → x = cn, z = ce
    // from the glide path's origin on the runway (the touchdown zone) out to the intercept point
    const s0 = -Math.hypot(I.gsN - I.thrN, I.gsE - I.thrE), s1 = dFafNm * NM;
    const P = [], Ix = [], E = [], EI = [], centre = [];
    const step = 150, n = Math.ceil((s1 - s0) / step);
    for (let i = 0; i <= n; i++) {
      const s = Math.min(s1, s0 + i * step), [x, y, z] = pathPoint(I, s);
      const cx = x + rx * this.offsetM, cz = z + rz * this.offsetM; // offsetM: gate fixture (a ribbon moved sideways)
      centre.push([cx, y, cz, s]);
      const o = P.length / 3;
      P.push(cx - rx * halfW, y, cz - rz * halfW, cx + rx * halfW, y, cz + rz * halfW);
      if (i) Ix.push(o - 2, o - 1, o + 1, o - 2, o + 1, o);
      // corridor frames every 600 m: a thin rectangle ±halfW × ±halfH
      if (i % 4 === 0) {
        // a flat strip 2t wide facing the approach: posts widen across the course, cross bars vertically
        const bar = (ax, ay, az, bx, by, bz, t = 1.2) => { const q = E.length / 3, post = by !== ay;
          const ox = post ? rx * t : 0, oy = post ? 0 : t, oz = post ? rz * t : 0;
          E.push(ax - ox, ay - oy, az - oz, bx - ox, by - oy, bz - oz, bx + ox, by + oy, bz + oz, ax + ox, ay + oy, az + oz); EI.push(q, q + 1, q + 2, q, q + 2, q + 3); };
        const L = [cx - rx * halfW, cz - rz * halfW], R = [cx + rx * halfW, cz + rz * halfW];
        bar(L[0], y - halfH, L[1], R[0], y - halfH, R[1]); bar(L[0], y + halfH, L[1], R[0], y + halfH, R[1]);
        bar(L[0], y - halfH, L[1], L[0], y + halfH, L[1]); bar(R[0], y - halfH, R[1], R[0], y + halfH, R[1]);
      }
    }
    this.ribbon = new Group(); this.ribbon.name = 'gs-ribbon';
    this.ribbon.add(mesh(P, Ix, unlit('gs-ribbon', [0.25, 1, 0.55], 0.28)));
    if (E.length) this.ribbon.add(mesh(E, EI, unlit('gs-frames', [0.3, 1, 0.6], 0.75)));
    this.ribbon.userData = { centre, halfW, halfH, rwy: I.id };
    this.ribbon.visible = this.ribbonOn;
    this.group.add(this.ribbon);
    // localizer centreline on the water / ground, threshold → join point
    const LP = [], LI = [], sJ = (dFafNm + dJoinNm) * NM, w = 5;
    for (let i = 0, m = Math.ceil(sJ / 200); i <= m; i++) {
      const s = i * sJ / m, x = I.thrE - ce * s, z = -(I.thrN - cn * s), y = Math.max(this.heightAt(x, z), 0) + 0.6, o = LP.length / 3;
      LP.push(x - rx * w, y, z - rz * w, x + rx * w, y, z + rz * w);
      if (i) LI.push(o - 2, o - 1, o + 1, o - 2, o + 1, o);
    }
    this.loc = mesh(LP, LI, unlit('loc-line', [1, 0.85, 0.3], 0.85, { nightK: 0.25,
      vertex: /* wgsl */`let d = distance( v.position, frame.cameraPos ); v.position.y += min( d * 0.002, 30.0 );` }));
    this.loc.name = 'loc-line';
    this.group.add(this.loc);
  }
  clearApproach() { for (const o of [this.ribbon, this.loc]) if (o) { this.group.remove(o); o.traverse?.((x) => x.geometry?.dispose?.()); } this.ribbon = this.loc = null; this.key = ''; }
  setRibbon(on) { this.ribbonOn = on; if (this.ribbon) this.ribbon.visible = on; }

  // the magenta route line: [n, e, alt] points, drawn on the ground (a wide strip: visible from altitude)
  setRoute(points) {
    if (this.route) { this.group.remove(this.route); this.route.geometry.dispose?.(); this.route = null; }
    if (!points || points.length < 2) return;
    const P = [], I = [], w = 18;
    for (let i = 0; i < points.length; i++) {
      const [n, e] = points[i], [n1, e1] = points[Math.min(i + 1, points.length - 1)], [n0, e0] = points[Math.max(i - 1, 0)];
      const dx = (e1 - e0), dz = -(n1 - n0), L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L;
      const x = e, z = -n, y = Math.max(this.heightAt(x, z), 0) + 1.5, o = P.length / 3;
      P.push(x - px * w, y, z - pz * w, x + px * w, y, z + pz * w);
      if (i) I.push(o - 2, o - 1, o + 1, o - 2, o + 1, o);
    }
    this.route = mesh(P, I, unlit('route-line', [1, 0.25, 0.95], 0.9, { nightK: 0.25,
      vertex: /* wgsl */`let d = distance( v.position, frame.cameraPos ); v.position.y += min( d * 0.003, 60.0 );` }));
    this.route.name = 'route-line';
    this.group.add(this.route);
  }
  hide() { this.clearApproach(); this.setRoute(null); }
}

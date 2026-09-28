// The flyable aircraft as the render layer sees it: the exterior (three LODs) and the cockpit shell, both in the
// model frame of pipelines/aircraft (x starboard, y up, z aft; origin on the ground under the main gear), posed every
// frame from the flight model's render origin and attitude. Reads the Sim; never writes it.
import { loadLodModel } from 'harbor-engine';
import { Vector3, Quaternion, Euler } from 'harbor-engine/src/engine/index.js';

const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';

export class AircraftView {
  static async load(app, index, id) {
    const T = index.types[id], b = base() + 'aircraft/';
    const ext = await loadLodModel(T.lods.map((l) => b + l.name), { lodDistances: index.lodDistances.map((d) => d * (T.lengthM / 73.86) ** 0.8), refFov: index.refFov, name: id });
    const cock = await loadLodModel([b + T.cockpit.name], { lodDistances: [], refFov: 60, name: id + '-cockpit' });
    return new AircraftView(app, T, ext, cock);
  }
  constructor(app, T, ext, cock) {
    this.app = app; this.T = T; this.ext = ext; this.cock = cock;
    app.scene.add(ext); app.scene.add(cock);
    this.gear = []; ext.traverse((o) => { if (/gear_/.test(o.name || '')) this.gear.push(o); });
    this.eye = new Vector3(...T.eye);
    this.pos = new Vector3(); this.q = new Quaternion(); this._e = new Euler();
    this.prev = null; this.cur = null;
    this.fwd = new Vector3(); this.up = new Vector3(); this.right = new Vector3();
  }
  // pose from the Sim (title frame x east, y up, z south), interpolated between the last two steps by `alpha`
  static poseOf(sim, out = {}) {
    const o = sim.renderOrigin(), e = sim.euler;
    out.x = o[1]; out.y = -o[2]; out.z = -o[0]; out.psi = e.psi; out.theta = e.theta; out.phi = e.phi; out.gear = sim.gearPos;
    return out;
  }
  apply(p0, p1, alpha) {
    const L = (a, b) => a + (b - a) * alpha, La = (a, b) => { let d = b - a; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * alpha; };
    const x = L(p0.x, p1.x), y = L(p0.y, p1.y), z = L(p0.z, p1.z), psi = La(p0.psi, p1.psi), th = L(p0.theta, p1.theta), ph = L(p0.phi, p1.phi);
    for (const m of [this.ext, this.cock]) { m.position.set(x, y, z); m.rotation.set(th, -psi, -ph, 'YXZ'); }
    this.pos.set(x, y, z);
    this._e.set(th, -psi, -ph, 'YXZ'); this.q.setFromEuler(this._e);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q); this.up.set(0, 1, 0).applyQuaternion(this.q); this.right.set(1, 0, 0).applyQuaternion(this.q);
    const gv = p1.gear > 0.05; for (const g of this.gear) g.visible = gv;
  }
  update(camera, showCockpit) {
    this.ext.update(camera); this.cock.visible = showCockpit; if (showCockpit) this.cock.update(camera);
  }
  eyeWorld(out) { return out.copy(this.eye).applyQuaternion(this.q).add(this.pos); }
  dispose() { this.app.scene.remove(this.ext); this.app.scene.remove(this.cock); }
}

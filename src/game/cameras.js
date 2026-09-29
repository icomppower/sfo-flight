// Cameras: cockpit (default), chase, tower, free (the engine's fly camera), and the replay director's shots
// (Phase 2's director, cut on the flight's own phases). Every eye stays above the ground and the water.
import { Vector3, Euler, MathUtils } from 'harbor-engine/src/engine/index.js';

export const CAMS = ['cockpit', 'chase', 'tower', 'free'];
export const SHOTS = ['establish', 'chase', 'wing', 'cockpit', 'tower', 'spotter', 'side', 'rollout', 'threshold'];

export class Cameras {
  constructor(app, tower) {
    this.app = app; this.mode = 'cockpit'; this.shot = 'chase';
    this.tower = tower; // [x, y, z] of the tower cab eye
    this.pos = new Vector3(); this.at = new Vector3(); this.sPos = new Vector3(); this.sAt = new Vector3();
    this.look = { yaw: 0, pitch: 0 }; this.last = null; this._e = new Euler(); this.flyYaw = null; this.flyPitch = null; this.spot = null;
  }
  // mouse / touch drag through the engine's fly camera look state
  lookDelta() {
    const fly = this.app.fly;
    if (fly.flight) { fly.flight = null; this.flyYaw = null; }
    if (this.flyYaw === null) { this.flyYaw = fly.yaw; this.flyPitch = fly.pitch; }
    const dy = fly.yaw - this.flyYaw, dp = fly.pitch - this.flyPitch; this.flyYaw = fly.yaw; this.flyPitch = fly.pitch;
    return [dy, dp];
  }
  place(dt, av, sim, name, ground) {
    const app = this.app, cam = app.camera, m = av.pos, f = av.fwd, r = av.right, L = av.T.lengthM;
    const [dy, dp] = this.lookDelta();
    const cut = name !== this.last;
    if (cut) { this.look.yaw = 0; this.look.pitch = 0; } else { this.look.yaw += dy; this.look.pitch = MathUtils.clamp(this.look.pitch + dp, -1.3, 1.3); }
    const pos = this.pos, at = this.at; let fov = 60, tau = 0.25, rigid = false, bankWith = false;
    const flat = new Vector3(f.x, 0, f.z).normalize();
    switch (name) {
      case 'cockpit': av.eyeWorld(pos); at.copy(pos).addScaledVector(f, 100).addScaledVector(av.up, -100 * Math.tan(0.07)); fov = L > 30 ? 62 : 68; rigid = true; bankWith = true; break;
      case 'chase': pos.copy(m).addScaledVector(flat, -L * 2.1).add(new Vector3(0, L * 0.45 + 2, 0)); at.copy(m).addScaledVector(f, L * 1.5).add(new Vector3(0, L * 0.08, 0)); fov = 58; break;
      case 'tower': pos.set(...this.tower); at.copy(m); fov = MathUtils.clamp(4200 / Math.max(200, pos.distanceTo(m)) * (L / 60), 4, 40); tau = 0.4; break;
      case 'establish': pos.copy(m).addScaledVector(flat, -L * 7).addScaledVector(r, L * 3.5).add(new Vector3(0, L * 2.8, 0)); at.copy(m).addScaledVector(f, L * 12); fov = 42; tau = 0.8; break;
      case 'wing': pos.copy(m).addScaledVector(r, L * 0.85).addScaledVector(f, -L * 0.3).add(av.up.clone().multiplyScalar(L * 0.1)); at.copy(m).addScaledVector(f, L * 1.6).addScaledVector(r, -L * 0.14); fov = 50; tau = 0.15; break;
      case 'spotter': case 'side': {
        if (cut || !this.spot) { this.spot = new Vector3().copy(m).addScaledVector(flat, L * (name === 'side' ? 6 : 14)).addScaledVector(new Vector3(-flat.z, 0, flat.x), L * (name === 'side' ? 2.5 : 4)); this.spot.y = Math.max(ground(this.spot.x, this.spot.z), 0) + 2.2; }
        pos.copy(this.spot); at.copy(m); fov = MathUtils.clamp(1900 / Math.max(120, pos.distanceTo(m)) * (L / 60), 18, 55); tau = 0.3; break;
      }
      case 'threshold': {
        // beside the runway just past the threshold, looking back up the approach at the aircraft
        const I = this.thrSpot, D = Math.PI / 180, cn = Math.cos(I.crs * D), ce = Math.sin(I.crs * D);
        const x = I.thrE + ce * 120 - cn * 90, z = -(I.thrN + cn * 120 + ce * 90);
        pos.set(x, Math.max(ground(x, z), 0) + 2.2, z); at.copy(m); fov = MathUtils.clamp(2600 / Math.max(120, pos.distanceTo(m)) * (L / 60), 12, 55); tau = 0.2; break;
      }
      case 'rollout': pos.copy(m).addScaledVector(flat, -L * 1.2).addScaledVector(r, L * 1.1).add(new Vector3(0, L * 0.35, 0)); at.copy(m).addScaledVector(f, L * 0.4); fov = 50; break;
    }
    const gy = Math.max(ground(pos.x, pos.z), 0) + (name === 'cockpit' ? -1e9 : 1.5);
    if (pos.y < gy) pos.y = gy;
    if (cut || rigid) { this.sPos.copy(pos); this.sAt.copy(at); }
    else { const k = 1 - Math.exp(-dt / tau); this.sPos.lerp(pos, k); this.sAt.lerp(at, k); }
    cam.position.copy(this.sPos); cam.up.set(0, 1, 0);
    if (bankWith) { cam.up.copy(av.up); }
    cam.lookAt(this.sAt);
    if (this.look.yaw || this.look.pitch) { this._e.setFromQuaternion(cam.quaternion, 'YXZ'); this._e.y += this.look.yaw; this._e.x = MathUtils.clamp(this._e.x + this.look.pitch, -1.5, 1.5); cam.rotation.copy(this._e); }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.last = name;
  }
  // AUTO LAND's director: wide over the bay, chase and wing far out, the flight deck on short final, a spotter at the
  // threshold for the last 200 ft, the rollout on the ground (C hands the camera back)
  directAuto(sim, t, A) {
    const I = A.rwy; if (!I) return 'chase';
    const dNm = Math.hypot(sim.pos[0] - I.thrN, sim.pos[1] - I.thrE) / 1852, ra = sim.agl / 0.3048;
    if (sim.onGround) return sim.gs < 12 ? 'chase' : 'rollout';
    if (A.g?.onFinal && ra < 200 && dNm < 1.5) { this.thrSpot = I; return 'threshold'; }
    if (A.g?.onFinal && dNm < 4) return 'cockpit';
    const cyc = ['establish', 'chase', 'wing', 'chase'];
    return cyc[Math.floor(t / 12) % cyc.length];
  }
  // replay director: a shot for the flight phase, re-cut every ~12 s in cruise
  direct(sim, t, nearRwy) {
    const agl = sim.agl, gs = sim.gs;
    if (sim.onGround && gs < 12) return 'chase';
    if (sim.onGround) return sim.touchdowns.length ? 'rollout' : 'side';
    if (nearRwy && agl < 250 && sim.vel[2] > 0) return 'spotter';
    if (nearRwy && agl < 1200 && sim.vel[2] > 0) return 'tower';
    if (agl < 150 && sim.vel[2] < 0) return 'chase';
    const cyc = ['establish', 'chase', 'wing', 'cockpit'];
    return cyc[Math.floor(t / 12) % cyc.length];
  }
}

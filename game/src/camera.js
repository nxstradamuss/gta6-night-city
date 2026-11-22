// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Chase camera with speed-dependent framing, plus a fixed pose for stills.

import {
  m4, m4lookAt, m4mul, m4perspective, clamp, damp, v3cross, v3norm, v3sub,
} from './math.js';
import { CONFIG } from './config.js';

// The rig geometry lives in CONFIG so the world tuning reads in one place.
const CAM = CONFIG.camera;

// Where the camera aims: the lead runs further down the road as speed builds, so
// at 200 km/h the player looks at the next junction. Short at rest.
const LOOK_AHEAD = { base: 9, perSpeed: 0.2, max: 22 };

export class Camera {
  constructor() {
    this.eye = [0, 4, 12];
    this.target = [0, 1, 0];
    this.fov = (62 * Math.PI) / 180;
    this.aspect = 16 / 9;
    this.view = m4();
    this.proj = m4();
    this.vp = m4();
    this.forward = [0, 0, -1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this._t = 0;
  }

  setPose(eye, target, fovDeg) {
    this.eye = [eye[0], eye[1], eye[2]];
    this.target = [target[0], target[1], target[2]];
    if (fovDeg) this.fov = (fovDeg * Math.PI) / 180;
    this.compute();
  }

  snapTo(car) {
    const f = car.forward();
    this.eye = [car.pos[0] - f[0] * CAM.backDistance, CAM.height, car.pos[2] - f[2] * CAM.backDistance];
    this.target = [car.pos[0] + f[0] * 8, 1.45, car.pos[2] + f[2] * 8];
    this.compute();
  }

  chase(dt, car) {
    this._t += dt;
    const f = car.forward();
    const sp = clamp(car.speed, 0, 52);
    const dist = CAM.backDistance + sp * CAM.backPerSpeed;
    const height = CAM.height + sp * CAM.heightPerSpeed;
    const eyeX = car.pos[0] - f[0] * dist;
    const eyeZ = car.pos[2] - f[2] * dist;
    const k = 4.8;
    this.eye[0] = damp(this.eye[0], eyeX, k, dt);
    this.eye[1] = damp(this.eye[1], height, k * 0.8, dt);
    this.eye[2] = damp(this.eye[2], eyeZ, k, dt);

    // Lead the car: the faster it goes, the further ahead the camera looks. The
    // eye keeps its distance, only the aim point moves out.
    const lead = Math.min(LOOK_AHEAD.max, LOOK_AHEAD.base + sp * LOOK_AHEAD.perSpeed);
    const lookX = car.pos[0] + f[0] * lead;
    const lookZ = car.pos[2] + f[2] * lead;
    this.target[0] = damp(this.target[0], lookX, 7, dt);
    this.target[1] = damp(this.target[1], 1.5, 6, dt);
    this.target[2] = damp(this.target[2], lookZ, 7, dt);

    if (car.shake > 0.02) {
      const s = car.shake * 0.35;
      this.eye[0] += Math.sin(this._t * 61) * s;
      this.eye[1] += Math.sin(this._t * 73) * s;
    }
    this.compute();
  }

  compute() {
    m4lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    m4perspective(this.proj, this.fov, this.aspect, CAM.near, CAM.drawDistance);
    m4mul(this.vp, this.proj, this.view);
    const f = v3norm(v3sub(this.target, this.eye));
    this.forward = f;
    this.right = v3norm(v3cross(f, [0, 1, 0]));
    this.up = v3cross(this.right, f);
  }
}

// Player car: arcade driving physics (forward/lateral velocity split, grip,
// handbrake drift) and the renderer that draws the body, glass, wheels,
// emissive lamps, volumetric headlight cones and the light pools they cast.

import { CONFIG } from './config.js';
import { LOC, createProgram, makeMesh, drawMesh } from './gl.js';
import {
  TAU, clamp, damp, wrapAngle, m4, m4mul, m4trs, m4translate, m4rotY,
} from './math.js';
import { resolveCollisions } from './city.js';

// ------------------------------------------------------------- physics ----

export class Car {
  constructor({ x = 0, z = 0, heading = 0, paint, police = false }) {
    this.pos = [x, 0, z];
    this.vel = [0, 0, 0];
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.roll = 0;
    this.pitch = 0;
    this.wheelSpin = 0;
    this.health = 100;
    this.brake = 0;
    this.shake = 0;
    this.paint = paint ?? [0.72, 0.06, 0.16];
    this.police = police;
    this.siren = 0;
    this.lightsOn = true;
  }

  forward() {
    return [Math.sin(this.heading), 0, Math.cos(this.heading)];
  }

  reset(x, z, heading) {
    this.pos = [x, 0, z];
    this.vel = [0, 0, 0];
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.roll = 0;
    this.pitch = 0;
    this.health = 100;
  }

  update(dt, controls, city) {
    const c = CONFIG.car;
    const throttle = clamp(controls.throttle ?? 0, -1, 1);

    let fwd = this.forward();
    let right = [fwd[2], 0, -fwd[0]];
    let fs = this.vel[0] * fwd[0] + this.vel[2] * fwd[2];
    let ls = this.vel[0] * right[0] + this.vel[2] * right[2];

    if (throttle > 0) {
      fs += c.accel * (1 - clamp(fs / c.maxSpeed, 0, 1)) * throttle * dt;
    } else if (throttle < 0) {
      if (fs > 0.4) fs -= 24 * dt; // brake
      else fs += c.reverseAccel * throttle * (1 - clamp(-fs / c.maxReverse, 0, 1)) * dt;
    }

    fs -= fs * c.drag * dt;
    const rr = c.rollResist * dt;
    if (Math.abs(fs) < rr) fs = 0;
    else fs -= Math.sign(fs) * rr;

    const grip = controls.handbrake ? c.handbrakeGrip : c.grip;
    ls *= Math.exp(-grip * dt);

    const speedFactor = clamp(Math.abs(fs) / 7, 0, 1);
    const dirSign = fs >= 0 ? 1 : -1;
    this.steer = damp(this.steer, clamp(controls.steer ?? 0, -1, 1), 11, dt);
    const yawRate = this.steer * c.steerRate * speedFactor * dirSign * (controls.handbrake ? 1.5 : 1);
    this.heading = wrapAngle(this.heading + yawRate * dt);

    fwd = this.forward();
    right = [fwd[2], 0, -fwd[0]];
    this.vel[0] = fwd[0] * fs + right[0] * ls;
    this.vel[2] = fwd[2] * fs + right[2] * ls;

    this.pos[0] += this.vel[0] * dt;
    this.pos[2] += this.vel[2] * dt;

    // Buildings block the car.
    const res = resolveCollisions(city.buildings, this.pos, c.radius);
    if (res.hit) {
      this.pos[0] = res.x;
      this.pos[2] = res.z;
      const into = this.vel[0] * res.nx + this.vel[2] * res.nz;
      if (into < 0) {
        this.vel[0] -= res.nx * into * 1.35;
        this.vel[2] -= res.nz * into * 1.35;
        const impact = Math.min(1, Math.abs(into) / 20);
        this.health = Math.max(0, this.health - impact * 24);
        this.shake = Math.max(this.shake, impact);
        fs *= 0.5;
      }
    }

    // Keep the car inside the generated district.
    const limit = CONFIG.radius * CONFIG.block + 8;
    this.pos[0] = clamp(this.pos[0], -limit, limit);
    this.pos[2] = clamp(this.pos[2], -limit, limit);

    this.speed = Math.hypot(this.vel[0], this.vel[2]);
    this.roll = damp(this.roll, clamp(-yawRate * fs * 0.0075, -0.17, 0.17), 7, dt);
    this.pitch = damp(this.pitch, clamp(throttle * -0.035 * clamp(fs / 18, 0, 1), -0.05, 0.05), 5, dt);
    this.brake = throttle < 0 && fs > 1 ? 1 : 0;
    this.wheelSpin += fs * dt * 1.6;
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  updateAI(dt, target, city) {
    const dx = target.pos[0] - this.pos[0];
    const dz = target.pos[2] - this.pos[2];
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const diff = wrapAngle(want - this.heading);
    const steer = clamp(diff * 1.9, -1, 1);
    const throttle = dist > 8 ? 1 : dist < 4.5 ? -0.5 : 0.3;
    this.update(dt, { throttle, steer, handbrake: false }, city);
    this.siren += dt;
  }
}

// ------------------------------------------------------------ geometry ----

const FACES = [
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

function pushBox(P, N, PT, I, cx, cy, cz, sx, sy, sz, part) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  for (const f of FACES) {
    const base = P.length / 3;
    for (const v of f.v) {
      P.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz);
      N.push(f.n[0], f.n[1], f.n[2]);
      PT.push(part);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function pushWheel(P, N, PT, I, cx, cy, cz, radius, halfWidth, part, segs = 12) {
  const base = P.length / 3;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    const y = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    const ny = Math.sin(a);
    const nz = Math.cos(a);
    P.push(cx - halfWidth, cy + y, cz + z);
    N.push(0, ny, nz);
    PT.push(part);
    P.push(cx + halfWidth, cy + y, cz + z);
    N.push(0, ny, nz);
    PT.push(part);
  }
  for (let i = 0; i < segs; i++) {
    const a0 = base + i * 2;
    I.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
  }
  // Flat caps so the wheel does not look hollow from the side.
  for (const s of [-1, 1]) {
    const cIdx = P.length / 3;
    P.push(cx + s * halfWidth, cy, cz);
    N.push(s, 0, 0);
    PT.push(part);
    const ring = P.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      P.push(cx + s * halfWidth, cy + Math.sin(a) * radius, cz + Math.cos(a) * radius);
      N.push(s, 0, 0);
      PT.push(part);
    }
    for (let i = 0; i < segs; i++) {
      if (s > 0) I.push(cIdx, ring + i + 1, ring + i);
      else I.push(cIdx, ring + i, ring + i + 1);
    }
  }
}

// A box whose top face can be pulled in on either axis. Straight boxes read as
// bricks; what makes a shape read as a car is the shoulder line that tapers in
// toward the roof and the nose that narrows ahead of the windscreen.
function pushTaperBox(P, N, PT, I, cx, cy, cz, sx, sy, sz, part, topX = 1, topZ = 1) {
  const bx = sx / 2, bz = sz / 2, hy = sy / 2;
  const tx = bx * topX, tz = bz * topZ;
  const faces = [
    [[bx, -1, bz], [bx, -1, -bz], [tx, 1, -tz], [tx, 1, tz]],
    [[-bx, -1, -bz], [-bx, -1, bz], [-tx, 1, tz], [-tx, 1, -tz]],
    [[-bx, -1, bz], [bx, -1, bz], [tx, 1, tz], [-tx, 1, tz]],
    [[bx, -1, -bz], [-bx, -1, -bz], [-tx, 1, -tz], [tx, 1, -tz]],
    [[-tx, 1, tz], [tx, 1, tz], [tx, 1, -tz], [-tx, 1, -tz]],
    [[-bx, -1, -bz], [bx, -1, -bz], [bx, -1, bz], [-bx, -1, bz]],
  ];
  for (const f of faces) {
    const base = P.length / 3;
    const wp = f.map(([ux, uy, uz]) => [cx + ux, cy + uy * hy, cz + uz]);
    for (const v of wp) P.push(v[0], v[1], v[2]);
    const ax = wp[1][0] - wp[0][0], ay = wp[1][1] - wp[0][1], az = wp[1][2] - wp[0][2];
    const bx2 = wp[2][0] - wp[0][0], by2 = wp[2][1] - wp[0][1], bz2 = wp[2][2] - wp[0][2];
    let nx = ay * bz2 - az * by2;
    let ny = az * bx2 - ax * bz2;
    let nz = ax * by2 - ay * bx2;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 4; k++) { N.push(nx, ny, nz); PT.push(part); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// The car is assembled from primitives rather than loaded from a mesh, so every
// shape here has to earn its vertices: the body is tapered so the shoulder line
// pulls in toward the roof, and the small parts (mirrors, arch flares, plates,
// exhausts) are what stop it reading as a stack of boxes at chase distance.
function buildCarGeometry(police) {
  const P = [], N = [], PT = [], I = [];
  const BODY = 0, GLASS = 1, WHEEL = 2, HEAD = 3, TAIL = 4, TRIM = 5, RED = 6, BLUE = 7;

  pushTaperBox(P, N, PT, I, 0, 0.62, 0, 1.92, 0.46, 4.30, BODY, 0.97, 0.99);
  pushTaperBox(P, N, PT, I, 0, 0.93, 0, 1.80, 0.34, 4.06, BODY, 0.95, 0.98);
  pushTaperBox(P, N, PT, I, 0, 1.10, 1.25, 1.72, 0.26, 1.55, BODY, 0.90, 0.86);
  pushTaperBox(P, N, PT, I, 0, 1.08, -1.55, 1.74, 0.30, 1.00, BODY, 0.94, 0.92);
  pushTaperBox(P, N, PT, I, 0, 1.32, -0.15, 1.58, 0.52, 1.90, GLASS, 0.84, 0.80);
  pushTaperBox(P, N, PT, I, 0, 1.58, -0.20, 1.44, 0.10, 1.52, BODY, 0.93, 0.94);
  pushBox(P, N, PT, I, 0, 0.62, 2.20, 1.96, 0.22, 0.30, TRIM);
  pushBox(P, N, PT, I, 0, 0.62, -2.20, 1.96, 0.22, 0.30, TRIM);
  pushBox(P, N, PT, I, -0.96, 0.45, 0, 0.10, 0.14, 3.30, TRIM);
  pushBox(P, N, PT, I, 0.96, 0.45, 0, 0.10, 0.14, 3.30, TRIM);
  pushBox(P, N, PT, I, 0, 1.36, -2.05, 1.50, 0.07, 0.40, BODY);
  pushBox(P, N, PT, I, -0.60, 1.22, -2.05, 0.08, 0.26, 0.08, TRIM);
  pushBox(P, N, PT, I, 0.60, 1.22, -2.05, 0.08, 0.26, 0.08, TRIM);
  pushBox(P, N, PT, I, 0, 0.86, 2.17, 0.92, 0.18, 0.08, TRIM);

  for (const sx of [-0.62, 0.62]) {
    pushBox(P, N, PT, I, sx, 1.02, 2.16, 0.42, 0.16, 0.10, HEAD);
    pushBox(P, N, PT, I, sx, 1.04, -2.16, 0.46, 0.14, 0.10, TAIL);
  }

  // The small parts that separate a car from a wedge on wheels: door mirrors,
  // arch flares over each wheel, plates, exhaust tips, grille bars and wipers.
  for (const sx of [-1, 1]) {
    pushTaperBox(P, N, PT, I, sx * 0.90, 1.26, 0.72, 0.24, 0.11, 0.17, TRIM, 0.7, 0.8);
    pushBox(P, N, PT, I, sx * 0.98, 0.62, 1.42, 0.10, 0.30, 0.62, TRIM);
    pushBox(P, N, PT, I, sx * 0.98, 0.62, -1.42, 0.10, 0.30, 0.62, TRIM);
    pushBox(P, N, PT, I, sx * 0.55, 0.36, -2.24, 0.16, 0.10, 0.10, TRIM);
    pushBox(P, N, PT, I, sx * 0.72, 1.14, 2.12, 0.30, 0.05, 0.06, TRIM);
  }
  pushBox(P, N, PT, I, 0, 0.72, 2.26, 0.62, 0.15, 0.04, TRIM);
  pushBox(P, N, PT, I, 0, 0.72, -2.26, 0.58, 0.15, 0.04, TRIM);
  for (let i = -1; i <= 1; i++) {
    pushBox(P, N, PT, I, i * 0.26, 0.92, 2.20, 0.10, 0.05, 0.06, TRIM);
  }
  pushBox(P, N, PT, I, -0.30, 1.50, 0.86, 0.62, 0.03, 0.05, TRIM);

  for (const wx of [-0.93, 0.93]) {
    for (const wz of [-1.42, 1.42]) {
      pushWheel(P, N, PT, I, wx, 0.40, wz, 0.40, 0.17, WHEEL);
    }
  }

  if (police) {
    pushBox(P, N, PT, I, -0.25, 1.72, -0.25, 0.44, 0.15, 0.30, RED);
    pushBox(P, N, PT, I, 0.25, 1.72, -0.25, 0.44, 0.15, 0.30, BLUE);
  }

  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    parts: new Float32Array(PT),
    indices: new Uint16Array(I),
  };
}

// A hollow cone from the headlamps: cheap stand-in for volumetric light.
function buildConeGeometry() {
  const P = [], N = [], T = [], I = [];
  const segs = 20;
  const apex = [0, 0.98, 2.10];
  const end = [0, -0.85, 21.0];
  const radius = 5.6;
  const dir = [end[0] - apex[0], end[1] - apex[1], end[2] - apex[2]];
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;

  const base = P.length / 3;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Two rings: a small one at the lamp, the wide one far ahead.
    for (let r = 0; r < 2; r++) {
      const t = r === 0 ? 0.02 : 1;
      const cx = apex[0] + dir[0] * dl * t;
      const cy = apex[1] + dir[1] * dl * t;
      const cz = apex[2] + dir[2] * dl * t;
      const rad = radius * t;
      P.push(cx + ca * rad, cy + sa * rad, cz);
      N.push(ca, sa, 0);
      T.push(t);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a0 = base + i * 2;
    I.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
  }
  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    t: new Float32Array(T),
    indices: new Uint16Array(I),
  };
}

// ------------------------------------------------------------ shaders -----

const CAR_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=3) in float aPart;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vWorld;
out vec3 vNormal;
out float vPart;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vPart = aPart;
  gl_Position = uVP * world;
}`;

const CAR_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vPart;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform vec3 uPaint;
uniform float uRed;
uniform float uBlue;
uniform float uBrake;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  int part = int(vPart + 0.5);
  vec3 col;

  if (part == 0) {
    vec3 L1 = normalize(vec3(0.35, 0.78, 0.42));
    vec3 L2 = normalize(vec3(-0.55, 0.40, -0.62));
    float d1 = max(dot(N, L1), 0.0);
    float d2 = max(dot(N, L2), 0.0);
    vec3 H1 = normalize(V + L1);
    float spec = pow(max(dot(N, H1), 0.0), 110.0);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.5);
    col = uPaint * (0.10 + 0.50 * d1 + 0.20 * d2);
    col += vec3(0.85, 0.92, 1.0) * spec * 1.7;
    col += vec3(0.38, 0.22, 0.62) * fres * 0.55;
    col += uPaint * pow(max(dot(N, normalize(vec3(-0.9, 0.3, -0.3))), 0.0), 3.0) * 0.35;
  } else if (part == 1) {
    float f = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col = vec3(0.012, 0.017, 0.034) + vec3(0.10, 0.17, 0.32) * f;
  } else if (part == 2) {
    col = vec3(0.018, 0.018, 0.022);
    col += vec3(0.055) * max(dot(N, normalize(vec3(0.3, 0.9, 0.3))), 0.0);
  } else if (part == 3) {
    col = vec3(7.2, 6.4, 4.6);
  } else if (part == 4) {
    col = vec3(5.0, 0.28, 0.16) * (0.55 + uBrake * 0.9);
  } else if (part == 5) {
    col = vec3(0.045, 0.045, 0.055) + vec3(0.40) * pow(max(dot(N, V), 0.0), 9.0);
  } else if (part == 6) {
    col = vec3(6.5, 0.12, 0.12) * uRed;
  } else {
    col = vec3(0.12, 0.35, 6.5) * uBlue;
  }

  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.9);
  fragColor = vec4(col, 1.0);
}`;

const CONE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aT;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec3 uOffset;
out vec3 vNormal;
out vec3 vWorld;
out float vT;
void main() {
  vec4 world = uModel * vec4(aPos + uOffset, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vT = aT;
  gl_Position = uVP * world;
}`;

const CONE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in float vT;
uniform vec3 uCam;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  vec3 V = normalize(uCam - vWorld);
  vec3 N = normalize(vNormal);
  float fres = 1.0 - abs(dot(N, V));
  float fade = pow(1.0 - vT, 1.7);
  float a = (0.12 + 0.88 * fres) * fade * 0.14;
  fragColor = vec4(uColor * a, 1.0);
}`;

const DECAL_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP;
uniform mat4 uModel;
out vec2 vUv;
void main() {
  vUv = aPos + 0.5;
  gl_Position = uVP * uModel * vec4(aPos.x, 0.0, aPos.y, 1.0);
}`;

const DECAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSoft;
out vec4 fragColor;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = smoothstep(1.0, uSoft, d) * uAlpha;
  fragColor = vec4(uColor * a, a);
}`;

// ----------------------------------------------------------- renderer -----

const _model = m4();
const _flat = m4();
const _tmp = m4();

export class CarRenderer {
  constructor(gl) {
    this.gl = gl;
    const civil = buildCarGeometry(false);
    const police = buildCarGeometry(true);

    const make = (g) => makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: g.positions },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: g.normals },
        { name: 'aPart', loc: LOC.part, size: 1, data: g.parts },
      ],
      indices: g.indices,
    });
    this.civilMesh = make(civil);
    this.policeMesh = make(police);

    const cone = buildConeGeometry();
    this.coneMesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: cone.positions },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: cone.normals },
        { name: 'aT', loc: LOC.uv, size: 1, data: cone.t },
      ],
      indices: cone.indices,
    });

    const quad = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
    this.quad = makeMesh(gl, { attributes: [{ name: 'aPos', loc: LOC.pos, size: 2, data: quad }] });

    this.carProg = createProgram(gl, CAR_VS, CAR_FS, { aPos: LOC.pos, aNormal: LOC.normal, aPart: LOC.part });
    this.coneProg = createProgram(gl, CONE_VS, CONE_FS, { aPos: LOC.pos, aNormal: LOC.normal, aT: LOC.uv });
    this.decalProg = createProgram(gl, DECAL_VS, DECAL_FS, { aPos: LOC.pos });
  }

  // Model matrix for a car, including body roll and squat.
  modelFor(car, out = _model) {
    m4trs(out, [car.pos[0], 0, car.pos[2]], car.heading, car.pitch, car.roll);
    return out;
  }

  draw(cars, cam, vp, time, glows) {
    const gl = this.gl;
    gl.disable(gl.CULL_FACE);

    // Soft contact shadows first so they sit on the asphalt.
    this._drawShadows(cars, cam, vp);

    this.carProg.use();
    gl.uniformMatrix4fv(this.carProg.u('uVP'), false, vp);
    gl.uniform3fv(this.carProg.u('uCam'), cam.eye);
    gl.uniform3fv(this.carProg.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(this.carProg.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);

    for (const car of cars) {
      const model = this.modelFor(car);
      gl.uniformMatrix4fv(this.carProg.u('uModel'), false, model);
      gl.uniform3fv(this.carProg.u('uPaint'), car.paint);
      gl.uniform1f(this.carProg.u('uBrake'), car.brake);
      if (car.police) {
        const pulse = Math.sin(time * 7.5 + car.siren);
        gl.uniform1f(this.carProg.u('uRed'), 0.25 + 0.75 * Math.max(0, pulse));
        gl.uniform1f(this.carProg.u('uBlue'), 0.25 + 0.75 * Math.max(0, -pulse));
      } else {
        gl.uniform1f(this.carProg.u('uRed'), 0);
        gl.uniform1f(this.carProg.u('uBlue'), 0);
      }
      drawMesh(gl, car.police ? this.policeMesh : this.civilMesh);
    }

    this._drawCones(cars, cam, vp);
    this._drawPools(cars, vp);
    this._addLampGlows(cars, glows, time);
  }

  _drawShadows(cars, cam, vp) {
    const gl = this.gl;
    this.decalProg.use();
    gl.uniformMatrix4fv(this.decalProg.u('uVP'), false, vp);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform3f(this.decalProg.u('uColor'), 0, 0, 0);
    gl.uniform1f(this.decalProg.u('uAlpha'), 0.55);
    gl.uniform1f(this.decalProg.u('uSoft'), 0.15);
    for (const car of cars) {
      m4translate(_flat, car.pos[0], 0.02, car.pos[2]);
      m4rotY(_tmp, car.heading);
      m4mul(_flat, _flat, _tmp);
      m4translate(_tmp, 0, 0, 0);
      // Scale the quad to the footprint.
      const s = m4();
      s[0] = 2.9; s[5] = 1; s[10] = 5.4;
      m4mul(_flat, _flat, s);
      gl.uniformMatrix4fv(this.decalProg.u('uModel'), false, _flat);
      drawMesh(gl, this.quad);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawPools(cars, vp) {
    const gl = this.gl;
    this.decalProg.use();
    gl.uniformMatrix4fv(this.decalProg.u('uVP'), false, vp);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);

    for (const car of cars) {
      if (!car.lightsOn) continue;
      m4translate(_flat, car.pos[0], 0.03, car.pos[2]);
      m4rotY(_tmp, car.heading);
      m4mul(_flat, _flat, _tmp);
      // Headlight pool stretching ahead of the nose.
      const ahead = m4();
      ahead[0] = 11; ahead[10] = 24; ahead[14] = 12.5;
      m4mul(_flat, _flat, ahead);
      gl.uniformMatrix4fv(this.decalProg.u('uModel'), false, _flat);
      gl.uniform3f(this.decalProg.u('uColor'), 1.0, 0.86, 0.60);
      gl.uniform1f(this.decalProg.u('uAlpha'), 0.34);
      gl.uniform1f(this.decalProg.u('uSoft'), 0.0);
      drawMesh(gl, this.quad);

      // Cool underglow puddle under the car.
      m4translate(_flat, car.pos[0], 0.035, car.pos[2]);
      m4mul(_flat, _flat, _tmp);
      const under = m4();
      under[0] = 3.4; under[10] = 5.6;
      m4mul(_flat, _flat, under);
      gl.uniformMatrix4fv(this.decalProg.u('uModel'), false, _flat);
      gl.uniform3f(this.decalProg.u('uColor'), 0.18, 0.55, 0.95);
      gl.uniform1f(this.decalProg.u('uAlpha'), 0.30);
      drawMesh(gl, this.quad);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawCones(cars, cam, vp) {
    const gl = this.gl;
    this.coneProg.use();
    gl.uniformMatrix4fv(this.coneProg.u('uVP'), false, vp);
    gl.uniform3fv(this.coneProg.u('uCam'), cam.eye);
    gl.uniform3f(this.coneProg.u('uColor'), 1.0, 0.88, 0.66);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    for (const car of cars) {
      if (!car.lightsOn) continue;
      const model = this.modelFor(car, _flat);
      gl.uniformMatrix4fv(this.coneProg.u('uModel'), false, model);
      for (const sx of [-0.62, 0.62]) {
        gl.uniform3f(this.coneProg.u('uOffset'), sx, 0, 0);
        drawMesh(gl, this.coneMesh);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _addLampGlows(cars, glows, time) {
    for (const car of cars) {
      const fwd = car.forward();
      const right = [fwd[2], 0, -fwd[0]];
      for (const sx of [-0.62, 0.62]) {
        if (car.lightsOn) {
          const hx = car.pos[0] + fwd[0] * 2.2 + right[0] * sx;
          const hz = car.pos[2] + fwd[2] * 2.2 + right[2] * sx;
          glows.add(hx, 1.02, hz, 1.5, [1.0, 0.92, 0.75], 0.85);
        }
        const tx = car.pos[0] - fwd[0] * 2.2 + right[0] * sx;
        const tz = car.pos[2] - fwd[2] * 2.2 + right[2] * sx;
        glows.add(tx, 1.05, tz, 1.1, [1.0, 0.12, 0.08], 0.55 + car.brake * 0.4);
      }
      if (car.police) {
        const pulse = Math.sin(time * 7.5 + car.siren);
        const rx = car.pos[0] - fwd[0] * 0.3 + right[0] * -0.25;
        const rz = car.pos[2] - fwd[2] * 0.3 + right[2] * -0.25;
        const bx = car.pos[0] - fwd[0] * 0.3 + right[0] * 0.25;
        const bz = car.pos[2] - fwd[2] * 0.3 + right[2] * 0.25;
        glows.add(rx, 1.8, rz, 2.4, [1.0, 0.10, 0.10], 0.55 + 0.45 * Math.max(0, pulse));
        glows.add(bx, 1.8, bz, 2.4, [0.15, 0.35, 1.0], 0.55 + 0.45 * Math.max(0, -pulse));
      }
    }
  }
}

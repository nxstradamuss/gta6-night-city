// Pedestrians: one box mesh per instance, walk cycle in the vertex shader.

import { CONFIG } from './config.js';
import { LOC, createProgram, makeMesh, drawMesh } from './gl.js';

// Instance record: pos(3) yaw(1) tint(3) phase(1).
const INSTANCE_FLOATS = 8;
const STRIDE_BYTES = INSTANCE_FLOATS * 4;
const ATTRS = ['iPos', 'iYaw', 'iTint', 'iPhase'];

const PED_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=3) in float aPart;
layout(location=4) in vec3 iPos;
layout(location=5) in float iYaw;
layout(location=6) in vec3 iTint;
layout(location=7) in float iPhase;
uniform mat4 uVP;
out vec3 vWorld;
out vec3 vNormal;
out float vPart;
out vec3 vTint;

// Swing a vertex and its normal about a horizontal joint at height pivot.
void joint(inout vec3 p, inout vec3 n, float pivot, float a) {
  p.y -= pivot;
  float c = cos(a), s = sin(a);
  p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  n = vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
  p.y += pivot;
}

void main() {
  vec3 p = aPos;
  vec3 n = aNormal;
  float ph = iPhase;
  // Parts 1, 2 and 5 are the left side; 3, 4 and 6 are the right.
  float side = (aPart < 2.5 || (aPart > 4.5 && aPart < 5.5)) ? 1.0 : -1.0;
  if (aPart > 0.5 && aPart < 4.5) {
    // Shin folds at the knee first, then the leg swings at the hip.
    bool shin = (aPart > 1.5 && aPart < 2.5) || aPart > 3.5;
    if (shin) joint(p, n, 0.48, max(0.0, sin(ph + 0.9) * side) * 1.05);
    joint(p, n, 0.94, sin(ph) * 0.55 * side);
  } else if (aPart > 4.5 && aPart < 6.5) {
    // Arms run counter-phase to the leg on the same side.
    joint(p, n, 1.42, -sin(ph) * 0.46 * side);
  }
  // Bob twice per stride, never dipping below the pavement.
  p.y += 0.03 * (0.5 + 0.5 * sin(2.0 * ph));
  float c = cos(iYaw), s = sin(iYaw);
  vec3 wp = iPos + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vWorld = wp;
  vNormal = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vPart = aPart;
  vTint = iTint;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const PED_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vPart;
in vec3 vTint;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  // Lit rather than glowing; a little neon bounce keeps people readable.
  float d = max(dot(N, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  vec3 col = vec3(0.05, 0.055, 0.07) + vec3(0.34, 0.30, 0.40) * d;
  col += vec3(0.30, 0.16, 0.42) * rim;
  col *= vTint;
  if (vPart > 6.5) col = mix(col, vec3(0.62, 0.46, 0.38), 0.75);
  float fog = clamp((length(vWorld - uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  fragColor = vec4(mix(col, uFogColor, fog * fog * 0.9), 1.0);
}`;

// One box as six quads, tagged by limb, generated per axis so winding is outward.
function box(out, cx, cy, cz, sx, sy, sz, part) {
  const h = [sx / 2, sy / 2, sz / 2];
  const c = [cx, cy, cz];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [1, -1]) {
      const n = [0, 0, 0];
      n[a] = s;
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (s < 0) quad.reverse();
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = [c[0], c[1], c[2]];
        p[a] += s * h[a];
        p[u] += quad[k][0] * h[u];
        p[v] += quad[k][1] * h[v];
        out.pos.push(p[0], p[1], p[2]);
        out.nrm.push(n[0], n[1], n[2]);
        out.part.push(part);
      }
    }
  }
}

// Eleven boxes: thighs, shins, feet, torso, arms, head. Only the limbs move.
function buildPedMesh() {
  const out = { pos: [], nrm: [], part: [] };
  for (const [x, thigh, shin] of [[-0.11, 1, 2], [0.11, 3, 4]]) {
    box(out, x, 0.71, 0, 0.16, 0.46, 0.19, thigh);
    box(out, x, 0.27, 0, 0.14, 0.42, 0.17, shin);
    box(out, x, 0.05, 0.05, 0.15, 0.09, 0.26, shin);
  }
  // Shoulders wider than the hips: what reads as a person at forty metres.
  box(out, 0, 1.20, 0, 0.46, 0.52, 0.26, 0);
  box(out, -0.30, 1.16, 0, 0.13, 0.52, 0.16, 5);
  box(out, 0.30, 1.16, 0, 0.13, 0.52, 0.16, 6);
  box(out, 0, 1.59, 0, 0.20, 0.26, 0.21, 7);
  return {
    pos: new Float32Array(out.pos),
    nrm: new Float32Array(out.nrm),
    part: new Float32Array(out.part),
  };
}

const COATS = [
  [0.92, 0.28, 0.34], [0.30, 0.55, 0.95], [0.90, 0.86, 0.55], [0.55, 0.30, 0.72],
  [0.35, 0.78, 0.62], [0.88, 0.88, 0.92], [0.95, 0.60, 0.25],
];

export class Pedestrians {
  constructor(gl, rng, count = 64) {
    this.gl = gl;
    this.prog = createProgram(gl, PED_VS, PED_FS, {
      aPos: LOC.pos, aNormal: LOC.normal, aPart: LOC.part,
      iPos: LOC.ipos, iYaw: LOC.isize, iTint: LOC.icolor, iPhase: LOC.iparam,
    });

    const geo = buildPedMesh();
    this.peds = [];
    this.walk = CONFIG.roadWidth / 2 + CONFIG.sidewalk / 2;
    this.B = CONFIG.block;
    this.rng = rng;

    for (let i = 0; i < count; i++) {
      const p = {
        x: 0, z: 0, axisZ: true, dir: 1,
        // Speed and stride vary independently; cadence follows from the two.
        speed: 0.85 + rng.next() * 1.05,
        stride: 0.62 + rng.next() * 0.22,
        phase: rng.next() * Math.PI * 2,
        tint: COATS[(rng.next() * COATS.length) | 0],
        // A little lateral wobble keeps a column of walkers out of file.
        drift: (rng.next() - 0.5) * 1.1,
      };
      this.respawn(p, rng.float(-1, 1) * 60, rng.float(-1, 1) * 60, rng);
      this.peds.push(p);
    }

    this.data = new Float32Array(count * INSTANCE_FLOATS);
    const shared = { data: this.data, divisor: 1, dynamic: true, stride: STRIDE_BYTES };
    this.mesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: geo.pos },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: geo.nrm },
        { name: 'aPart', loc: LOC.part, size: 1, data: geo.part },
        { ...shared, name: 'iPos', loc: LOC.ipos, size: 3, offset: 0 },
        { ...shared, name: 'iYaw', loc: LOC.isize, size: 1, offset: 12 },
        { ...shared, name: 'iTint', loc: LOC.icolor, size: 3, offset: 16 },
        { ...shared, name: 'iPhase', loc: LOC.iparam, size: 1, offset: 28 },
      ],
    });
    // One buffer per instance attribute, kept so a frame does not resolve by name.
    this.ibufs = ATTRS.map((n) => this.mesh.buffers[n]);
    this.write();
  }

  // Every pedestrian stands on a pavement, never in the carriageway.
  respawn(p, cx, cz, rng) {
    const alongZ = rng.next() > 0.5;
    const here = alongZ ? cx : cz;
    const lane = (Math.round(here / this.B) + (rng.next() > 0.5 ? 1 : -1)) * this.B;
    const cross = lane + (rng.next() > 0.5 ? 1 : -1) * this.walk;
    const along = here + rng.float(-95, 95);
    p.x = alongZ ? cross : along;
    p.z = alongZ ? along : cross;
    p.axisZ = alongZ;
    p.dir = rng.next() > 0.5 ? 1 : -1;
  }

  // Crowd streaming: anyone two blocks out is recycled onto the next pavement.
  stream(cx, cz) {
    const lim = this.B * 2.2;
    for (const p of this.peds) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz > lim * lim) this.respawn(p, cx, cz, this.rng);
    }
    this.write();
  }

  update(dt, cx = 0, cz = 0) {
    for (const p of this.peds) {
      const step = p.speed * p.dir * dt;
      if (p.axisZ) p.z += step; else p.x += step;
      // One cycle is two steps; the wrap keeps a float32 phase precise.
      p.phase = (p.phase + Math.PI * (p.speed / p.stride) * dt) % (Math.PI * 2);
    }
    this.stream(cx, cz);
  }

  write() {
    const d = this.data;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const o = i * INSTANCE_FLOATS;
      d[o] = p.x + (p.axisZ ? p.drift : 0);
      d[o + 1] = 0;
      d[o + 2] = p.z + (p.axisZ ? 0 : p.drift);
      // Facing along the direction of travel.
      d[o + 3] = p.axisZ ? (p.dir > 0 ? 0 : Math.PI) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      d[o + 4] = p.tint[0];
      d[o + 5] = p.tint[1];
      d[o + 6] = p.tint[2];
      d[o + 7] = p.phase;
    }
    const gl = this.gl;
    for (const buf of this.ibufs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    }
  }

  draw(cam, vp) {
    const gl = this.gl;
    const p = this.prog;
    p.use();
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    drawMesh(gl, this.mesh, this.peds.length);
  }
}

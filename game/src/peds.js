// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Pedestrians: walking figures on the pavements. Every figure is the same tiny
// box mesh drawn once per instance, so a crowd costs one draw call and no extra
// shader. Legs and arms swing in the vertex shader from a per-instance phase, so
// the crowd is animated without touching a buffer every frame — only the
// instance transform changes.

import { CONFIG } from './config.js';
import { LOC, createProgram, makeMesh, drawMesh } from './gl.js';

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
void main() {
  vec3 p = aPos;
  vec3 n = aNormal;

  // Limbs pivot around their joint: hips at 0.92, shoulders at 1.44. The sign of
  // the swing is taken from the part id so left and right oppose each other.
  if (aPart > 0.5 && aPart < 2.5) {
    float s = aPart < 1.5 ? 1.0 : -1.0;
    float ang = sin(iPhase) * 0.52 * s;
    p.y -= 0.92;
    float c = cos(ang), sn = sin(ang);
    p = vec3(p.x, p.y * c - p.z * sn, p.y * sn + p.z * c);
    n = vec3(n.x, n.y * c - n.z * sn, n.y * sn + n.z * c);
    p.y += 0.92;
  } else if (aPart > 2.5 && aPart < 4.5) {
    float s = aPart < 3.5 ? -1.0 : 1.0;
    float ang = sin(iPhase) * 0.42 * s;
    p.y -= 1.44;
    float c = cos(ang), sn = sin(ang);
    p = vec3(p.x, p.y * c - p.z * sn, p.y * sn + p.z * c);
    n = vec3(n.x, n.y * c - n.z * sn, n.y * sn + n.z * c);
    p.y += 1.44;
  }

  float c = cos(iYaw);
  float s = sin(iYaw);
  vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 wp = iPos + r;
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
  // A pedestrian is the only thing in the city that is lit rather than glowing:
  // a little neon bounce from above keeps them readable against wet asphalt.
  float d = max(dot(N, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  vec3 col = vec3(0.05, 0.055, 0.07) + vec3(0.34, 0.30, 0.40) * d;
  col += vec3(0.30, 0.16, 0.42) * rim;
  col *= vTint;
  if (vPart > 4.5) col = mix(col, vec3(0.62, 0.46, 0.38), 0.75); // head, warmer
  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.9);
  fragColor = vec4(col, 1.0);
}`;

// One box, six quads, tagged with the limb it belongs to so the shader can
// swing it around the right joint.
function box(out, cx, cy, cz, sx, sy, sz, part) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [hx, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
    [[-1, 0, 0], [-hx, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [0, hy, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[0, -1, 0], [0, -hy, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [0, 0, hz], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [0, 0, -hz], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  for (const [n, , quad] of faces) {
    const order = [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const q = quad[k];
      out.pos.push(cx + q[0], cy + q[1], cz + q[2]);
      out.nrm.push(n[0], n[1], n[2]);
      out.part.push(part);
    }
  }
}

function buildPedMesh() {
  const out = { pos: [], nrm: [], part: [] };
  // Legs, hips down, one per side, tagged 1 and 2.
  box(out, -0.11, 0.46, 0, 0.17, 0.92, 0.20, 1);
  box(out, 0.11, 0.46, 0, 0.17, 0.92, 0.20, 2);
  // Torso: shoulders wider than the hips, which is what makes a silhouette read
  // as a person from forty metres away.
  box(out, 0, 1.20, 0, 0.46, 0.56, 0.26, 0);
  // Arms, tagged 3 and 4.
  box(out, -0.30, 1.18, 0, 0.14, 0.54, 0.17, 3);
  box(out, 0.30, 1.18, 0, 0.14, 0.54, 0.17, 4);
  // Head, tagged 5 so the shader can warm the skin tone.
  box(out, 0, 1.60, 0, 0.21, 0.24, 0.22, 5);
  return {
    pos: new Float32Array(out.pos),
    nrm: new Float32Array(out.nrm),
    part: new Float32Array(out.part),
  };
}

const COATS = [
  [0.92, 0.28, 0.34], // red jacket
  [0.30, 0.55, 0.95], // blue jacket
  [0.90, 0.86, 0.55], // raincoat
  [0.55, 0.30, 0.72], // violet
  [0.35, 0.78, 0.62], // teal
  [0.88, 0.88, 0.92], // white
  [0.95, 0.60, 0.25], // orange
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

    for (let i = 0; i < count; i++) {
      const p = {
        x: 0, z: 0, axisZ: true, dir: 1,
        speed: 1.1 + rng.next() * 0.7,
        phase: rng.next() * Math.PI * 2,
        tint: COATS[(rng.next() * COATS.length) | 0],
        // A small lateral wobble keeps a column of walkers from marching in file.
        drift: (rng.next() - 0.5) * 1.1,
      };
      this.respawn(p, rng.float(-1, 1) * 60, rng.float(-1, 1) * 60, rng);
      this.peds.push(p);
    }
    this.rng = rng;

    // Interleaved instance buffer: pos(3) yaw(1) tint(3) phase(1) = 8 floats.
    this.data = new Float32Array(count * 8);
    const stride = 8 * 4;
    this.mesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: geo.pos },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: geo.nrm },
        { name: 'aPart', loc: LOC.part, size: 1, data: geo.part },
        { name: 'iPos', loc: LOC.ipos, size: 3, data: this.data, divisor: 1, dynamic: true, stride, offset: 0 },
        { name: 'iYaw', loc: LOC.isize, size: 1, data: this.data, divisor: 1, dynamic: true, stride, offset: 12 },
        { name: 'iTint', loc: LOC.icolor, size: 3, data: this.data, divisor: 1, dynamic: true, stride, offset: 16 },
        { name: 'iPhase', loc: LOC.iparam, size: 1, data: this.data, divisor: 1, dynamic: true, stride, offset: 28 },
      ],
    });
    this.bound = CONFIG.radius * this.B;
    this.write();
  }

  // Every pedestrian stands on a pavement: a road line plus or minus half the
  // road plus half the walk, never in the carriageway.
  respawn(p, cx, cz, rng) {
    const B = this.B;
    const alongZ = rng.next() > 0.5;
    const here = alongZ ? cx : cz;
    const lane = (Math.round(here / B) + (rng.next() > 0.5 ? 1 : -1)) * B;
    const side = rng.next() > 0.5 ? 1 : -1;
    const cross = lane + side * this.walk;
    const along = here + rng.float(-95, 95);
    p.x = alongZ ? cross : along;
    p.z = alongZ ? along : cross;
    p.axisZ = alongZ;
    p.dir = rng.next() > 0.5 ? 1 : -1;
  }

  // Crowd streaming: anyone who drifts more than two blocks away is recycled
  // onto the next pavement over, so the street stays populated in every shot
  // without ever simulating a city-wide crowd.
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
      p.phase += p.speed * dt * 3.1;
    }
    this.stream(cx, cz);
  }

  write() {
    const d = this.data;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const o = i * 8;
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
    for (const name of ['iPos', 'iYaw', 'iTint', 'iPhase']) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.buffers[name]);
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

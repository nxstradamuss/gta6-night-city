// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// The district: a grid of blocks, towers, wet asphalt, neon and street lamps,
// instanced, with every window computed per pixel and the whole ground painted
// by one shader from the same hashes that place the buildings.

import { CONFIG, NEON } from './config.js';
import { LOC, QUAD, createProgram, makeMesh, drawMesh } from './gl.js';
import { GLSL_HASH, GLSL_FOG } from './glsl.js';
import { FACES, QUAD_INDEX, pushBox } from './geom.js';
import { clamp, clamp01, TAU } from './math.js';
import { PROP_KINDS, buildStreetProps, buildRoofProps } from './props.js';

const SIGN_WORDS = [
  ['MOTEL', '#ff2d95'],
  ['LIQUOR', '#22e6ff'],
  ['24 HOUR', '#ffd166'],
  ['ARCADE', '#b06bff'],
  ['NOODLES', '#ff6b3d'],
  ['PAWN', '#3dffa8'],
  ['TATTOO', '#ff3d6b'],
  ['DINER', '#7dff3d'],
];

// lamps

// Sodium vs LED is keyed off the lamp's grid cell so mesh, glow and pool agree.

const LAMP_SPACING_FRAC = 0.5;
const LAMP_ARM_OFFSET = 1.6;
const LAMP_ARM_REACH = 2.7;
const LAMP_COOL_CUT = 0.55;
const LAMP_WARM = [1.00, 0.70, 0.34];
const LAMP_COOL = [0.62, 0.80, 1.00];

const fract1 = (v) => v - Math.floor(v);

// Mirror of GLSL_HASH's hash11: CPU and GPU agree on a lamp's temperature.
function hash11(p) {
  p = fract1(Math.fround(p) * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract1(p);
}

function lampWarmth(roadLine, along, block) {
  const cellLine = Math.floor(roadLine / block + 0.5);
  const cellAlong = Math.floor(along / (block * LAMP_SPACING_FRAC) + 0.5);
  return hash11(cellLine * 17.3 + cellAlong * 5.7);
}

function lampColor(roadLine, along, block) {
  const cool = lampWarmth(roadLine, along, block) >= LAMP_COOL_CUT;
  return cool ? LAMP_COOL.slice() : LAMP_WARM.slice();
}

// generation

export function generateCity(rng, cfg) {
  const B = cfg.block;
  const R = cfg.radius;
  const halfRoad = cfg.roadWidth * 0.5;
  const walk = cfg.sidewalk;
  const inset = halfRoad + walk;

  const buildings = [];
  const signs = [];
  const lamps = [];
  const lots = [];

  const signCell = (i) => [i % 4, Math.floor(i / 4) % 2];

  for (let i = -R; i < R; i++) {
    for (let j = -R; j < R; j++) {
      const x0 = i * B + inset;
      const x1 = (i + 1) * B - inset;
      const z0 = j * B + inset;
      const z1 = (j + 1) * B - inset;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;

      // Downtown towers near the middle, low-rise at the edges.
      const dist = Math.hypot(cx, cz) / (R * B);
      const core = Math.pow(clamp01(1 - dist * 1.05), 1.4);

      // A few cells stay empty: parking lots and small plazas.
      if (rng.chance(0.10 + (1 - core) * 0.12)) {
        lots.push({ x0, x1, z0, z1 });
        continue;
      }

      // Split the block into 2x2 sub-lots with a narrow alley between them.
      const gap = 2.2;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const quad = [
        [x0, mx - gap * 0.5, z0, mz - gap * 0.5],
        [mx + gap * 0.5, x1, z0, mz - gap * 0.5],
        [x0, mx - gap * 0.5, mz + gap * 0.5, z1],
        [mx + gap * 0.5, x1, mz + gap * 0.5, z1],
      ];

      // One merged tower instead of four small ones in the densest cells.
      const merged = core > 0.45 && rng.chance(0.45);
      const subs = merged ? [[x0, x1, z0, z1]] : quad;

      for (let q = 0; q < subs.length; q++) {
        const [sx0, sx1, sz0, sz1] = subs[q];
        if (rng.chance(0.06)) continue;
        const w = sx1 - sx0;
        const d = sz1 - sz0;
        const bx = sx0 + rng.float(0, w * 0.12);
        const bz = sz0 + rng.float(0, d * 0.12);
        const bw = w - (bx - sx0) - rng.float(0, w * 0.12);
        const bd = d - (bz - sz0) - rng.float(0, d * 0.12);

        const tall = core * (merged ? 1.0 : 0.72);
        const h = (7 + tall * 78) * rng.float(0.55, 1.35);
        const style = rng.chance(0.34) ? 2 : rng.chance(0.5) ? 0 : 1;
        const tintRoll = rng.next();
        let color;
        if (tintRoll < 0.55) color = [0.055 + rng.float(0, 0.02), 0.062 + rng.float(0, 0.02), 0.085 + rng.float(0, 0.03)];
        else if (tintRoll < 0.82) color = [0.10 + rng.float(0, 0.03), 0.095 + rng.float(0, 0.02), 0.10 + rng.float(0, 0.02)];
        else color = [0.085 + rng.float(0, 0.02), 0.075 + rng.float(0, 0.02), 0.065 + rng.float(0, 0.02)];

        buildings.push({
          x0: bx, x1: bx + bw, z0: bz, z1: bz + bd, h,
          style, color, seed: rng.float(0, 100), tall,
        });

        // Neon signage on the street-facing faces.
        if (rng.chance(0.42 + core * 0.2)) {
          const faces = [
            { axis: 'z', at: bz, yaw: Math.PI, len: bw },
            { axis: 'z', at: bz + bd, yaw: 0, len: bw },
            { axis: 'x', at: bx, yaw: Math.PI * 0.5, len: bd },
            { axis: 'x', at: bx + bw, yaw: -Math.PI * 0.5, len: bd },
          ];
          const f = faces[rng.int(faces.length)];
          const word = rng.int(SIGN_WORDS.length);
          const [col, row] = signCell(word);
          const sw = clamp(f.len * rng.float(0.55, 0.9), 5.5, 13);
          const sh = sw * 0.5;
          const y = rng.float(5.5, Math.min(17, h - sh - 1.5));
          const off = rng.float(-0.5, 0.5) * Math.max(0, f.len - sw);
          const along = f.axis === 'z'
            ? { x: bx + bw * 0.5 + off, z: f.at + (f.yaw === 0 ? 0.22 : -0.22) }
            : { x: f.at + (f.yaw > 0 ? 0.22 : -0.22), z: bz + bd * 0.5 + off };
          signs.push({
            x: along.x, y, z: along.z, yaw: f.yaw, w: sw, h: sh,
            u0: col / 4, v0: 1 - (row + 1) / 2, du: 1 / 4, dv: 1 / 2,
            color: SIGN_WORDS[word][1],
          });
        }
      }
    }
  }

  // Lamps down every avenue, arm over the road.
  const spacing = B * LAMP_SPACING_FRAC;
  const armLen = LAMP_ARM_REACH;
  for (let k = -R; k <= R; k++) {
    const line = k * B;
    for (let t = -R; t < R; t++) {
      const along = t * spacing + spacing * 0.5;
      if (Math.abs(along) > R * B + 4) continue;
      // Keep the junction mouths clear.
      if (Math.abs(along - Math.round(along / B) * B) < halfRoad + 1.5) continue;

      // One fitting per position, shared by the pair either side of the road.
      const tint = lampColor(line, along, B);

      for (const side of [-1, 1]) {
        const off = side * (halfRoad + LAMP_ARM_OFFSET);
        // Along a north-south road the arm must point back at the centreline.
        const yawZ = side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
        lamps.push({
          x: line + off, z: along, yaw: yawZ, color: tint,
          headX: line + off + Math.sin(yawZ) * armLen, headZ: along + Math.cos(yawZ) * armLen, headY: 6.9,
        });
        // Along an east-west road: arm points along -Z or +Z.
        const yawX = side > 0 ? Math.PI : 0;
        lamps.push({
          x: along, z: line + off, yaw: yawX, color: tint,
          headX: along + Math.sin(yawX) * armLen, headZ: line + off + Math.cos(yawX) * armLen, headY: 6.9,
        });
      }
    }
  }

  // Street furniture and roof clutter: one instanced program.
  const props = buildStreetProps(rng, { block: B, halfRoad, walk, reach: R + 1 })
    .concat(buildRoofProps(rng, buildings));

  return { buildings, signs, lamps, props, lots, block: B, halfRoad, walk };
}

// Circle-versus-AABB push-out against every building footprint.
export function resolveCollisions(buildings, pos, radius) {
  let px = pos[0];
  let pz = pos[2];
  let hit = false;
  let nx = 0;
  let nz = 0;

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (px < b.x0 - radius || px > b.x1 + radius || pz < b.z0 - radius || pz > b.z1 + radius) continue;
    const cx = clamp(px, b.x0, b.x1);
    const cz = clamp(pz, b.z0, b.z1);
    let dx = px - cx;
    let dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;

    if (d2 < 1e-8) {
      // Centre inside the box: escape through the nearest face.
      const dl = px - b.x0;
      const dr = b.x1 - px;
      const dn = pz - b.z0;
      const df = b.z1 - pz;
      const m = Math.min(dl, dr, dn, df);
      if (m === dl) { px = b.x0 - radius; nx = -1; nz = 0; }
      else if (m === dr) { px = b.x1 + radius; nx = 1; nz = 0; }
      else if (m === dn) { pz = b.z0 - radius; nx = 0; nz = -1; }
      else { pz = b.z1 + radius; nx = 0; nz = 1; }
    } else {
      const d = Math.sqrt(d2);
      nx = dx / d;
      nz = dz / d;
      px = cx + nx * radius;
      pz = cz + nz * radius;
    }
    hit = true;
  }

  return { hit, x: px, z: pz, nx, nz };
}

// geometry

// Shared -1..1 cube faces remapped to the 0..1 box the shader expects.
function box01() {
  const P = [], N = [], I = [];
  for (const f of FACES) {
    const base = P.length / 3;
    for (const v of f.v) {
      P.push(v[0] * 0.5 + 0.5, v[1] * 0.5 + 0.5, v[2] * 0.5 + 0.5);
      N.push(f.n[0], f.n[1], f.n[2]);
    }
    for (const k of QUAD_INDEX) I.push(base + k);
  }
  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    indices: new Uint16Array(I),
  };
}

function lampGeometry() {
  const P = [], N = [], PT = [], I = [];

  const box = (...a) => pushBox(P, N, PT, I, ...a);

  box(0, 3.6, 0, 0.18, 7.2, 0.18, 0);
  box(0, 7.12, 1.35, 0.14, 0.14, 2.7, 0);
  box(0, 6.94, 2.7, 0.46, 0.18, 1.0, 1);
  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    parts: new Float32Array(PT),
    indices: new Uint16Array(I),
  };
}

// shaders

const GROUND_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP;
out vec3 vWorld;
void main() {
  vec3 wp = vec3(aPos.x, 0.0, aPos.y);
  vWorld = wp;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform sampler2D uNoise;
uniform float uBlock;
uniform float uHalfRoad;
uniform float uWalk;
uniform vec3 uLightPos[2];
uniform vec3 uLightCol[2];
uniform float uLightOn[2];
uniform float uTime;
uniform vec3 uHeadPos;
uniform vec2 uHeadDir;
uniform float uHeadOn;
out vec4 fragColor;
${GLSL_HASH}
${GLSL_FOG}

// Road paint, in metres, so a marking keeps its real width at any block size.
const float LANE_FRAC = 0.52;
const float TYRE_OFFSET = 0.95;
const float PAINT_HALF = 0.11;
const float CENTRE_GAP = 0.22;
const float CENTRE_SPLIT = 0.34;
const float DASH_LEN = 4.5;
const float LANE_DASH = 9.0;
const float DASH_DUTY = 0.45;
const float XWALK_DEPTH = 3.4;
const float BAR_PITCH = 1.15;
const float BAR_DUTY = 0.55;

// Wet surface.
const float STREAK_PITCH = 1.45;
const float REFL_DECAY = 0.085;
const float PUDDLE_LO = 0.58;
const float PUDDLE_MID = 0.70;
const float PUDDLE_HI = 0.84;
const float SIGN_PITCH = 4.6;

// Street lamps: pool colour comes from the same hash as the lamp mesh.
const float LAMP_POOL = 0.045;
const float LAMP_KERB = 1.6;
const float LAMP_REACH = 2.7;
const vec3 LAMP_WARM = vec3(1.00, 0.70, 0.34);
const vec3 LAMP_COOL = vec3(0.62, 0.80, 1.00);
const float LAMP_COOL_CUT = 0.55;

void main() {
  vec2 p = vWorld.xz;
  float B = uBlock;
  float mx = p.x / B;
  float mz = p.y / B;
  float dx = abs(mx - floor(mx + 0.5)) * B;
  float dz = abs(mz - floor(mz + 0.5)) * B;
  bool vert = dx < dz;
  float across = min(dx, dz);
  float along = vert ? p.y : p.x;
  float halfRoad = uHalfRoad;
  float road = step(across, halfRoad);
  float laneCentre = halfRoad * LANE_FRAC;

  vec3 n1 = texture(uNoise, p * 0.035).rgb;
  vec3 n2 = texture(uNoise, p * 0.145).rgb;
  float grain = n1.r * 0.6 + n2.g * 0.4;
  float wet = smoothstep(0.52, 0.80, n2.b) * 0.75 + 0.25;

  vec3 col = vec3(0.050, 0.053, 0.066) * (0.72 + 0.62 * grain);
  col += vec3(0.014, 0.015, 0.022) * n2.r;

  // Tyre tracks, tar patches, aggregate speckle.
  float track = smoothstep(0.62, 0.06, abs(abs(across - laneCentre) - TYRE_OFFSET));
  col *= 1.0 - track * 0.24;
  float tarPatch = step(0.87, hash21(floor(p * 0.105) + 7.3));
  col = mix(col, col * vec3(0.60, 0.58, 0.65), tarPatch * 0.8);
  float agg = hash21(floor(p * 8.5));
  col *= 0.88 + 0.24 * agg;

  vec3 V = normalize(uCam - vWorld);
  for (int i = 0; i < 2; i++) {
    vec3 Lv = uLightPos[i] - vWorld;
    float d2 = dot(Lv, Lv);
    float att = uLightOn[i] / (1.0 + d2 * 0.030);
    vec3 L = Lv * inversesqrt(d2 + 0.0001);
    float ndl = max(L.y, 0.0);
    col += uLightCol[i] * att * ndl * 0.55;
    vec3 H = normalize(V + L);
    float spec = pow(max(H.y, 0.0), 46.0);
    col += uLightCol[i] * spec * att * (1.2 + wet * 3.4);
  }

  // Neon bleeding onto the wet asphalt.
  vec2 cell = floor(p / B);
  float h1 = hash21(cell + 3.1);
  vec3 tint = mix(vec3(1.0, 0.18, 0.55), vec3(0.15, 0.85, 1.0), step(0.5, h1));
  tint = mix(tint, vec3(1.0, 0.55, 0.15), step(0.87, h1));
  float curb = smoothstep(halfRoad + 6.0, halfRoad - 3.0, across);
  col += tint * curb * (0.045 + wet * 0.085);

  // Lamp pools: an ellipse under each head, amber or LED white from the cell hash.
  float lampSpacing = B * 0.5;
  vec2 lampCell = vec2(
    floor((vert ? p.x : p.y) / B + 0.5),
    floor(along / lampSpacing + 0.5)
  );
  float lampCool = step(LAMP_COOL_CUT, hash11(lampCell.x * 17.3 + lampCell.y * 5.7));
  vec3 lampTint = mix(LAMP_WARM, LAMP_COOL, lampCool);
  // Posts sit outside the kerb, arms reach back, so the pool hangs in.
  float poolAlong = abs(fract(along / lampSpacing) - 0.5) * lampSpacing;
  float poolAcross = abs(across - (halfRoad + LAMP_KERB - LAMP_REACH));
  float poolFall = 1.0 / (1.0 + (poolAlong * poolAlong + poolAcross * poolAcross * 0.55) * LAMP_POOL);
  // generateCity() clears junction mouths: no lamp, no pool.
  float junctionGap = abs(along - floor(along / B + 0.5) * B);
  float hasLamp = step(halfRoad + 1.5, junctionGap);
  col += lampTint * poolFall * road * hasLamp * (0.24 + wet * 0.18);

  // Markings painted, not textured: double yellow, lane dividers, crosswalk bars.
  float aa = max(fwidth(across), 1e-4);
  float paintFade = 1.0 - smoothstep(0.9, 2.2, aa / PAINT_HALF);
  float centreDist = min(abs(across - CENTRE_GAP), abs(across - CENTRE_GAP - CENTRE_SPLIT));
  float centreLine = 1.0 - smoothstep(PAINT_HALF - aa, PAINT_HALF + aa, centreDist);
  float centreDash = step(fract(along / DASH_LEN), DASH_DUTY);
  float laneLine = 1.0 - smoothstep(PAINT_HALF - aa, PAINT_HALF + aa, abs(across - laneCentre));
  float laneDash = step(fract(along / LANE_DASH), DASH_DUTY);
  vec3 yellowPaint = vec3(0.50, 0.38, 0.11) * (0.55 + 0.45 * grain);
  vec3 whitePaint = vec3(0.46, 0.48, 0.52) * (0.55 + 0.45 * grain);
  col = mix(col, yellowPaint, centreLine * centreDash * road * paintFade * 0.85);
  col = mix(col, whitePaint, laneLine * laneDash * road * paintFade * 0.55);

  // Crosswalk bars outside each junction, rungs parallel to traffic.
  float inX = step(dx, halfRoad);
  float inZ = step(dz, halfRoad);
  float bandZ = inX * step(halfRoad, dz) * step(dz, halfRoad + XWALK_DEPTH);
  float bandX = inZ * step(halfRoad, dx) * step(dx, halfRoad + XWALK_DEPTH);
  float outward = max(dx, dz);
  float bandFade = smoothstep(halfRoad, halfRoad + 0.45, outward)
    * (1.0 - smoothstep(halfRoad + XWALK_DEPTH - 0.55, halfRoad + XWALK_DEPTH, outward));
  float rungPhase = fract((vert ? p.x : p.y) / BAR_PITCH);
  float rung = smoothstep(0.0, 0.06, rungPhase) * (1.0 - smoothstep(BAR_DUTY, BAR_DUTY + 0.06, rungPhase));
  float crosswalk = max(bandZ, bandX) * bandFade * rung * paintFade;
  col = mix(col, whitePaint * 1.08, crosswalk * 0.60);

  // Wet reflections faked from the window hash; a planar mirror costs a target.
  float kerbDist = max(halfRoad - across, 0.0);
  float streakCell = floor(along / STREAK_PITCH);
  float sh1 = hash11(streakCell * 1.73 + cell.x * 3.1 + cell.y * 7.7);
  float sh2 = hash11(streakCell * 5.11 + cell.x * 1.9 + cell.y * 2.3);
  float streakOn = step(0.36, sh1);
  vec3 streakCol = mix(vec3(1.0, 0.78, 0.46), vec3(0.52, 0.84, 1.0), step(0.55, sh2));
  streakCol = mix(streakCol, tint, 0.35);
  vec3 streakFall = exp(-kerbDist * vec3(REFL_DECAY, REFL_DECAY * 1.15, REFL_DECAY * 1.35));
  float streakPhase = abs(fract(along / STREAK_PITCH) - 0.5) * 2.0;
  float streakBody = 1.0 - smoothstep(0.30, 1.0, streakPhase);
  float bleed = clamp(kerbDist * 0.05, 0.0, 0.85);
  vec3 reflCol = mix(streakCol, vec3(streakCol.r * 1.10, streakCol.g * 0.92, streakCol.b * 1.24), bleed);
  col += reflCol * streakFall * streakOn * streakBody * road * (0.42 + wet * 1.30) * (0.55 + 0.45 * grain);

  // Standing water: a shallow sky mirror, plus a sign's colour above it.
  float puddle = smoothstep(PUDDLE_LO, PUDDLE_MID, n2.b) * road;
  float puddleEdge = smoothstep(PUDDLE_MID, PUDDLE_HI, n2.b);
  vec3 sky = mix(vec3(0.09, 0.13, 0.24), tint, 0.30);
  col = mix(col, sky + col * 0.35, puddle * 0.55);

  float wobble = sin(along * 1.7 + uTime * 0.6) * 0.35 + sin(along * 4.3 - uTime * 0.9) * 0.12;
  float signSlot = floor(along / SIGN_PITCH);
  float signOn = step(0.45, hash11(signSlot * 4.7 + cell.x * 2.3 + cell.y * 6.1));
  float signPhase = abs(fract((along + wobble) / SIGN_PITCH) - 0.5) * 2.0;
  float signBar = 1.0 - smoothstep(0.35, 0.85, signPhase);
  vec3 signCol = mix(vec3(1.0, 0.18, 0.55), vec3(0.15, 0.85, 1.0), step(0.5, hash11(signSlot * 1.3 + 0.7)));
  signCol = mix(signCol, vec3(1.0, 0.80, 0.30), step(0.86, hash11(signSlot * 2.9)));
  float reach = exp(-kerbDist * 0.30) * smoothstep(0.0, 0.9, kerbDist);
  float mirror = (puddle * 0.55 + puddleEdge * 0.45) * signOn * signBar * reach;
  col += signCol * mirror * (0.55 + wet * 0.85);

  // Rain rings that bloom and die per puddle cell.
  vec2 rc = p * 2.4;
  vec2 rid = floor(rc);
  vec2 rf = fract(rc) - 0.5;
  float phase = fract(uTime * 1.55 + hash21(rid) * 9.0);
  float ring = smoothstep(0.055, 0.0, abs(length(rf) - phase * 0.44)) * (1.0 - phase);
  col += vec3(0.50, 0.66, 0.92) * ring * (0.10 + wet * 0.30) * (0.45 + 0.55 * puddle) * road;

  // Headlight wedge: hot at the nose, long tail on wet asphalt.
  vec2 hp = vWorld.xz - uHeadPos.xz;
  float hFwd = dot(hp, uHeadDir);
  float hSide = abs(hp.x * uHeadDir.y - hp.y * uHeadDir.x);
  float wedge = smoothstep(0.0, 2.2, hFwd) * smoothstep(30.0, 6.0, hFwd);
  wedge *= smoothstep(8.5, 1.2, hSide + max(hFwd, 0.0) * 0.30);
  col += vec3(1.0, 0.93, 0.76) * wedge * uHeadOn * (0.36 + wet * 0.70);

  // Kerb and pavement.
  float pavement = step(halfRoad, across) * step(across, halfRoad + uWalk);
  float tiles = smoothstep(0.94, 1.0, abs(fract(along / 2.0) - 0.5) * 2.0);
  vec3 pave = vec3(0.082, 0.084, 0.095) * (0.8 + 0.5 * grain);
  pave -= tiles * 0.012;
  pave += tint * 0.030;
  col = mix(col, pave, pavement);

  float dist = length(vWorld - uCam);
  col = mix(col, uFogColor, fogAmt(dist) * 0.92);

  fragColor = vec4(col, 1.0);
}`;

const BUILD_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iSize;
layout(location=6) in vec3 iColor;
layout(location=7) in vec2 iParam;
uniform mat4 uVP;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec3 vColor;
out vec2 vParam;
out vec3 vSize;
void main() {
  vec3 wp = iPos + aPos * iSize;
  vWorld = wp;
  vNormal = aNormal;
  vLocal = aPos;
  vColor = iColor;
  vParam = iParam;
  vSize = iSize;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const BUILD_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec3 vColor;
in vec2 vParam;
in vec3 vSize;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
out vec4 fragColor;
${GLSL_HASH}
${GLSL_FOG}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  float style = vParam.x;
  float seed = vParam.y;

  // Facade base: cold sky light plus a warm bounce off the street.
  float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 amb = mix(vec3(0.085, 0.075, 0.115), vec3(0.020, 0.028, 0.062), up);
  vec3 col = vColor * (amb * 3.8 + 0.07);
  col += vec3(0.16, 0.09, 0.20) * pow(1.0 - abs(dot(N, V)), 2.5) * 0.7;

  if (N.y > 0.5) {
    // Roof: dark tar with a hint of gravel.
    col = vColor * 0.5 + vec3(0.02, 0.02, 0.025) * hash31(vec3(vWorld.xz * 0.5, seed));
    fragColor = vec4(col, 1.0);
    fragColor.rgb = mix(fragColor.rgb, uFogColor, fogAmt(length(vWorld - uCam)) * 0.9);
    return;
  }

  float dist = length(vWorld - uCam);

  // Near-field falloff for thin neon strips, which would clip to white bars.
  float nearFade = smoothstep(2.5, 16.0, dist);

  // Windows are authored above the tonemap knee; taper by on-screen floor cell so
  // only small windows stay hot.
  float pxPerMetre = 1.0 / max(fwidth(vWorld.y), 1e-5);
  float cellPx = 3.55 * pxPerMetre;
  float sizeFade = 1.0 - smoothstep(20.0, 74.0, cellPx);

  float u = abs(N.x) > 0.5 ? vWorld.z : vWorld.x;
  float edge = abs(N.x) > 0.5
    ? min(vLocal.z, 1.0 - vLocal.z) * vSize.z
    : min(vLocal.x, 1.0 - vLocal.x) * vSize.x;

  // Window grid keyed off the building seed, so a row of towers reads as distinct.
  float vStyle = hash11(seed * 7.31);
  float floorH = mix(3.30, 3.95, vStyle);
  float colW = mix(2.50, 3.80, hash11(seed * 3.17));
  float rectIn = mix(0.12, 0.29, hash11(seed * 5.70));
  float rectOut = mix(0.71, 0.88, hash11(seed * 9.10));
  vec2 g = vec2(u / colW, vWorld.y / floorH);
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 rect = smoothstep(vec2(rectIn), vec2(rectIn + 0.11), f)
    * smoothstep(vec2(rectOut), vec2(rectOut - 0.11), f);
  float mask = rect.x * rect.y;

  // Shadow line under each slab, pilasters every third bay, grime down the facade.
  float fy = fract(vWorld.y / floorH);
  float slabLine = smoothstep(0.055, 0.0, min(fy, 1.0 - fy));
  col *= 1.0 - slabLine * 0.45;
  col += vec3(0.22, 0.24, 0.33) * smoothstep(0.40, 0.38, min(fy, 1.0 - fy)) * 0.06;

  float bayU = fract(u / (colW * 3.0));
  float pilaster = smoothstep(0.045, 0.0, min(bayU, 1.0 - bayU));
  col *= 1.0 - pilaster * 0.28;

  float grime = hash11(floor(u * 1.35) + seed * 13.0);
  col *= 0.84 + 0.16 * grime;

  float r = hash31(vec3(id, seed));
  float r2 = hash31(vec3(id.yx + 11.0, seed * 1.7));
  float lit = step(0.48, r);
  // Whole floors sometimes go dark, breaking up the regularity.
  lit *= step(0.14, hash11(id.y * 0.7 + seed));

  vec3 warm = vec3(1.0, 0.76, 0.42);
  vec3 cool = vec3(0.60, 0.78, 1.0);
  vec3 mint = vec3(0.42, 1.0, 0.88);
  vec3 ec = mix(warm, cool, step(0.52, r2));
  ec = mix(ec, mint, step(0.93, r2));
  float inten = 1.15 + 1.5 * hash11(r * 31.0 + seed);

  float topFloor = smoothstep(vSize.y - 2.0, vSize.y + 6.0, vWorld.y);
  col += ec * mask * lit * inten * (1.0 - topFloor * 0.55) * sizeFade;

  // Ground floor: bright shopfronts with mullions.
  float shopBand = smoothstep(4.6, 4.0, vWorld.y) * step(0.35, vWorld.y);
  float mull = smoothstep(0.06, 0.0, abs(fract(u / 5.4) - 0.5) - 0.40);
  float shopLit = step(0.28, hash11(floor(u / 5.4) + seed * 3.0));
  vec3 shopCol = mix(vec3(1.0, 0.82, 0.55), vec3(0.55, 0.92, 1.0), step(0.5, hash11(floor(u / 5.4) + seed)));
  col += shopCol * shopBand * (1.0 - mull) * shopLit * 0.95 * nearFade;

  // Neon trim: corner strips, roofline on the tall ones.
  if (style > 1.5) {
    float strip = smoothstep(0.55, 0.12, edge);
    vec3 neon = mix(vec3(1.0, 0.16, 0.62), vec3(0.16, 0.88, 1.0), step(0.5, hash11(seed)));
    // As with the windows: taper by on-screen width or a strip becomes a slab.
    float edgePx = 0.43 / max(fwidth(edge), 1e-5);
    float stripFade = 1.0 - smoothstep(6.0, 22.0, edgePx);
    col += neon * strip * 1.35 * nearFade * stripFade;
  }
  float roofTrim = smoothstep(0.985, 1.0, vLocal.y) * step(28.0, vSize.y);
  col += vec3(0.55, 0.70, 1.0) * roofTrim * 0.9 * nearFade;

  // Antenna/AC silhouette break on the top edge.
  col *= 1.0 - smoothstep(0.995, 1.0, vLocal.y) * 0.35;

  col = mix(col, uFogColor, fogAmt(dist) * 0.92);
  fragColor = vec4(col, 1.0);
}`;

const SIGN_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in float iYaw;
layout(location=4) in vec3 iPos;
layout(location=5) in vec2 iSize;
layout(location=6) in vec3 iColor;
layout(location=7) in vec4 iUv;
uniform mat4 uVP;
out vec2 vUv;
out vec3 vColor;
out vec3 vWorld;
void main() {
  vec3 right = vec3(cos(iYaw), 0.0, sin(iYaw));
  vec3 wp = iPos + right * aPos.x * iSize.x + vec3(0.0, 1.0, 0.0) * (aPos.y + 0.5) * iSize.y;
  vUv = iUv.xy + vec2(aPos.x + 0.5, aPos.y + 0.5) * iUv.zw;
  vColor = iColor;
  vWorld = wp;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const SIGN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vColor;
in vec3 vWorld;
uniform sampler2D uAtlas;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
out vec4 fragColor;
${GLSL_FOG}
void main() {
  vec4 t = texture(uAtlas, vUv);
  float a = t.a;
  if (a < 0.01) discard;
  vec3 col = t.rgb * vColor * 1.5;
  col = mix(col, uFogColor, fogAmt(length(vWorld - uCam)) * 0.9);
  fragColor = vec4(col * a, a);
}`;

const LAMP_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=3) in float aPart;
layout(location=4) in vec3 iPos;
layout(location=5) in float iYaw;
layout(location=6) in vec3 iTint;
uniform mat4 uVP;
out vec3 vWorld;
out vec3 vNormal;
out float vPart;
out vec3 vTint;
void main() {
  float c = cos(iYaw);
  float s = sin(iYaw);
  vec3 r = vec3(aPos.x * c + aPos.z * s, aPos.y, -aPos.x * s + aPos.z * c);
  vec3 wp = iPos + r;
  vWorld = wp;
  vNormal = vec3(aNormal.x * c + aNormal.z * s, aNormal.y, -aNormal.x * s + aNormal.z * c);
  vPart = aPart;
  vTint = iTint;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const LAMP_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vPart;
in vec3 vTint;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
out vec4 fragColor;
${GLSL_FOG}
void main() {
  vec3 col;
  if (vPart > 0.5) {
    // Emissive: lamp heads, bollard tops, cone bands, hydrant caps.
    col = vTint * 1.30;
  } else {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCam - vWorld);
    float d = max(dot(N, normalize(vec3(0.3, 0.8, 0.4))), 0.0);
    col = vec3(0.045, 0.048, 0.058) + vec3(0.30) * pow(max(dot(N, V), 0.0), 6.0);
    col *= 0.8 + 0.5 * d;
    col *= vTint;
  }
  col = mix(col, uFogColor, fogAmt(length(vWorld - uCam)) * 0.9);
  fragColor = vec4(col, 1.0);
}`;

// atlas

function makeSignAtlas(gl) {
  const cw = 512;
  const ch = 256;
  const canvas = document.createElement('canvas');
  canvas.width = cw * 4;
  canvas.height = ch * 2;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);

  SIGN_WORDS.forEach(([word, color], i) => {
    const cx = (i % 4) * cw;
    const cy = Math.floor(i / 4) * ch;
    g.save();
    g.translate(cx, cy);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 118px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
    // Wide glow pass, then a hot white core.
    g.shadowColor = color;
    g.shadowBlur = 52;
    g.fillStyle = color;
    for (let k = 0; k < 3; k++) g.fillText(word, cw / 2, ch / 2);
    g.shadowBlur = 14;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.92;
    g.fillText(word, cw / 2, ch / 2);
    g.restore();
  });

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// renderer

export class CityRenderer {
  constructor(gl, city, noiseTex) {
    this.gl = gl;
    this.city = city;
    this.noiseTex = noiseTex;

    const half = CONFIG.radius * city.block + 60;
    this.ground = makeMesh(gl, {
      attributes: [{
        name: 'aPos', loc: LOC.pos, size: 2,
        data: new Float32Array([-half, -half, half, -half, half, half, -half, -half, half, half, -half, half]),
      }],
    });

    const box = box01();
    const n = city.buildings.length;
    const ip = new Float32Array(n * 3);
    const is = new Float32Array(n * 3);
    const ic = new Float32Array(n * 3);
    const ia = new Float32Array(n * 2);
    city.buildings.forEach((b, i) => {
      ip[i * 3] = b.x0; ip[i * 3 + 1] = 0; ip[i * 3 + 2] = b.z0;
      is[i * 3] = b.x1 - b.x0; is[i * 3 + 1] = b.h; is[i * 3 + 2] = b.z1 - b.z0;
      ic[i * 3] = b.color[0]; ic[i * 3 + 1] = b.color[1]; ic[i * 3 + 2] = b.color[2];
      ia[i * 2] = b.style; ia[i * 2 + 1] = b.seed;
    });
    this.buildingMesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: box.positions },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: box.normals },
        { name: 'iPos', loc: LOC.ipos, size: 3, data: ip, divisor: 1 },
        { name: 'iSize', loc: LOC.isize, size: 3, data: is, divisor: 1 },
        { name: 'iColor', loc: LOC.icolor, size: 3, data: ic, divisor: 1 },
        { name: 'iParam', loc: LOC.iparam, size: 2, data: ia, divisor: 1 },
      ],
      indices: box.indices,
    });
    this.buildingCount = n;

    const sc = city.signs;
    const sp = new Float32Array(sc.length * 3);
    const ss = new Float32Array(sc.length * 2);
    const sy = new Float32Array(sc.length);
    const su = new Float32Array(sc.length * 4);
    const scol = new Float32Array(sc.length * 3);
    const tmp = [0, 0, 0];
    sc.forEach((s, i) => {
      sp[i * 3] = s.x; sp[i * 3 + 1] = s.y; sp[i * 3 + 2] = s.z;
      ss[i * 2] = s.w; ss[i * 2 + 1] = s.h;
      sy[i] = s.yaw;
      su[i * 4] = s.u0; su[i * 4 + 1] = s.v0; su[i * 4 + 2] = s.du; su[i * 4 + 3] = s.dv;
      const c = hexToRgb(s.color, tmp);
      scol[i * 3] = c[0]; scol[i * 3 + 1] = c[1]; scol[i * 3 + 2] = c[2];
    });
    this.signMesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 2, data: QUAD },
        { name: 'iYaw', loc: LOC.normal, size: 1, data: sy, divisor: 1 },
        { name: 'iPos', loc: LOC.ipos, size: 3, data: sp, divisor: 1 },
        { name: 'iSize', loc: LOC.isize, size: 2, data: ss, divisor: 1 },
        { name: 'iColor', loc: LOC.icolor, size: 3, data: scol, divisor: 1 },
        { name: 'iUv', loc: LOC.iparam, size: 4, data: su, divisor: 1 },
      ],
    });
    this.signCount = sc.length;
    this.atlas = makeSignAtlas(gl);

    const lamp = lampGeometry();
    const lp = new Float32Array(city.lamps.length * 3);
    const ly = new Float32Array(city.lamps.length);
    const lt = new Float32Array(city.lamps.length * 3);
    city.lamps.forEach((L, i) => {
      lp[i * 3] = L.x; lp[i * 3 + 1] = 0; lp[i * 3 + 2] = L.z;
      ly[i] = L.yaw;
      // Each lamp carries its fitting's temperature.
      const c = L.color || LAMP_WARM;
      lt[i * 3] = c[0]; lt[i * 3 + 1] = c[1]; lt[i * 3 + 2] = c[2];
    });
    this.lampMesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: lamp.positions },
        { name: 'aNormal', loc: LOC.normal, size: 3, data: lamp.normals },
        { name: 'aPart', loc: LOC.part, size: 1, data: lamp.parts },
        { name: 'iPos', loc: LOC.ipos, size: 3, data: lp, divisor: 1 },
        { name: 'iYaw', loc: LOC.isize, size: 1, data: ly, divisor: 1 },
        { name: 'iTint', loc: LOC.icolor, size: 3, data: lt, divisor: 1 },
      ],
      indices: lamp.indices,
    });
    this.lampCount = city.lamps.length;

    // Street furniture: lamp program, one mesh per kind so tint varies.
    this.props = [];
    for (const kind of PROP_KINDS) {
      const list = (city.props || []).filter((q) => q.kind === kind.id);
      if (!list.length) continue;
      const geo = kind.build();
      const pp = new Float32Array(list.length * 3);
      const py = new Float32Array(list.length);
      const pt = new Float32Array(list.length * 3);
      list.forEach((q, i) => {
        pp[i * 3] = q.x; pp[i * 3 + 1] = q.y || 0; pp[i * 3 + 2] = q.z;
        py[i] = q.yaw;
        pt[i * 3] = q.tint[0]; pt[i * 3 + 1] = q.tint[1]; pt[i * 3 + 2] = q.tint[2];
      });
      this.props.push({
        mesh: makeMesh(gl, {
          attributes: [
            { name: 'aPos', loc: LOC.pos, size: 3, data: geo.positions },
            { name: 'aNormal', loc: LOC.normal, size: 3, data: geo.normals },
            { name: 'aPart', loc: LOC.part, size: 1, data: geo.parts },
            { name: 'iPos', loc: LOC.ipos, size: 3, data: pp, divisor: 1 },
            { name: 'iYaw', loc: LOC.isize, size: 1, data: py, divisor: 1 },
            { name: 'iTint', loc: LOC.icolor, size: 3, data: pt, divisor: 1 },
          ],
          indices: geo.indices,
        }),
        count: list.length,
      });
    }

    this.groundProg = createProgram(gl, GROUND_VS, GROUND_FS, { aPos: LOC.pos });
    this.buildProg = createProgram(gl, BUILD_VS, BUILD_FS, {
      aPos: LOC.pos, aNormal: LOC.normal, iPos: LOC.ipos, iSize: LOC.isize,
      iColor: LOC.icolor, iParam: LOC.iparam,
    });
    this.signProg = createProgram(gl, SIGN_VS, SIGN_FS, {
      aPos: LOC.pos, iYaw: LOC.normal, iPos: LOC.ipos, iSize: LOC.isize,
      iColor: LOC.icolor, iUv: LOC.iparam,
    });
    this.lampProg = createProgram(gl, LAMP_VS, LAMP_FS, {
      aPos: LOC.pos, aNormal: LOC.normal, aPart: LOC.part, iPos: LOC.ipos,
      iYaw: LOC.isize, iTint: LOC.icolor,
    });

    // Staged and uploaded every frame, so these arrays live on the renderer.
    this._lightPos = new Float32Array(6);
    this._lightCol = new Float32Array(6);
    this._lightOn = new Float32Array(2);
  }

  // Per-pass prologue: view-projection, eye position and the fog ramp.
  _frame(p, cam, vp) {
    const gl = this.gl;
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
  }

  drawGround(cam, vp, scene, time) {
    const gl = this.gl;
    const p = this.groundProg;
    const lights = scene.lights;
    p.use();
    this._frame(p, cam, vp);
    gl.uniform1f(p.u('uBlock'), this.city.block);
    gl.uniform1f(p.u('uHalfRoad'), this.city.halfRoad);
    gl.uniform1f(p.u('uWalk'), this.city.walk);
    gl.uniform1f(p.u('uTime'), time || 0);

    const head = (scene && scene.headlight) || { x: 0, z: 0, dx: 0, dz: 1, on: 0 };
    gl.uniform3f(p.u('uHeadPos'), head.x, 0, head.z);
    gl.uniform2f(p.u('uHeadDir'), head.dx, head.dz);
    gl.uniform1f(p.u('uHeadOn'), head.on);

    const pos = this._lightPos;
    const col = this._lightCol;
    const on = this._lightOn;
    for (let i = 0; i < 2; i++) {
      const L = lights[i];
      if (L) {
        pos[i * 3] = L.pos[0]; pos[i * 3 + 1] = L.pos[1]; pos[i * 3 + 2] = L.pos[2];
        col[i * 3] = L.color[0]; col[i * 3 + 1] = L.color[1]; col[i * 3 + 2] = L.color[2];
        on[i] = L.on ?? 1;
      } else {
        // Reused buffers: an empty slot must be cleared or it keeps last frame.
        pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
        col[i * 3] = 0; col[i * 3 + 1] = 0; col[i * 3 + 2] = 0;
        on[i] = 0;
      }
    }
    gl.uniform3fv(p.u('uLightPos'), pos);
    gl.uniform3fv(p.u('uLightCol'), col);
    gl.uniform1fv(p.u('uLightOn'), on);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.uniform1i(p.u('uNoise'), 0);
    drawMesh(gl, this.ground);
  }

  drawBuildings(cam, vp) {
    const gl = this.gl;
    const p = this.buildProg;
    p.use();
    this._frame(p, cam, vp);
    drawMesh(gl, this.buildingMesh, this.buildingCount);
  }

  drawSigns(cam, vp) {
    const gl = this.gl;
    const p = this.signProg;
    p.use();
    this._frame(p, cam, vp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(p.u('uAtlas'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawMesh(gl, this.signMesh, this.signCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawLamps(cam, vp) {
    const gl = this.gl;
    const p = this.lampProg;
    p.use();
    this._frame(p, cam, vp);
    drawMesh(gl, this.lampMesh, this.lampCount);
  }

  drawProps(cam, vp) {
    if (!this.props.length) return;
    const gl = this.gl;
    const p = this.lampProg;
    p.use();
    this._frame(p, cam, vp);
    for (const batch of this.props) drawMesh(gl, batch.mesh, batch.count);
  }

  addGlows(glows, cam, range = 175) {
    const r2 = range * range;
    for (const L of this.city.lamps) {
      const dx = L.headX - cam.eye[0];
      const dz = L.headZ - cam.eye[2];
      if (dx * dx + dz * dz > r2) continue;
      // Core and halo take the fitting's colour, matching the pool below.
      const c = L.color || LAMP_WARM;
      glows.add(L.headX, L.headY, L.headZ, 3.4, c, 0.85);
      glows.add(L.headX, L.headY - 0.35, L.headZ, 7.0,
        [c[0] * 0.95, c[1] * 0.82, c[2] * 0.70], 0.16);
    }
    for (const s of this.city.signs) {
      const dx = s.x - cam.eye[0];
      const dz = s.z - cam.eye[2];
      if (dx * dx + dz * dz > r2) continue;
      const c = hexToRgb(s.color, [0, 0, 0]);
      glows.add(s.x, s.y + s.h * 0.5, s.z, s.w * 1.35, c, 0.42);
    }
  }
}

function hexToRgb(hex, out) {
  const v = parseInt(hex.slice(1), 16);
  out[0] = ((v >> 16) & 255) / 255;
  out[1] = ((v >> 8) & 255) / 255;
  out[2] = (v & 255) / 255;
  return out;
}

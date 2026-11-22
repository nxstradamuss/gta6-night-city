// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// The district: a grid of blocks with towers, wet asphalt, neon signage and
// street lamps. Geometry is instanced and the windows are computed per pixel,
// so a whole city of thousands of lit windows costs a handful of draw calls.

import { CONFIG, NEON } from './config.js';
import { LOC, GLSL_HASH, createProgram, makeMesh, drawMesh } from './gl.js';
import { clamp, TAU } from './math.js';
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

// ----------------------------------------------------------- generation ----

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
      const core = Math.pow(clamp(1 - dist * 1.05, 0, 1), 1.4);

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

  // Street lamps down every avenue, arm reaching out over the asphalt.
  const spacing = B * 0.5;
  const armLen = 2.7;
  for (let k = -R; k <= R; k++) {
    const line = k * B;
    for (let t = -R; t < R; t++) {
      const along = t * spacing + spacing * 0.5;
      if (Math.abs(along) > R * B + 4) continue;
      // Keep the junction mouths clear.
      if (Math.abs(along - Math.round(along / B) * B) < halfRoad + 1.5) continue;

      for (const side of [-1, 1]) {
        const off = side * (halfRoad + 1.6);
        // Along a north-south road the arm must point back at the centreline.
        const yawZ = side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
        lamps.push({
          x: line + off, z: along, yaw: yawZ,
          headX: line + off + Math.sin(yawZ) * armLen, headZ: along + Math.cos(yawZ) * armLen, headY: 6.9,
        });
        // Along an east-west road: arm points along -Z or +Z.
        const yawX = side > 0 ? Math.PI : 0;
        lamps.push({
          x: along, z: line + off, yaw: yawX,
          headX: along + Math.sin(yawX) * armLen, headZ: line + off + Math.cos(yawX) * armLen, headY: 6.9,
        });
      }
    }
  }

  // Street furniture on the pavements: bollards, bins, hydrants, planters,
  // cones, crates and benches, plus the plant rooms, tanks and aerials that
  // break up the skyline. Drawn after the lamps with the same program.
  const props = buildStreetProps(rng, { block: B, halfRoad, walk, reach: R + 1 })
    .concat(buildRoofProps(rng, buildings));
  // Rooftop clutter is appended to the same list: the pavements and the roofs
  // share one instanced batch, so the skyline gains detail without a new draw
  // call or a second shader program.

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

// -------------------------------------------------------------- geometry ---

const BOX_FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
];

function box01() {
  const P = [];
  const N = [];
  const I = [];
  for (const f of BOX_FACES) {
    const base = P.length / 3;
    for (const v of f.v) {
      P.push(v[0], v[1], v[2]);
      N.push(f.n[0], f.n[1], f.n[2]);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    indices: new Uint16Array(I),
  };
}

function lampGeometry() {
  const P = [];
  const N = [];
  const PT = [];
  const I = [];

  const box = (cx, cy, cz, sx, sy, sz, part) => {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (const f of BOX_FACES) {
      const base = P.length / 3;
      for (const v of f.v) {
        P.push(cx + (v[0] * 2 - 1) * hx, cy + (v[1] * 2 - 1) * hy, cz + (v[2] * 2 - 1) * hz);
        N.push(f.n[0], f.n[1], f.n[2]);
        PT.push(part);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

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

// --------------------------------------------------------------- shaders ---

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

  vec3 n1 = texture(uNoise, p * 0.035).rgb;
  vec3 n2 = texture(uNoise, p * 0.145).rgb;
  float grain = n1.r * 0.6 + n2.g * 0.4;
  float wet = smoothstep(0.52, 0.80, n2.b) * 0.75 + 0.25;

  vec3 col = vec3(0.050, 0.053, 0.066) * (0.72 + 0.62 * grain);
  col += vec3(0.014, 0.015, 0.022) * n2.r;

  // Asphalt that has actually been driven on: two polished tyre tracks per
  // carriageway, a scatter of darker tar patches, and a fine aggregate speckle.
  // Three cheap multiplications and the surface stops reading as flat grey.
  float track = smoothstep(0.62, 0.06, abs(abs(across - halfRoad * 0.52) - 0.95));
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

  // Neon bleeding onto the wet asphalt from the shopfronts either side.
  vec2 cell = floor(p / B);
  float h1 = hash21(cell + 3.1);
  vec3 tint = mix(vec3(1.0, 0.18, 0.55), vec3(0.15, 0.85, 1.0), step(0.5, h1));
  tint = mix(tint, vec3(1.0, 0.55, 0.15), step(0.87, h1));
  float curb = smoothstep(halfRoad + 6.0, halfRoad - 3.0, across);
  col += tint * curb * (0.045 + wet * 0.085);

  // Road paint: double yellow centre, dashed lane dividers.
  float centre = smoothstep(0.34, 0.20, abs(across - 0.38));
  float dash = step(0.45, fract(along / 13.0)) * smoothstep(0.30, 0.16, abs(across - halfRoad * 0.52));
  float road = step(across, halfRoad);
  col = mix(col, vec3(0.42, 0.34, 0.10) * (0.5 + 0.5 * grain), centre * road * 0.85);
  col = mix(col, vec3(0.40, 0.42, 0.45) * (0.5 + 0.5 * grain), dash * road * 0.55);

  // Zebra crossings just outside each intersection.
  float inX = step(dx, halfRoad);
  float inZ = step(dz, halfRoad);
  float crossZ = inX * step(halfRoad, dz) * step(dz, halfRoad + 3.4);
  float crossX = inZ * step(halfRoad, dx) * step(dx, halfRoad + 3.4);
  float zebra = step(0.42, fract((vert ? p.x : p.y) / 1.9));
  col = mix(col, vec3(0.42, 0.44, 0.48), max(crossZ, crossX) * zebra * 0.45);

  // Wet reflections: every lit facade smears into long vertical streaks across
  // the asphalt. A planar mirror pass would cost a whole extra render target,
  // so this fakes it from the same hash that drives the windows -- and it is
  // the single strongest read of "raining night" in the frame.
  float dEdge = max(across - halfRoad, 0.0);
  float streakCell = floor(along / 1.45);
  float sh1 = hash11(streakCell * 1.73 + cell.x * 3.1 + cell.y * 7.7);
  float sh2 = hash11(streakCell * 5.11 + cell.x * 1.9 + cell.y * 2.3);
  float streakOn = step(0.40, sh1);
  float streakFall = exp(-dEdge * 0.17) * smoothstep(0.0, 1.1, dEdge);
  vec3 streakCol = mix(vec3(1.0, 0.78, 0.46), vec3(0.52, 0.84, 1.0), step(0.55, sh2));
  streakCol = mix(streakCol, tint, 0.35);
  col += streakCol * streakOn * streakFall * (0.30 + wet * 0.95) * road * (0.55 + 0.45 * grain);

  // Rain landing in standing water: rings that bloom and die per puddle cell.
  vec2 rc = p * 2.4;
  vec2 rid = floor(rc);
  vec2 rf = fract(rc) - 0.5;
  float phase = fract(uTime * 1.55 + hash21(rid) * 9.0);
  float ring = smoothstep(0.055, 0.0, abs(length(rf) - phase * 0.44)) * (1.0 - phase);
  col += vec3(0.50, 0.66, 0.92) * ring * (0.10 + wet * 0.30) * road;

  // Headlight wedge: two soft cones thrown forward from the player car, with a
  // hot spot right at the nose and a long tail that the wet asphalt picks up.
  vec2 hp = vWorld.xz - uHeadPos.xz;
  float hFwd = dot(hp, uHeadDir);
  float hSide = abs(hp.x * uHeadDir.y - hp.y * uHeadDir.x);
  float wedge = smoothstep(0.0, 2.2, hFwd) * smoothstep(30.0, 6.0, hFwd);
  wedge *= smoothstep(8.5, 1.2, hSide + max(hFwd, 0.0) * 0.30);
  col += vec3(1.0, 0.93, 0.76) * wedge * uHeadOn * (0.36 + wet * 0.70);

  // Standing water. Where the noise field says a puddle sits, the asphalt turns
  // into a shallow mirror that picks up the sky and the neon hanging above it.
  float pool = smoothstep(0.56, 0.80, n2.b) * road;
  vec3 sky = mix(vec3(0.09, 0.13, 0.24), tint, 0.30);
  col = mix(col, sky + col * 0.35, pool * 0.55);

  // Kerb and pavement.
  float pavement = step(halfRoad, across) * step(across, halfRoad + uWalk);
  float tiles = smoothstep(0.94, 1.0, abs(fract(along / 2.0) - 0.5) * 2.0);
  vec3 pave = vec3(0.082, 0.084, 0.095) * (0.8 + 0.5 * grain);
  pave -= tiles * 0.012;
  pave += tint * 0.030;
  col = mix(col, pave, pavement);

  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.92);

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

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  float style = vParam.x;
  float seed = vParam.y;

  // Facade base: cold ambient sky light plus a warm bounce off the street.
  float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 amb = mix(vec3(0.085, 0.075, 0.115), vec3(0.020, 0.028, 0.062), up);
  vec3 col = vColor * (amb * 3.8 + 0.07);
  col += vec3(0.16, 0.09, 0.20) * pow(1.0 - abs(dot(N, V)), 2.5) * 0.7;

  if (N.y > 0.5) {
    // Roof: dark tar with a hint of gravel.
    col = vColor * 0.5 + vec3(0.02, 0.02, 0.025) * hash31(vec3(vWorld.xz * 0.5, seed));
    fragColor = vec4(col, 1.0);
    float fd = length(vWorld - uCam);
    float ff = clamp((fd - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
    fragColor.rgb = mix(fragColor.rgb, uFogColor, ff * ff * 0.9);
    return;
  }

  float dist = length(vWorld - uCam);

  // Near-field falloff for the thin neon/roof strips: a strip a couple of
  // metres from the eye would otherwise clip to a flat white bar.
  float nearFade = smoothstep(2.5, 16.0, dist);

  // Window emissive is authored well above the tonemap knee (inten 1.15..2.65)
  // so that distant windows read as hot white dots. That is fine while a window
  // is a few pixels across, but a window that is magnified to tens of pixels -
  // or a whole slab of them - clips to a featureless white block, and one that
  // straddles the frame edge reads as a white bar. Taper the emissive by the
  // screen height of one floor cell so only genuinely small windows stay hot.
  float pxPerMetre = 1.0 / max(fwidth(vWorld.y), 1e-5);
  float cellPx = 3.55 * pxPerMetre;
  float sizeFade = 1.0 - smoothstep(20.0, 74.0, cellPx);

  float u = abs(N.x) > 0.5 ? vWorld.z : vWorld.x;
  float edge = abs(N.x) > 0.5
    ? min(vLocal.z, 1.0 - vLocal.z) * vSize.z
    : min(vLocal.x, 1.0 - vLocal.x) * vSize.x;

  // Window grid: one cell per floor, one per column. Both pitch and the window
  // rectangle are keyed off the building seed, so a block of towers reads as a
  // row of different buildings instead of the same texture tiled sideways.
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

  // Structure the eye can hold onto: a recessed shadow line under every floor
  // slab, pilasters every third bay, and vertical rain grime streaking down the
  // facade. This is what stops a lit grid from reading as flat wallpaper.
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
  // Whole floors sometimes go dark, which breaks up the regularity.
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

  // Neon trim: corner strips on the flashier buildings, roofline on the tall ones.
  if (style > 1.5) {
    float strip = smoothstep(0.55, 0.12, edge);
    vec3 neon = mix(vec3(1.0, 0.16, 0.62), vec3(0.16, 0.88, 1.0), step(0.5, hash11(seed)));
    // Same story as the windows: a strip that is a thin line at distance becomes
    // a wide slab when the building is close, so taper it by its on-screen width.
    float edgePx = 0.43 / max(fwidth(edge), 1e-5);
    float stripFade = 1.0 - smoothstep(6.0, 22.0, edgePx);
    col += neon * strip * 1.35 * nearFade * stripFade;
  }
  float roofTrim = smoothstep(0.985, 1.0, vLocal.y) * step(28.0, vSize.y);
  col += vec3(0.55, 0.70, 1.0) * roofTrim * 0.9 * nearFade;

  // Antenna/AC silhouette break on the very top edge.
  col *= 1.0 - smoothstep(0.995, 1.0, vLocal.y) * 0.35;

  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.92);
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
void main() {
  vec4 t = texture(uAtlas, vUv);
  float a = t.a;
  if (a < 0.01) discard;
  vec3 col = t.rgb * vColor * 1.5;
  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.9);
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
void main() {
  vec3 col;
  if (vPart > 0.5) {
    // Emissive: lamp heads, bollard tops, cone bands, hydrant caps.
    col = vec3(1.15, 0.95, 0.62) * vTint;
  } else {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCam - vWorld);
    float d = max(dot(N, normalize(vec3(0.3, 0.8, 0.4))), 0.0);
    col = vec3(0.045, 0.048, 0.058) + vec3(0.30) * pow(max(dot(N, V), 0.0), 6.0);
    col *= 0.8 + 0.5 * d;
    col *= vTint;
  }
  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog * 0.9);
  fragColor = vec4(col, 1.0);
}`;

// --------------------------------------------------------------- atlas -----

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

// -------------------------------------------------------------- renderer ---

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
        { name: 'aPos', loc: LOC.pos, size: 2, data: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]) },
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
    const lt = new Float32Array(city.lamps.length * 3).fill(1);
    city.lamps.forEach((L, i) => {
      lp[i * 3] = L.x; lp[i * 3 + 1] = 0; lp[i * 3 + 2] = L.z;
      ly[i] = L.yaw;
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

    // Street furniture. Same instanced program as the lamps, one mesh per kind
    // so each instance can carry its own tint without a second shader.
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
  }

  drawGround(cam, vp, scene, time) {
    const gl = this.gl;
    const p = this.groundProg;
    const lights = scene.lights;
    p.use();
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    gl.uniform1f(p.u('uBlock'), this.city.block);
    gl.uniform1f(p.u('uHalfRoad'), this.city.halfRoad);
    gl.uniform1f(p.u('uWalk'), this.city.walk);
    gl.uniform1f(p.u('uTime'), time || 0);

    const head = (scene && scene.headlight) || { x: 0, z: 0, dx: 0, dz: 1, on: 0 };
    gl.uniform3f(p.u('uHeadPos'), head.x, 0, head.z);
    gl.uniform2f(p.u('uHeadDir'), head.dx, head.dz);
    gl.uniform1f(p.u('uHeadOn'), head.on);

    const pos = new Float32Array(6);
    const col = new Float32Array(6);
    const on = new Float32Array(2);
    for (let i = 0; i < 2; i++) {
      const L = lights[i];
      if (L) {
        pos[i * 3] = L.pos[0]; pos[i * 3 + 1] = L.pos[1]; pos[i * 3 + 2] = L.pos[2];
        col[i * 3] = L.color[0]; col[i * 3 + 1] = L.color[1]; col[i * 3 + 2] = L.color[2];
        on[i] = L.on ?? 1;
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
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    drawMesh(gl, this.buildingMesh, this.buildingCount);
  }

  drawSigns(cam, vp) {
    const gl = this.gl;
    const p = this.signProg;
    p.use();
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
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
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    drawMesh(gl, this.lampMesh, this.lampCount);
  }

  drawProps(cam, vp) {
    if (!this.props.length) return;
    const gl = this.gl;
    const p = this.lampProg;
    p.use();
    gl.uniformMatrix4fv(p.u('uVP'), false, vp);
    gl.uniform3fv(p.u('uCam'), cam.eye);
    gl.uniform3fv(p.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(p.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    for (const batch of this.props) drawMesh(gl, batch.mesh, batch.count);
  }

  addGlows(glows, cam, range = 175) {
    const r2 = range * range;
    for (const L of this.city.lamps) {
      const dx = L.headX - cam.eye[0];
      const dz = L.headZ - cam.eye[2];
      if (dx * dx + dz * dz > r2) continue;
      glows.add(L.headX, L.headY, L.headZ, 3.4, [1.0, 0.72, 0.36], 0.85);
      glows.add(L.headX, L.headY - 0.35, L.headZ, 7.0, [1.0, 0.55, 0.22], 0.16);
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

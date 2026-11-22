// Street furniture: the small stuff that makes a block read as a place rather
// than a corridor. Every prop is one instanced mesh sharing the lamp shader, so
// a hundred bins and hydrants cost five draw calls, not a hundred.
//
// Geometry is built in local space with y = 0 at the pavement, then each
// instance is placed with a yaw and a tint. `part > 0.5` marks the emissive
// sub-shapes (bollard caps, cone bands) that the shader lifts to full brightness.

const TAU = Math.PI * 2;

function boxInto(P, N, PT, I, cx, cy, cz, sx, sy, sz, part) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces = [
    { n: [0, 1, 0], v: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
    { n: [0, -1, 0], v: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
    { n: [1, 0, 0], v: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
    { n: [-1, 0, 0], v: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] },
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ];
  for (const f of faces) {
    const base = P.length / 3;
    for (const v of f.v) {
      P.push(cx + (v[0] * 2 - 1) * hx, cy + (v[1] * 2 - 1) * hy, cz + (v[2] * 2 - 1) * hz);
      N.push(f.n[0], f.n[1], f.n[2]);
      PT.push(part);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function cylInto(P, N, PT, I, cx, cy, cz, rBot, rTop, h, part, seg = 10) {
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * TAU;
    const a1 = ((s + 1) / seg) * TAU;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const base = P.length / 3;
    // Side quad, normal leaning out along the taper.
    const ny = (rBot - rTop) / Math.max(h, 1e-3);
    const n0 = [c0, ny, s0];
    const n1 = [c1, ny, s1];
    const l0 = Math.hypot(n0[0], n0[1], n0[2]) || 1;
    const l1 = Math.hypot(n1[0], n1[1], n1[2]) || 1;
    P.push(cx + c0 * rBot, y0, cz + s0 * rBot);
    N.push(n0[0] / l0, n0[1] / l0, n0[2] / l0);
    PT.push(part);
    P.push(cx + c1 * rBot, y0, cz + s1 * rBot);
    N.push(n1[0] / l1, n1[1] / l1, n1[2] / l1);
    PT.push(part);
    P.push(cx + c1 * rTop, y1, cz + s1 * rTop);
    N.push(n1[0] / l1, n1[1] / l1, n1[2] / l1);
    PT.push(part);
    P.push(cx + c0 * rTop, y1, cz + s0 * rTop);
    N.push(n0[0] / l0, n0[1] / l0, n0[2] / l0);
    PT.push(part);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    // Caps as fans, only where the radius is non-zero.
    if (rTop > 1e-4) {
      const tBase = P.length / 3;
      P.push(cx, y1, cz);
      N.push(0, 1, 0);
      PT.push(part);
      P.push(cx + c0 * rTop, y1, cz + s0 * rTop);
      N.push(0, 1, 0);
      PT.push(part);
      P.push(cx + c1 * rTop, y1, cz + s1 * rTop);
      N.push(0, 1, 0);
      PT.push(part);
      I.push(tBase, tBase + 1, tBase + 2);
    }
  }
}

function finish(P, N, PT, I) {
  return {
    positions: new Float32Array(P),
    normals: new Float32Array(N),
    parts: new Float32Array(PT),
    indices: new Uint16Array(I),
  };
}

// One entry per prop kind. `build` returns geometry in local space; `tint` is a
// palette the placer picks from, weighted by repetition.
export const PROP_KINDS = [
  {
    id: 'bollard',
    weight: 26,
    tint: [[0.16, 0.17, 0.19], [0.13, 0.14, 0.16]],
    build() {
      const P = [], N = [], PT = [], I = [];
      cylInto(P, N, PT, I, 0, 0.48, 0, 0.10, 0.09, 0.96, 0, 8);
      cylInto(P, N, PT, I, 0, 0.99, 0, 0.115, 0.10, 0.07, 1, 8);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'bin',
    weight: 16,
    tint: [[0.10, 0.20, 0.13], [0.16, 0.15, 0.14], [0.11, 0.14, 0.19]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.46, 0, 0.60, 0.92, 0.60, 0);
      boxInto(P, N, PT, I, 0, 0.95, 0, 0.66, 0.08, 0.66, 0);
      boxInto(P, N, PT, I, 0, 0.20, 0, 0.63, 0.05, 0.63, 0);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'hydrant',
    weight: 8,
    tint: [[0.62, 0.11, 0.08], [0.58, 0.42, 0.06]],
    build() {
      const P = [], N = [], PT = [], I = [];
      cylInto(P, N, PT, I, 0, 0.30, 0, 0.15, 0.13, 0.60, 0, 8);
      cylInto(P, N, PT, I, 0, 0.62, 0, 0.17, 0.10, 0.10, 0, 8);
      cylInto(P, N, PT, I, 0, 0.72, 0, 0.06, 0.05, 0.10, 0, 6);
      boxInto(P, N, PT, I, 0, 0.42, 0.17, 0.10, 0.10, 0.12, 0);
      boxInto(P, N, PT, I, 0, 0.42, -0.17, 0.10, 0.10, 0.12, 0);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'planter',
    weight: 12,
    tint: [[0.21, 0.20, 0.19], [0.17, 0.18, 0.20]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.28, 0, 0.92, 0.56, 0.92, 0);
      boxInto(P, N, PT, I, 0, 0.575, 0, 0.80, 0.05, 0.80, 0);
      // A low hedge so the planter reads as green rather than as a grey cube.
      boxInto(P, N, PT, I, 0, 0.70, 0, 0.78, 0.22, 0.78, 0);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'cone',
    weight: 14,
    tint: [[0.95, 0.34, 0.04], [0.90, 0.62, 0.05]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.025, 0, 0.42, 0.05, 0.42, 0);
      cylInto(P, N, PT, I, 0, 0.33, 0, 0.19, 0.045, 0.60, 0, 10);
      cylInto(P, N, PT, I, 0, 0.30, 0, 0.163, 0.135, 0.11, 1, 10);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'crate',
    weight: 10,
    tint: [[0.20, 0.14, 0.09], [0.15, 0.16, 0.18], [0.26, 0.20, 0.12]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.26, 0, 0.62, 0.52, 0.50, 0);
      boxInto(P, N, PT, I, 0.06, 0.62, 0.04, 0.44, 0.20, 0.40, 0);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'bench',
    weight: 10,
    tint: [[0.24, 0.18, 0.12], [0.19, 0.20, 0.22]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.44, 0, 1.70, 0.08, 0.46, 0);
      boxInto(P, N, PT, I, 0, 0.72, -0.20, 1.70, 0.44, 0.07, 0);
      boxInto(P, N, PT, I, -0.72, 0.22, 0, 0.09, 0.44, 0.42, 0);
      boxInto(P, N, PT, I, 0.72, 0.22, 0, 0.09, 0.44, 0.42, 0);
      return finish(P, N, PT, I);
    },
  },
  {
    // Rooftop kinds carry weight 0: pickKind skips them, so street scatter never
    // puts an air-conditioning unit on a pavement, while buildRoofProps can still
    // place them by id on top of the buildings.
    id: 'ac',
    weight: 0,
    tint: [[0.30, 0.31, 0.33], [0.22, 0.23, 0.25], [0.34, 0.30, 0.26]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.42, 0, 1.30, 0.84, 0.95, 0);
      boxInto(P, N, PT, I, 0, 0.88, 0, 1.14, 0.10, 0.80, 1);
      cylInto(P, N, PT, I, 0, 0.94, 0, 0.34, 0.34, 0.06, 1, 10);
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'tank',
    weight: 0,
    tint: [[0.26, 0.20, 0.14], [0.18, 0.19, 0.21]],
    build() {
      const P = [], N = [], PT = [], I = [];
      cylInto(P, N, PT, I, 0, 1.30, 0, 0.55, 0.55, 1.70, 0, 12);
      cylInto(P, N, PT, I, 0, 2.18, 0, 0.58, 0.50, 0.16, 1, 12);
      for (const a of [0, 1, 2, 3]) {
        const th = (a / 4) * Math.PI * 2 + 0.4;
        boxInto(P, N, PT, I, Math.cos(th) * 0.42, 0.22, Math.sin(th) * 0.42, 0.10, 0.44, 0.10, 1);
      }
      return finish(P, N, PT, I);
    },
  },
  {
    id: 'antenna',
    weight: 0,
    tint: [[0.20, 0.21, 0.23], [0.14, 0.15, 0.17]],
    build() {
      const P = [], N = [], PT = [], I = [];
      boxInto(P, N, PT, I, 0, 0.12, 0, 0.44, 0.24, 0.44, 1);
      boxInto(P, N, PT, I, 0, 1.60, 0, 0.08, 3.10, 0.08, 0);
      for (const y of [2.05, 2.55, 3.00]) {
        boxInto(P, N, PT, I, 0, y, 0, 0.86 - (y - 2.0) * 0.5, 0.05, 0.05, 0);
      }
      return finish(P, N, PT, I);
    },
  },
];

const KIND_BY_ID = new Map(PROP_KINDS.map((k) => [k.id, k]));
const WEIGHT_TOTAL = PROP_KINDS.reduce((a, k) => a + k.weight, 0);

function pickKind(r) {
  let x = r * WEIGHT_TOTAL;
  for (const k of PROP_KINDS) {
    if (k.weight <= 0) continue;
    x -= k.weight;
    if (x <= 0) return k;
  }
  return PROP_KINDS[0];
}

// Rooftop clutter: plant rooms, water tanks and aerials. A skyline of bare boxes
// reads as a model; the silhouette is what sells it as a city, so each building
// gets one or two things growing out of its roof.
export function buildRoofProps(rng, buildings) {
  const out = [];
  const roofKinds = ['ac', 'tank', 'antenna'];
  for (const b of buildings) {
    const n = b.h > 42 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const id = roofKinds[rng.int(roofKinds.length)];
      const inset = 0.28;
      const x = b.x0 + (b.x1 - b.x0) * (inset + rng.float(0, 1 - inset * 2));
      const z = b.z0 + (b.z1 - b.z0) * (inset + rng.float(0, 1 - inset * 2));
      out.push({
        kind: id,
        x, z,
        y: b.h,
        yaw: rng.int(4) * (Math.PI / 2),
        tint: PROP_KINDS.find((k) => k.id === id).tint[0],
      });
    }
  }
  return out;
}

// Scatter props along the pavements of every avenue, between the lamps and
// clear of the junction mouths. Everything comes from the city's own rng, so a
// given ?seed=N always lays out the same street furniture.
export function buildStreetProps(rng, { block: B, halfRoad, walk, reach: R }) {
  const out = [];
  const step = B * 0.125;
  for (let k = -R; k <= R; k++) {
    const line = k * B;
    for (let t = -R * 8; t < R * 8; t++) {
      const along = t * step;
      if (Math.abs(along) > R * B + 4) continue;
      if (Math.abs(along - Math.round(along / B) * B) < halfRoad + 1.2) continue;
      for (const side of [-1, 1]) {
        if (rng.float(0, 1) > 0.44) continue;
        const off = side * (halfRoad + rng.float(0.75, walk - 0.35));
        const kind = pickKind(rng.float(0, 1));
        const yaw = Math.round(rng.float(0, 4)) * (Math.PI / 2);
        // North-south avenue: props hug the kerb at x = line + off.
        out.push({
          kind: kind.id,
          x: line + off,
          z: along + rng.float(-0.5, 0.5),
          yaw,
          tint: kind.tint[rng.int(kind.tint.length)],
        });
        // East-west avenue: the same scatter rotated onto the cross street.
        if (rng.float(0, 1) < 0.55) {
          const kind2 = pickKind(rng.float(0, 1));
          out.push({
            kind: kind2.id,
            x: along + rng.float(-0.5, 0.5),
            z: line + off,
            yaw: Math.round(rng.float(0, 4)) * (Math.PI / 2),
            tint: kind2.tint[rng.int(kind2.tint.length)],
          });
        }
      }
    }
  }
  return out;
}

export function propKindCount() {
  return KIND_BY_ID.size;
}

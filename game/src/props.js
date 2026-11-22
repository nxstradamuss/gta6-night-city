// Street furniture: a kind per instanced mesh on the lamp shader.

import { pushBox } from './geom.js';

const TAU = Math.PI * 2;

const box = (g, ...a) => pushBox(g.P, g.N, g.PT, g.I, ...a);

function cyl(g, cx, cy, cz, rBot, rTop, h, part, seg = 10) {
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  // One normal for the whole taper: the wall leans out by (rBot - rTop) / h.
  const lean = (rBot - rTop) / Math.max(h, 1e-3);
  const l = Math.hypot(1, lean);
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * TAU;
    const a1 = ((s + 1) / seg) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const base = g.P.length / 3;
    g.P.push(cx + c0 * rBot, y0, cz + s0 * rBot);
    g.P.push(cx + c1 * rBot, y0, cz + s1 * rBot);
    g.P.push(cx + c1 * rTop, y1, cz + s1 * rTop);
    g.P.push(cx + c0 * rTop, y1, cz + s0 * rTop);
    for (const [nx, nz] of [[c0, s0], [c1, s1], [c1, s1], [c0, s0]]) {
      g.N.push(nx / l, lean / l, nz / l);
      g.PT.push(part);
    }
    g.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    // Top cap as a fan, skipped when the taper closes to a point.
    if (rTop > 1e-4) {
      const t = g.P.length / 3;
      g.P.push(cx, y1, cz, cx + c0 * rTop, y1, cz + s0 * rTop, cx + c1 * rTop, y1, cz + s1 * rTop);
      g.N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      g.PT.push(part, part, part);
      g.I.push(t, t + 1, t + 2);
    }
  }
}

const finish = (g) => ({
  positions: new Float32Array(g.P),
  normals: new Float32Array(g.N),
  parts: new Float32Array(g.PT),
  indices: new Uint16Array(g.I),
});

// A kind is a palette plus a shape function; the wrapper owns the buffers.
const K = (id, weight, tint, shapes) => ({
  id,
  weight,
  tint,
  build() {
    const g = { P: [], N: [], PT: [], I: [] };
    shapes(g);
    return finish(g);
  },
});

export const PROP_KINDS = [
  // Slender, 1:5 — the thing you brush past on the kerb.
  K('bollard', 24, [[0.16, 0.17, 0.19], [0.13, 0.14, 0.16]], (g) => {
    cyl(g, 0, 0.46, 0, 0.095, 0.085, 0.92, 0, 8);
    cyl(g, 0, 0.95, 0, 0.11, 0.095, 0.07, 1, 8);
  }),
  // Squat drum: lid overhangs the body, wide foot so it sits heavy.
  K('bin', 15, [[0.10, 0.20, 0.13], [0.16, 0.15, 0.14], [0.11, 0.14, 0.19]], (g) => {
    box(g, 0, 0.44, 0, 0.56, 0.84, 0.56, 0);
    box(g, 0, 0.90, 0, 0.64, 0.09, 0.64, 0);
    box(g, 0, 0.19, 0, 0.59, 0.05, 0.59, 0);
  }),
  // Stubby and bottom-heavy: 0.34 wide against 0.77 tall, two side nozzles.
  K('hydrant', 7, [[0.62, 0.11, 0.08], [0.58, 0.42, 0.06]], (g) => {
    cyl(g, 0, 0.28, 0, 0.16, 0.125, 0.56, 0, 8);
    cyl(g, 0, 0.58, 0, 0.17, 0.10, 0.10, 0, 8);
    cyl(g, 0, 0.69, 0, 0.055, 0.045, 0.12, 0, 6);
    for (const z of [-0.17, 0.17]) box(g, 0, 0.40, z, 0.11, 0.11, 0.13, 0);
  }),
  // Broad and low: as wide as a bench, half the height, hedge on top.
  K('planter', 11, [[0.21, 0.20, 0.19], [0.17, 0.18, 0.20]], (g) => {
    box(g, 0, 0.26, 0, 0.94, 0.52, 0.94, 0);
    box(g, 0, 0.535, 0, 0.82, 0.05, 0.82, 0);
    box(g, 0, 0.66, 0, 0.76, 0.22, 0.76, 0);
  }),
  // Low pyramid: wide foot, sharp taper, one reflective band.
  K('cone', 12, [[0.95, 0.34, 0.04], [0.90, 0.62, 0.05]], (g) => {
    box(g, 0, 0.025, 0, 0.42, 0.05, 0.42, 0);
    cyl(g, 0, 0.33, 0, 0.19, 0.045, 0.60, 0, 10);
    cyl(g, 0, 0.30, 0, 0.163, 0.135, 0.11, 1, 10);
  }),
  // Two crates, offset so the stack never looks mirrored.
  K('crate', 9, [[0.20, 0.14, 0.09], [0.15, 0.16, 0.18], [0.26, 0.20, 0.12]], (g) => {
    box(g, 0, 0.25, 0, 0.62, 0.50, 0.50, 0);
    box(g, 0.06, 0.60, 0.04, 0.44, 0.20, 0.40, 0);
  }),
  // The one long horizontal in the set: 1.7 m of slats on two legs.
  K('bench', 9, [[0.24, 0.18, 0.12], [0.19, 0.20, 0.22]], (g) => {
    box(g, 0, 0.44, 0, 1.70, 0.08, 0.46, 0);
    box(g, 0, 0.72, -0.20, 1.70, 0.44, 0.07, 0);
    for (const x of [-0.72, 0.72]) box(g, x, 0.22, 0, 0.09, 0.44, 0.42, 0);
  }),
  // The only prop with a lit face: a glowing kiosk says shopfront corner.
  K('newsbox', 11, [[0.12, 0.30, 0.52], [0.52, 0.12, 0.16], [0.16, 0.42, 0.30]], (g) => {
    box(g, 0, 0.10, 0, 0.42, 0.20, 0.34, 0);
    box(g, 0, 0.72, 0, 0.46, 1.04, 0.36, 0);
    box(g, 0, 0.86, 0.185, 0.34, 0.46, 0.02, 1);
    box(g, 0, 1.27, 0, 0.50, 0.06, 0.40, 0);
  }),
  // 3.5 m mast, cantilever arm, three lenses: a streetlight in silhouette.
  K('signal', 6, [[0.19, 0.20, 0.22], [0.24, 0.22, 0.19]], (g) => {
    box(g, 0, 0.13, 0, 0.36, 0.26, 0.36, 0);
    cyl(g, 0, 1.80, 0, 0.075, 0.06, 3.40, 0, 8);
    box(g, 0.58, 3.40, 0, 1.24, 0.08, 0.08, 0);
    box(g, 1.12, 3.02, 0, 0.26, 0.74, 0.26, 0);
    for (const y of [3.26, 3.02, 2.78]) box(g, 1.12, y, 0.135, 0.15, 0.15, 0.02, 1);
  }),
  // The one prop you can stand under: roof on four posts, glass back, strip light.
  K('shelter', 4, [[0.20, 0.23, 0.27], [0.16, 0.19, 0.23]], (g) => {
    box(g, 0, 2.48, 0, 2.80, 0.12, 1.40, 0);
    box(g, 0, 2.39, 0, 2.46, 0.05, 1.06, 1);
    for (const x of [-1.30, 1.30]) {
      for (const z of [-0.62, 0.62]) box(g, x, 1.20, z, 0.09, 2.40, 0.09, 0);
    }
    box(g, 0, 1.42, -0.66, 2.72, 1.86, 0.05, 0);
    box(g, 0, 0.46, -0.44, 2.20, 0.07, 0.40, 0);
  }),
  // Roof-only from here down: weight 0 keeps plant rooms off the pavement.
  K('ac', 0, [[0.30, 0.31, 0.33], [0.22, 0.23, 0.25], [0.34, 0.30, 0.26]], (g) => {
    box(g, 0, 0.42, 0, 1.30, 0.84, 0.95, 0);
    box(g, 0, 0.88, 0, 1.14, 0.10, 0.80, 1);
    cyl(g, 0, 0.94, 0, 0.34, 0.34, 0.06, 1, 10);
  }),
  K('tank', 0, [[0.26, 0.20, 0.14], [0.18, 0.19, 0.21]], (g) => {
    cyl(g, 0, 1.30, 0, 0.55, 0.55, 1.70, 0, 12);
    cyl(g, 0, 2.18, 0, 0.58, 0.50, 0.16, 1, 12);
    for (let a = 0; a < 4; a++) {
      const th = (a / 4) * TAU + 0.4;
      box(g, Math.cos(th) * 0.42, 0.22, Math.sin(th) * 0.42, 0.10, 0.44, 0.10, 1);
    }
  }),
  K('antenna', 0, [[0.20, 0.21, 0.23], [0.14, 0.15, 0.17]], (g) => {
    box(g, 0, 0.12, 0, 0.44, 0.24, 0.44, 1);
    box(g, 0, 1.60, 0, 0.08, 3.10, 0.08, 0);
    for (const y of [2.05, 2.55, 3.00]) box(g, 0, y, 0, 0.86 - (y - 2.0) * 0.5, 0.05, 0.05, 0);
  }),
  // Fire escape: two rails and eight rungs — a ladder in silhouette, ten boxes.
  K('ladder', 0, [[0.17, 0.18, 0.20], [0.22, 0.19, 0.16]], (g) => {
    for (const x of [-0.26, 0.26]) box(g, x, 1.70, 0, 0.06, 3.40, 0.06, 0);
    for (let i = 0; i < 8; i++) box(g, 0, 0.32 + i * 0.44, 0, 0.52, 0.04, 0.04, 0);
  }),
];

const KIND_BY_ID = new Map(PROP_KINDS.map((k) => [k.id, k]));
const STREET_KINDS = PROP_KINDS.filter((k) => k.weight > 0);
const WEIGHT_TOTAL = STREET_KINDS.reduce((a, k) => a + k.weight, 0);

function pickKind(r) {
  let x = r * WEIGHT_TOTAL;
  for (const k of STREET_KINDS) {
    x -= k.weight;
    if (x <= 0) return k;
  }
  return STREET_KINDS[STREET_KINDS.length - 1];
}

// Rooftop clutter: every building grows one or two things.
const ROOF_KINDS = ['ac', 'tank', 'antenna', 'ladder'];
const ROOF_INSET = 0.28;

export function buildRoofProps(rng, buildings) {
  const out = [];
  for (const b of buildings) {
    const n = b.h > 42 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const kind = KIND_BY_ID.get(ROOF_KINDS[rng.int(ROOF_KINDS.length)]);
      const x = b.x0 + (b.x1 - b.x0) * (ROOF_INSET + rng.float(0, 1 - ROOF_INSET * 2));
      const z = b.z0 + (b.z1 - b.z0) * (ROOF_INSET + rng.float(0, 1 - ROOF_INSET * 2));
      out.push({ kind: kind.id, x, z, y: b.h, yaw: rng.int(4) * (Math.PI / 2), tint: kind.tint[0] });
    }
  }
  return out;
}

// Scatter props along the pavements, clear of junction mouths, from the city rng.
const QUARTER = Math.PI / 2;
// Fronted kinds turn to look at the road; rolled at random, half would face a wall.
const FRONTED = new Set(['bench', 'shelter', 'newsbox']);

export function buildStreetProps(rng, { block: B, halfRoad, walk, reach: R }) {
  const out = [];
  const step = B * 0.125;
  const limit = R * B + 4;
  for (let k = -R; k <= R; k++) {
    const line = k * B;
    for (let t = -R * 8; t < R * 8; t++) {
      const along = t * step;
      if (Math.abs(along) > limit) continue;
      if (Math.abs(along - Math.round(along / B) * B) < halfRoad + 1.2) continue;
      for (const side of [-1, 1]) {
        if (rng.float(0, 1) > 0.62) continue;
        const off = side * (halfRoad + rng.float(0.75, walk - 0.35));
        const jitter = rng.float(-0.5, 0.5);
        const kind = pickKind(rng.float(0, 1));
        // North-south avenue: road on the -side flank, so turn by -side * 90deg.
        out.push({
          kind: kind.id,
          x: line + off,
          z: along + jitter,
          yaw: FRONTED.has(kind.id) ? -side * QUARTER : rng.int(4) * QUARTER,
          tint: kind.tint[rng.int(kind.tint.length)],
        });
        // East-west avenue: same scatter on the cross street, with its own jitter.
        if (rng.float(0, 1) < 0.55) {
          const kind2 = pickKind(rng.float(0, 1));
          out.push({
            kind: kind2.id,
            x: along + rng.float(-0.5, 0.5),
            z: line + off,
            yaw: FRONTED.has(kind2.id) ? (side < 0 ? 0 : Math.PI) : rng.int(4) * QUARTER,
            tint: kind2.tint[rng.int(kind2.tint.length)],
          });
        }
      }
    }
  }
  return out;
}

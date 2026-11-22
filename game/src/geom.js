// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Shared box geometry: one face table and one indexed emitter, used by the
// city, the street props and the traffic.

// Six quads of a unit cube in -1..1, wound counter-clockwise seen from outside.
export const FACES = [
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

export const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

// Push one axis-aligned box into parallel position/normal/part/index arrays.
export function pushBox(P, N, PT, I, cx, cy, cz, sx, sy, sz, part) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  for (const f of FACES) {
    const base = P.length / 3;
    for (const v of f.v) {
      P.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz);
      N.push(f.n[0], f.n[1], f.n[2]);
      PT.push(part);
    }
    for (const k of QUAD_INDEX) I.push(base + k);
  }
}

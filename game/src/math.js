// Minimal column-major matrix and vector helpers. Only what the game needs:
// no dependencies, no allocation-heavy maths in the frame loop.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// Framerate independent exponential approach.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// ---- vec3 (plain arrays) -------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3len = (a) => Math.hypot(a[0], a[1], a[2]);
export const v3lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export function v3norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function v3cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ---- mat4 ----------------------------------------------------------------

export function m4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function m4identity(out) {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

const _mulTmp = new Float32Array(16);

export function m4mul(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    _mulTmp[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    _mulTmp[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    _mulTmp[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    _mulTmp[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  out.set(_mulTmp);
  return out;
}

export function m4perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}

export function m4lookAt(out, eye, center, up) {
  const z = v3norm(v3sub(eye, center));
  let x = v3cross(up, z);
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = xl < 1e-5 ? [1, 0, 0] : [x[0] / xl, x[1] / xl, x[2] / xl];
  const y = v3cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -v3dot(x, eye); out[13] = -v3dot(y, eye); out[14] = -v3dot(z, eye); out[15] = 1;
  return out;
}

export function m4translate(out, x, y, z) {
  m4identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function m4rotX(out, r) {
  const c = Math.cos(r), s = Math.sin(r);
  m4identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

export function m4rotY(out, r) {
  const c = Math.cos(r), s = Math.sin(r);
  m4identity(out);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

export function m4rotZ(out, r) {
  const c = Math.cos(r), s = Math.sin(r);
  m4identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

// Compose translate * rotY * rotX * rotZ into `out` (no scale needed here).
const _t1 = new Float32Array(16);
const _t2 = new Float32Array(16);
const _t3 = new Float32Array(16);

export function m4trs(out, pos, yaw, pitch, roll) {
  m4translate(out, pos[0], pos[1], pos[2]);
  m4rotY(_t1, yaw);
  m4mul(out, out, _t1);
  if (pitch) {
    m4rotX(_t2, pitch);
    m4mul(out, out, _t2);
  }
  if (roll) {
    m4rotZ(_t3, roll);
    m4mul(out, out, _t3);
  }
  return out;
}

// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Thin WebGL2 helpers: shader compilation with loud errors, VAO/mesh creation
// (static and instanced), textures, framebuffers and draw helpers.

// Attribute locations are fixed across every program so one VAO can be bound
// to any pipeline that shares the same vertex layout.
export const LOC = {
  pos: 0,
  normal: 1,
  uv: 2,
  part: 3,
  ipos: 4,
  isize: 5,
  icolor: 6,
  iparam: 7,
};

export const GLSL_HASH = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'unknown shader error';
    const numbered = source.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    gl.deleteShader(sh);
    throw new Error(`shader compile failed (${type === gl.VERTEX_SHADER ? 'vs' : 'fs'}): ${log}\n${numbered}`);
  }
  return sh;
}

export function createProgram(gl, vsSource, fsSource, bindings = {}) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  for (const name in bindings) gl.bindAttribLocation(prog, bindings[name], name);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'unknown link error';
    gl.deleteProgram(prog);
    throw new Error('program link failed: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const cache = new Map();
  return {
    prog,
    use() {
      gl.useProgram(prog);
      return this;
    },
    u(name) {
      let loc = cache.get(name);
      if (loc === undefined) {
        loc = gl.getUniformLocation(prog, name);
        cache.set(name, loc);
      }
      return loc;
    },
  };
}

// spec: { attributes: [{ name, loc, size, data, divisor?, dynamic?, stride?, offset? }], indices?, mode? }
export function makeMesh(gl, spec) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = {};
  let vertexCount = 0;

  for (const at of spec.attributes) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, at.data, at.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(at.loc);
    gl.vertexAttribPointer(at.loc, at.size, gl.FLOAT, false, at.stride || 0, at.offset || 0);
    if (at.divisor) gl.vertexAttribDivisor(at.loc, at.divisor);
    buffers[at.name] = buf;
    if (!at.divisor) vertexCount = Math.max(vertexCount, at.data.length / at.size);
  }

  let indexCount = 0;
  let indexType = gl.UNSIGNED_SHORT;
  let ibo = null;
  if (spec.indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, spec.indices, gl.STATIC_DRAW);
    indexCount = spec.indices.length;
    indexType = spec.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }

  gl.bindVertexArray(null);
  return {
    vao,
    buffers,
    vertexCount,
    indexCount,
    indexType,
    ibo,
    count: indexCount || vertexCount,
    mode: spec.mode ?? gl.TRIANGLES,
  };
}

export function drawMesh(gl, mesh, instances = 1) {
  gl.bindVertexArray(mesh.vao);
  if (mesh.ibo) gl.drawElementsInstanced(mesh.mode, mesh.count, mesh.indexType, 0, instances);
  else gl.drawArraysInstanced(mesh.mode, 0, mesh.count, instances);
}

// A clip-space quad used by every full screen pass (sky, bloom, composite).
export function makeFullscreenQuad(gl) {
  const positions = new Float32Array([
    -1, -1, 1, -1, 1, 1,
    -1, -1, 1, 1, -1, 1,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]);
  return makeMesh(gl, {
    attributes: [
      { name: 'aPos', loc: LOC.pos, size: 2, data: positions },
      { name: 'aUv', loc: LOC.uv, size: 2, data: uvs },
    ],
  });
}

export function createTexture(gl, { width, height, data, filter = gl.LINEAR, wrap = gl.REPEAT, format = gl.RGBA }) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// Colour texture + depth renderbuffer, ready to render the scene into.
export function createFramebuffer(gl, width, height) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

  const color = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, color);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('framebuffer incomplete: 0x' + status.toString(16));
  }
  return { fb, color, depth, width, height };
}

export function resizeFramebuffer(gl, target, width, height) {
  if (target.width === width && target.height === height) return target;
  gl.bindTexture(gl.TEXTURE_2D, target.color);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, target.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  target.width = width;
  target.height = height;
  return target;
}

// Deterministic value-noise texture used to break up asphalt and puddles.
export function makeNoiseTexture(gl, size, rng) {
  const data = new Uint8Array(size * size * 4);
  // Two octaves of blocky noise, upsampled by the GPU's bilinear filter.
  const coarse = 8;
  const grid = new Float32Array(coarse * coarse * 2);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * coarse;
      const gy = (y / size) * coarse;
      const x0 = Math.floor(gx) % coarse;
      const y0 = Math.floor(gy) % coarse;
      const x1 = (x0 + 1) % coarse;
      const y1 = (y0 + 1) % coarse;
      const fx = gx - Math.floor(gx);
      const fy = gy - Math.floor(gy);
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const i = y * size + x;
      const a = grid[(y0 * coarse + x0) * 2];
      const b = grid[(y0 * coarse + x1) * 2];
      const c = grid[(y1 * coarse + x0) * 2];
      const d = grid[(y1 * coarse + x1) * 2];
      const v1 = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
      const a2 = grid[(y0 * coarse + x0) * 2 + 1];
      const b2 = grid[(y0 * coarse + x1) * 2 + 1];
      const c2 = grid[(y1 * coarse + x0) * 2 + 1];
      const d2 = grid[(y1 * coarse + x1) * 2 + 1];
      const v2 = (a2 * (1 - sx) + b2 * sx) * (1 - sy) + (c2 * (1 - sx) + d2 * sx) * sy;
      const grain = (hash2i(x, y) - 0.5) * 0.18;
      data[i * 4 + 0] = Math.round(Math.min(1, Math.max(0, v1 + grain)) * 255);
      data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, v2 + grain)) * 255);
      data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, (v1 + v2) * 0.5 + grain)) * 255);
      data[i * 4 + 3] = 255;
    }
  }
  return createTexture(gl, { width: size, height: size, data });
}

function hash2i(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Atmosphere and post processing: gradient night sky with stars and a moon,
// rain streaks, additive glow sprites, mission beacons, and the bloom +
// colour-grade composite that gives the whole frame its neon haze.

import { CONFIG } from './config.js';
import { LOC, GLSL_HASH, createProgram, makeMesh, makeFullscreenQuad, drawMesh, createFramebuffer, resizeFramebuffer } from './gl.js';

const FOG_UNIFORMS = `
uniform vec3 uFogColor;
uniform vec2 uFog;
`;

// ---------------------------------------------------------------- sky ----

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=2) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 1.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uFogColor;
uniform float uTime;
out vec4 fragColor;
${GLSL_HASH}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uFwd + uRight * ndc.x * uTanHalf * uAspect + uUp * ndc.y * uTanHalf);
  float h = dir.y;

  // Deep night gradient. The very bottom matches the fog colour so the city
  // melts into the sky at the horizon.
  vec3 col = uFogColor;
  col = mix(col, vec3(0.058, 0.064, 0.125), smoothstep(0.0, 0.55, h));
  col = mix(col, vec3(0.034, 0.038, 0.076), smoothstep(0.45, 0.95, h));

  // Warm city glow sitting on the horizon.
  float glow = exp(-max(h, 0.0) * 6.5) * smoothstep(-0.10, 0.02, h);
  col += vec3(0.42, 0.12, 0.30) * glow * 0.55;
  col += vec3(0.10, 0.20, 0.38) * exp(-abs(h - 0.10) * 10.0) * 0.35;

  // Stars: one candidate per angular cell, only above the skyline.
  vec2 sp = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
  vec2 cell = floor(sp * 78.0);
  float r = hash21(cell);
  float star = smoothstep(0.9955, 1.0, r) * smoothstep(0.04, 0.30, h);
  float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + r * 90.0);
  col += vec3(0.85, 0.92, 1.0) * star * 1.7 * twinkle;
  col += vec3(0.6, 0.7, 1.0) * star * 0.5;

  // Moon with a soft halo.
  vec3 moonDir = normalize(vec3(-0.38, 0.34, -0.86));
  float md = max(dot(dir, moonDir), 0.0);
  col += vec3(0.86, 0.90, 1.0) * pow(md, 380.0) * 1.6;
  col += vec3(0.30, 0.38, 0.70) * pow(md, 14.0) * 0.22;

  // Thin drifting cloud bands for texture.
  float band = sin(sp.y * 16.0 + sin(sp.x * 2.0) * 1.4 + uTime * 0.03);
  col += vec3(0.05, 0.05, 0.10) * smoothstep(0.55, 1.0, band) * smoothstep(0.1, 0.6, h) * 0.5;

  fragColor = vec4(col, 1.0);
}`;

export class SkyRenderer {
  constructor(gl) {
    this.gl = gl;
    this.quad = makeFullscreenQuad(gl);
    this.prog = createProgram(gl, SKY_VS, SKY_FS, { aPos: LOC.pos, aUv: LOC.uv });
  }

  draw(cam, time) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.prog.use();
    gl.uniform3fv(this.prog.u('uFwd'), cam.forward);
    gl.uniform3fv(this.prog.u('uRight'), cam.right);
    gl.uniform3fv(this.prog.u('uUp'), cam.up);
    gl.uniform1f(this.prog.u('uTanHalf'), Math.tan(cam.fov * 0.5));
    gl.uniform1f(this.prog.u('uAspect'), cam.aspect);
    gl.uniform3fv(this.prog.u('uFogColor'), CONFIG.fogColor);
    gl.uniform1f(this.prog.u('uTime'), time);
    drawMesh(gl, this.quad);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
}

// ---------------------------------------------------------------- rain ----

const RAIN_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=4) in vec3 iPos;
layout(location=7) in vec2 iParam;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTime;
uniform float uRange;
uniform float uHeight;
out vec2 vUv;
out float vFade;
void main() {
  vec3 p = iPos;
  p.y = mod(p.y - uTime * iParam.x, uHeight);
  p.xz = uCam.xz + mod(p.xz - uCam.xz + uRange * 0.5, uRange) - uRange * 0.5;
  vec3 fall = normalize(vec3(0.16, -1.0, 0.06));
  vec3 side = normalize(cross(fall, normalize(uCam - p)));
  vec3 wp = p + side * aPos.x * 0.055 + fall * aPos.y * iParam.y;
  vUv = aPos + 0.5;
  float d = length(p.xz - uCam.xz);
  vFade = (1.0 - smoothstep(uRange * 0.22, uRange * 0.55, d)) * smoothstep(0.0, 2.5, p.y);
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const RAIN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vFade;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  float side = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  float a = side * along * vFade * 0.42;
  fragColor = vec4(uColor * a, 1.0);
}`;

export class RainRenderer {
  constructor(gl, rng) {
    this.gl = gl;
    this.count = CONFIG.rain.count;
    const corners = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
    const inst = new Float32Array(this.count * 5);
    for (let i = 0; i < this.count; i++) {
      inst[i * 5 + 0] = rng.float(-CONFIG.rain.range, CONFIG.rain.range);
      inst[i * 5 + 1] = rng.float(0, CONFIG.rain.height);
      inst[i * 5 + 2] = rng.float(-CONFIG.rain.range, CONFIG.rain.range);
      inst[i * 5 + 3] = rng.float(26, 40); // fall speed
      inst[i * 5 + 4] = rng.float(0.5, 1.5); // streak length
    }
    // One interleaved instance buffer holds position, speed and length.
    this._buildInstanced(gl, corners, inst);
    this.prog = createProgram(gl, RAIN_VS, RAIN_FS, { aPos: LOC.pos, iPos: LOC.ipos, iParam: LOC.iparam });
  }

  _buildInstanced(gl, corners, inst) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(LOC.pos);
    gl.vertexAttribPointer(LOC.pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(LOC.ipos);
    gl.vertexAttribPointer(LOC.ipos, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(LOC.ipos, 1);
    gl.enableVertexAttribArray(LOC.iparam);
    gl.vertexAttribPointer(LOC.iparam, 2, gl.FLOAT, false, 20, 12);
    gl.vertexAttribDivisor(LOC.iparam, 1);
    gl.bindVertexArray(null);
    this.mesh = { vao, count: 6, indexCount: 0, ibo: null, mode: gl.TRIANGLES };
  }

  draw(cam, vp, time) {
    const gl = this.gl;
    this.prog.use();
    gl.uniformMatrix4fv(this.prog.u('uVP'), false, vp);
    gl.uniform3fv(this.prog.u('uCam'), cam.eye);
    gl.uniform3fv(this.prog.u('uRight'), cam.right);
    gl.uniform3fv(this.prog.u('uUp'), cam.up);
    gl.uniform1f(this.prog.u('uTime'), time);
    gl.uniform1f(this.prog.u('uRange'), CONFIG.rain.range);
    gl.uniform1f(this.prog.u('uHeight'), CONFIG.rain.height);
    gl.uniform3f(this.prog.u('uColor'), 0.52, 0.66, 0.95);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    drawMesh(gl, this.mesh, this.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

// ---------------------------------------------------------------- glow ----

const GLOW_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=4) in vec3 iPos;
layout(location=5) in float iSize;
layout(location=6) in vec3 iColor;
layout(location=7) in float iAlpha;
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform vec2 uFog;
out vec2 vUv;
out vec3 vColor;
out float vAlpha;
void main() {
  vec3 wp = iPos + uRight * aPos.x * iSize + uUp * aPos.y * iSize;
  vUv = aPos + 0.5;
  vColor = iColor;
  float dist = length(wp - uCam);
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  vAlpha = iAlpha * (1.0 - fog * 0.85);
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float a = smoothstep(1.0, 0.0, r);
  a = a * a * vAlpha;
  fragColor = vec4(vColor * a, 1.0);
}`;

const GLOW_STRIDE = 8;

export class GlowBatch {
  constructor(gl, capacity = 256) {
    this.gl = gl;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * GLOW_STRIDE);
    this.count = 0;
    const corners = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(LOC.pos);
    gl.vertexAttribPointer(LOC.pos, 2, gl.FLOAT, false, 0, 0);
    this.ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(LOC.ipos);
    gl.vertexAttribPointer(LOC.ipos, 3, gl.FLOAT, false, GLOW_STRIDE * 4, 0);
    gl.vertexAttribDivisor(LOC.ipos, 1);
    gl.enableVertexAttribArray(LOC.isize);
    gl.vertexAttribPointer(LOC.isize, 1, gl.FLOAT, false, GLOW_STRIDE * 4, 12);
    gl.vertexAttribDivisor(LOC.isize, 1);
    gl.enableVertexAttribArray(LOC.icolor);
    gl.vertexAttribPointer(LOC.icolor, 3, gl.FLOAT, false, GLOW_STRIDE * 4, 16);
    gl.vertexAttribDivisor(LOC.icolor, 1);
    gl.enableVertexAttribArray(LOC.iparam);
    gl.vertexAttribPointer(LOC.iparam, 1, gl.FLOAT, false, GLOW_STRIDE * 4, 28);
    gl.vertexAttribDivisor(LOC.iparam, 1);
    gl.bindVertexArray(null);
    this.mesh = { vao, count: 6, ibo: null, mode: gl.TRIANGLES };
    this.prog = createProgram(gl, GLOW_VS, GLOW_FS, {
      aPos: LOC.pos, iPos: LOC.ipos, iSize: LOC.isize, iColor: LOC.icolor, iAlpha: LOC.iparam,
    });
  }

  begin() {
    this.count = 0;
  }

  add(x, y, z, size, color, alpha = 1) {
    if (this.count >= this.capacity) return;
    const o = this.count * GLOW_STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = size;
    d[o + 4] = color[0]; d[o + 5] = color[1]; d[o + 6] = color[2];
    d[o + 7] = alpha;
    this.count++;
  }

  draw(cam, vp) {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * GLOW_STRIDE));
    this.prog.use();
    gl.uniformMatrix4fv(this.prog.u('uVP'), false, vp);
    gl.uniform3fv(this.prog.u('uRight'), cam.right);
    gl.uniform3fv(this.prog.u('uUp'), cam.up);
    gl.uniform3fv(this.prog.u('uCam'), cam.eye);
    gl.uniform3fv(this.prog.u('uFogColor'), CONFIG.fogColor);
    gl.uniform2f(this.prog.u('uFog'), CONFIG.fogNear, CONFIG.fogFar);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    drawMesh(gl, this.mesh, this.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

// ------------------------------------------------------------- beacons ----

const BEACON_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
uniform mat4 uVP;
uniform vec3 uPos;
uniform float uRadius;
uniform float uHeight;
out vec2 vUv;
void main() {
  vec3 wp = uPos + vec3(aPos.x * uRadius, aPos.y * uHeight, aPos.z * uRadius);
  vUv = aUv;
  gl_Position = uVP * vec4(wp, 1.0);
}`;

const BEACON_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uColor;
uniform float uTime;
out vec4 fragColor;
void main() {
  float fade = pow(1.0 - vUv.y, 1.7);
  float bands = 0.55 + 0.45 * sin(vUv.y * 26.0 - uTime * 3.2);
  float stripes = 0.55 + 0.45 * sin(vUv.x * 25.13 + uTime * 1.1);
  float a = fade * bands * stripes * 0.55;
  fragColor = vec4(uColor * a, 1.0);
}`;

export class BeaconRenderer {
  constructor(gl) {
    this.gl = gl;
    const segs = 28;
    const verts = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      verts.push(x, 0, z, x, 1, z);
      uvs.push(i / segs, 0, i / segs, 1);
    }
    for (let i = 0; i < segs; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    this.mesh = makeMesh(gl, {
      attributes: [
        { name: 'aPos', loc: LOC.pos, size: 3, data: new Float32Array(verts) },
        { name: 'aUv', loc: LOC.uv, size: 2, data: new Float32Array(uvs) },
      ],
      indices: new Uint16Array(idx),
    });
    this.prog = createProgram(gl, BEACON_VS, BEACON_FS, { aPos: LOC.pos, aUv: LOC.uv });
  }

  draw(vp, marker, time) {
    const gl = this.gl;
    this.prog.use();
    gl.uniformMatrix4fv(this.prog.u('uVP'), false, vp);
    gl.uniform3f(this.prog.u('uPos'), marker.x, 0, marker.z);
    gl.uniform1f(this.prog.u('uRadius'), marker.radius ?? 2.6);
    gl.uniform1f(this.prog.u('uHeight'), marker.height ?? 26);
    gl.uniform3fv(this.prog.u('uColor'), marker.color ?? [0.2, 1.0, 0.85]);
    gl.uniform1f(this.prog.u('uTime'), time);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    drawMesh(gl, this.mesh);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

// ------------------------------------------------------------ post fx ----

const POST_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=2) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.45, l);
  fragColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  vec3 sum = texture(uTex, vUv).rgb * 0.227027;
  sum += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
  sum += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
  sum += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
  sum += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
  fragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform vec2 uRes;
uniform float uTime;
out vec4 fragColor;
${GLSL_HASH}
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec3 b = texture(uBloom, vUv).rgb;
  c += b * uBloomStrength;

  // Soft filmic curve keeps the neon highlights from clipping flat.
  c = c / (1.0 + c * 0.42);
  c = pow(c, vec3(0.67));
  c *= 1.22;

  // Cool shadows / warm highlights.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c * vec3(0.86, 0.92, 1.10), c * vec3(1.04, 1.0, 0.98), smoothstep(0.15, 0.65, l));

  // Vignette and a little grain so flat areas are not dead.
  float vig = smoothstep(1.15, 0.28, length(vUv - 0.5) * 1.25);
  c *= mix(0.86, 1.0, vig);
  float g = hash21(vUv * uRes + fract(uTime) * 91.7) - 0.5;
  c += g * 0.022;

  fragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(gl, width, height) {
    this.gl = gl;
    this.quad = makeFullscreenQuad(gl);
    this.scene = createFramebuffer(gl, width, height);
    this.bright = createFramebuffer(gl, Math.max(4, width >> 1), Math.max(4, height >> 1));
    this.blurA = createFramebuffer(gl, Math.max(4, width >> 1), Math.max(4, height >> 1));
    this.blurB = createFramebuffer(gl, Math.max(4, width >> 1), Math.max(4, height >> 1));
    this.brightProg = createProgram(gl, POST_VS, BRIGHT_FS, { aPos: LOC.pos, aUv: LOC.uv });
    this.blurProg = createProgram(gl, POST_VS, BLUR_FS, { aPos: LOC.pos, aUv: LOC.uv });
    this.compProg = createProgram(gl, POST_VS, COMPOSITE_FS, { aPos: LOC.pos, aUv: LOC.uv });
    this.width = width;
    this.height = height;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    resizeFramebuffer(this.gl, this.scene, width, height);
    const hw = Math.max(4, width >> 1);
    const hh = Math.max(4, height >> 1);
    resizeFramebuffer(this.gl, this.bright, hw, hh);
    resizeFramebuffer(this.gl, this.blurA, hw, hh);
    resizeFramebuffer(this.gl, this.blurB, hw, hh);
  }

  begin() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(CONFIG.fogColor[0], CONFIG.fogColor[1], CONFIG.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  _pass(fb, prog, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fb);
    gl.viewport(0, 0, fb.width, fb.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    prog.use();
    setup(prog);
    drawMesh(gl, this.quad);
  }

  end(time) {
    const gl = this.gl;
    const hw = this.bright.width;
    const hh = this.bright.height;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    this._pass(this.bright, this.brightProg, (p) => {
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform1f(p.u('uThreshold'), CONFIG.render.bloomThreshold);
    });

    gl.bindTexture(gl.TEXTURE_2D, this.bright.color);
    this._pass(this.blurA, this.blurProg, (p) => {
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uDir'), 1.0 / hw, 0);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.blurA.color);
    this._pass(this.blurB, this.blurProg, (p) => {
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uDir'), 0, 1.0 / hh);
    });
    // Second, wider pass for a soft halo.
    gl.bindTexture(gl.TEXTURE_2D, this.blurB.color);
    this._pass(this.blurA, this.blurProg, (p) => {
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uDir'), 1.8 / hw, 0);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.blurA.color);
    this._pass(this.blurB, this.blurProg, (p) => {
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uDir'), 0, 1.8 / hh);
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    this.compProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.color);
    gl.uniform1i(this.compProg.u('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurB.color);
    gl.uniform1i(this.compProg.u('uBloom'), 1);
    gl.uniform1f(this.compProg.u('uBloomStrength'), CONFIG.render.bloomStrength);
    gl.uniform2f(this.compProg.u('uRes'), this.width, this.height);
    gl.uniform1f(this.compProg.u('uTime'), time);
    drawMesh(gl, this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
  }
}

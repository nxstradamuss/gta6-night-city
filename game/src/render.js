// Frame assembly: one place that owns the GL context, the render resolution and
// the order the passes run in. Sky, wet asphalt, towers, lamps, cars, neon,
// mission beacons, rain, then the bloom composite.

import { CONFIG } from './config.js';
import { makeNoiseTexture } from './gl.js';
import { SkyRenderer, RainRenderer, GlowBatch, BeaconRenderer, PostFX } from './fx.js';
import { CityRenderer } from './city.js';
import { CarRenderer } from './car.js';

export class Renderer {
  constructor(canvas, rng) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('This browser has no WebGL2 support.');

    this.gl = gl;
    this.canvas = canvas;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(CONFIG.fogColor[0], CONFIG.fogColor[1], CONFIG.fogColor[2], 1);

    this.noiseTex = makeNoiseTexture(gl, 256, rng);
    this.sky = new SkyRenderer(gl);
    this.rain = new RainRenderer(gl, rng);
    this.glows = new GlowBatch(gl, 900);
    this.beacon = new BeaconRenderer(gl);
    this.cars = new CarRenderer(gl);
    this.post = new PostFX(gl, 8, 8);
    this.city = null;

    this.width = 0;
    this.height = 0;
    this.resize();
  }

  setCity(city) {
    this.city = new CityRenderer(this.gl, city, this.noiseTex);
  }

  // Render at a capped backing-store size: the canvas is stretched to the
  // window by CSS, so a software rasteriser still gets a frame out in time.
  resize() {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    let w = Math.max(320, Math.round((canvas.clientWidth || 1280) * dpr));
    let h = Math.max(180, Math.round((canvas.clientHeight || 720) * dpr));
    const budget = CONFIG.render.maxPixels;
    if (w * h > budget) {
      const s = Math.sqrt(budget / (w * h));
      w = Math.max(320, Math.round(w * s));
      h = Math.max(180, Math.round(h * s));
    }
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    canvas.width = w;
    canvas.height = h;
    this.post.resize(w, h);
  }

  render(cam, scene, time) {
    const gl = this.gl;
    this.resize();
    cam.aspect = (this.canvas.clientWidth || 1280) / (this.canvas.clientHeight || 720);
    cam.compute();

    const vp = cam.vp;

    this.post.begin();

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    this.sky.draw(cam, time);

    this.city.drawGround(cam, vp, scene.lights);
    this.city.drawBuildings(cam, vp);
    this.city.drawLamps(cam, vp);

    // Cars contribute their own headlight pools to the same glow batch.
    this.glows.begin();
    this.cars.draw(scene.cars, cam, vp, time, this.glows);
    this.city.addGlows(this.glows, cam, 180);

    this.city.drawSigns(cam, vp);

    for (let i = 0; i < scene.markers.length; i++) {
      this.beacon.draw(vp, scene.markers[i], time);
    }

    this.rain.draw(cam, vp, time);
    this.glows.draw(cam, vp);

    this.post.end(time);
  }
}

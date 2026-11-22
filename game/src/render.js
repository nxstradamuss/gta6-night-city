// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Frame assembly: owns the GL context, the resolution and the pass order. The
// ground pass gets the scene clock too, because the wet asphalt animates.

import { CONFIG } from './config.js';
import { makeNoiseTexture } from './gl.js';
import { SkyRenderer, RainRenderer, GlowBatch, BeaconRenderer, PostFX } from './fx.js';
import { CityRenderer } from './city.js';
import { CarRenderer } from './car.js';

// Pass order as data, so a new pass has to be slotted in deliberately instead of
// landing wherever it was typed: ground, city, furniture, crowd, cars, then the
// light added on top (glow, beacons, rain), then the bloom composite.
const DRAW_ORDER = ['ground', 'city', 'props', 'peds', 'cars', 'hud'];

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

  // Capped backing-store size: CSS stretches the canvas, so a software
  // rasteriser still gets a frame out in time.
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

    for (let i = 0; i < DRAW_ORDER.length; i++) {
      this._pass(DRAW_ORDER[i], cam, vp, scene, time);
    }

    this.post.end(time);
  }

  _pass(name, cam, vp, scene, time) {
    switch (name) {
      case 'ground':
        this.city.drawGround(cam, vp, scene, time);
        break;
      case 'city':
        this.city.drawBuildings(cam, vp);
        this.city.drawLamps(cam, vp);
        this.city.drawSigns(cam, vp);
        break;
      case 'props':
        this.city.drawProps(cam, vp);
        break;
      case 'peds':
        // The crowd rides its own instanced pass so it animates without
        // rebuilding the static furniture.
        if (scene.peds) scene.peds.draw(cam, vp);
        break;
      case 'cars':
        // Cars add their headlight pools to the shared glow batch, resolved in
        // the hud pass once every light is collected.
        this.glows.begin();
        this.cars.draw(scene.cars, cam, vp, time, this.glows);
        this.city.addGlows(this.glows, cam, 180);
        break;
      case 'hud':
        for (let i = 0; i < scene.markers.length; i++) {
          this.beacon.draw(vp, scene.markers[i], time);
        }
        // Rain last of the world passes so streaks read in front of the glow
        // they fall through; length follows the car's speed.
        this.rain.draw(cam, vp, time, scene.speed || 0);
        this.glows.draw(cam, vp);
        break;
      default:
        throw new Error(`Unknown render pass: ${name}`);
    }
  }
}

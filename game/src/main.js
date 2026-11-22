// Boot and the one loop: input, fixed 1/60 s steps, draw. ?seed=N picks the
// city, ?shot=1|2|3 stages a frozen scene.

import { CONFIG, PAINTS, STEP } from './config.js';
import { Rng, mixSeed } from './random.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Car } from './car.js';
import { Hud } from './hud.js';
import { Missions } from './missions.js';
import { Pedestrians } from './peds.js';
import { Minimap } from './minimap.js';
import { Renderer } from './render.js';
import { generateCity } from './city.js';
import { buildTraffic } from './traffic.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const SEED = Number.isInteger(seedParam) ? seedParam : CONFIG.seed;
const SHOT = params.get('shot');

const SPAWN = { x: 4.6, z: -30, heading: 0 };

export class Game {
  constructor(canvas, seed) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.city = generateCity(this.rng, {
      block: CONFIG.block,
      radius: CONFIG.radius,
      roadWidth: CONFIG.roadWidth,
      sidewalk: CONFIG.sidewalk,
    });

    this.renderer = new Renderer(canvas, new Rng(mixSeed(seed, 11)));
    this.renderer.setCity(this.city);

    this.player = new Car({ x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading, paint: PAINTS[0] });
    this.camera = new Camera();
    this.camera.aspect = 16 / 9;
    this.camera.snapTo(this.player);
    this.cameraLocked = false;

    this.traffic = buildTraffic(this.rng, this.city, 30);
    this.cops = [];
    // Radar police dots: refilled every frame, never allocated per paint.
    this._copDots = [];
    this.wanted = 0;
    this.cash = 0;
    this.time = 0;
    this.clock = 0;
    this.hintTime = 10;
    this.shotMode = false;
    this._lastHealth = this.player.health;

    this.hud = new Hud();
    this.input = new Input();
    // A crowd on the pavements, a radar on the dash.
    this.peds = new Pedestrians(this.renderer.gl, this.rng, 96);
    this.minimap = new Minimap(this.hud.root);
    this.missions = new Missions(this);
    this.missions.start(0);
  }

  // events

  toast(message, ms) {
    if (this.shotMode) return; // stills shouldn't carry a banner
    this.hud.toast(message, ms);
  }

  addCash(amount) {
    this.cash += amount;
  }

  setWanted(level) {
    this.wanted = Math.max(0, Math.min(5, level | 0));
    this._syncCops();
  }

  respawn() {
    this.player.reset(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.player.health = 100;
    this.cops.length = 0;
    this.wanted = 0;
    this.camera.snapTo(this.player);
    this.hud.flash();
  }

  _syncCops() {
    const want = Math.min(this.wanted, 3);
    while (this.cops.length > want) this.cops.pop();
    while (this.cops.length < want) {
      const i = this.cops.length;
      const f = this.player.forward();
      const right = [f[2], 0, -f[0]];
      const back = 42 + i * 12;
      const side = (i % 2 === 0 ? 1 : -1) * 4.6;
      this.cops.push(new Car({
        x: this.player.pos[0] - f[0] * back + right[0] * side,
        z: this.player.pos[2] - f[2] * back + right[2] * side,
        heading: this.player.heading,
        paint: [0.06, 0.07, 0.1],
        police: true,
      }));
    }
  }

  // update

  update(dt, controls) {
    const c = controls ?? {
      throttle: this.input.throttle,
      steer: this.input.steer,
      handbrake: this.input.handbrake,
    };

    const p = this.player;
    p.update(dt, c, this.city);

    for (let i = 0; i < this.traffic.length; i++) this.traffic[i].update(dt, this.city);

    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const dx = cop.pos[0] - p.pos[0];
      const dz = cop.pos[2] - p.pos[2];
      if (dx * dx + dz * dz > 340 * 340) {
        // Too far behind to matter: drop it back in behind the player.
        const f = p.forward();
        cop.pos[0] = p.pos[0] - f[0] * 55;
        cop.pos[2] = p.pos[2] - f[2] * 55;
        cop.heading = p.heading;
        cop.vel[0] = 0;
        cop.vel[2] = 0;
      }
      cop.updateAI(dt, p, this.city);
    }

    this.missions.update(dt, p);
    this.peds.update(dt, p.pos[0], p.pos[2]);

    if (p.health <= 0) {
      this.toast('WRECKED — BACK ON THE ROAD', 2600);
      this.respawn();
    }
    if (p.health < this._lastHealth - 4) this.hud.flash();
    this._lastHealth = p.health;

    if (!this.cameraLocked) this.camera.chase(dt, p);

    this.time += dt;
    this.clock += dt;
    if (this.hintTime > 0) {
      this.hintTime -= dt;
      if (this.hintTime <= 0) this.hud.setHint(false);
    }

    this.hud.setObjective(this.missions.objective());
    this.hud.setStats({
      speed: p.speed,
      health: p.health,
      wanted: this.wanted,
      cash: this.cash,
    });

    // Radar follows the car, not the camera, so it stays legible as the cam swings.
    this._paintMinimap(dt);

    if (this.input.wasPressed('KeyR')) this.respawn();
  }

  // Dots come from the live cruiser list: caching them would draw a frame behind.
  _policeDots() {
    const dots = this._copDots;
    dots.length = 0;
    const p = this.player;
    for (let i = 0; i < this.cops.length; i++) {
      const cop = this.cops[i];
      const dx = cop.pos[0] - p.pos[0];
      const dz = cop.pos[2] - p.pos[2];
      dots.push({
        pos: cop.pos,
        dist: Math.hypot(dx, dz),
        speed: cop.speed,
        chasing: cop.siren > 0,
      });
    }
    // Nearest first, so the minimap can just take the head of the list.
    dots.sort((a, b) => a.dist - b.dist);
    return dots;
  }

  // Drawn from update and render: shot mode stages once and only repaints.
  _paintMinimap(dt) {
    const p = this.player;
    const obj = this.missions.activeMarkers();
    this.minimap.update({
      x: p.pos[0], z: p.pos[2], heading: p.heading, dt,
      traffic: this.traffic,
      cops: this._policeDots(),
      marker: obj.length ? { x: obj[0].x, z: obj[0].z } : null,
    });
  }

  // scene

  scene() {
    const cars = [this.player];
    for (let i = 0; i < this.traffic.length; i++) cars.push(this.traffic[i]);
    for (let i = 0; i < this.cops.length; i++) cars.push(this.cops[i]);

    const markers = [];
    const active = this.missions.activeMarkers();
    for (let i = 0; i < active.length; i++) {
      const m = active[i];
      markers.push({ x: m.x, z: m.z, radius: m.r * 0.75, height: 30, color: m.color });
    }

    // Two analytic ground lights: headlight pool and nearest lamp.
    const p = this.player;
    const f = p.forward();
    const lights = [{
      pos: [p.pos[0] + f[0] * 9, 0.9, p.pos[2] + f[2] * 9],
      color: [1.0, 0.88, 0.66],
      on: p.lightsOn ? 1 : 0,
    }];

    let best = null;
    let bestD = Infinity;
    const lamps = this.city.lamps;
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      const dx = L.x - p.pos[0];
      const dz = L.z - p.pos[2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = L; }
    }
    lights.push({
      pos: best ? [best.headX, best.headY, best.headZ] : [0, 7, 0],
      color: [1.0, 0.7, 0.36],
      on: 1,
    });

    return {
      cars,
      markers,
      lights,
      peds: this.peds,
      // Signed road speed in m/s: rain stretches by it, the HUD reads the same.
      speed: p.speed,
      // The headlight cone is painted in the ground shader: a point light gives a
      // round pool, but the long wedge down the wet road sells a night drive.
      headlight: {
        x: p.pos[0], z: p.pos[2],
        dx: f[0], dz: f[2],
        on: p.lightsOn ? 1 : 0,
      },
    };
  }

  render() {
    this._paintMinimap(STEP);
    // Keep the crowd around the car even on a frozen stage.
    this.peds.stream(this.player.pos[0], this.player.pos[2]);
    this.renderer.render(this.camera, this.scene(), this.time);
  }

  // loop

  start() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Fixed steps, so physics is frame-rate independent.
      let acc = dt;
      let guard = 0;
      while (acc > 1e-4 && guard++ < 6) {
        const h = Math.min(STEP, acc);
        this.update(h);
        acc -= h;
      }
      this.render();
      this.input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Shot mode: stage once, then keep repainting the identical frame.
  startFrozen() {
    this.render();
    const frame = () => {
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  simulate(seconds, controls) {
    let left = seconds;
    let guard = 0;
    while (left > 1e-4 && guard++ < 4000) {
      const h = Math.min(STEP, left);
      this.update(h, controls);
      left -= h;
    }
    this.input.endFrame();
  }
}

const canvas = document.getElementById('game');
const game = new Game(canvas, SEED);
window.__game = game;

if (SHOT) {
  game.shotMode = true;
  stageShot(game, SHOT);
  window.__shotReady = true;
  game.startFrozen();
} else {
  game.start();
}

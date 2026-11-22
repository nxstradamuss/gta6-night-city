// Boot and the one loop: read input, advance the world in fixed 1/60 s steps,
// draw a frame. ?seed=N picks the city, ?shot=1|2|3 stages a frozen scene for
// the screenshots and stops simulating so the picture is byte-stable. The scene
// handed to the renderer carries the player car's headlight position and aim, so
// the ground shader can throw the cone onto the asphalt instead of faking a
// round light pool under the bumper. The aim is read every frame from the car's
// heading, so the cone swings with the steering rather than pointing where the
// body happens to be.

import { CONFIG, PAINTS, STEP } from './config.js';
import { Rng, mixSeed } from './random.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Car } from './car.js';
import { Hud } from './hud.js';
import { Missions } from './missions.js';
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
    this.wanted = 0;
    this.cash = 0;
    this.time = 0;
    this.clock = 0;
    this.hintTime = 10;
    this.shotMode = false;
    this._lastHealth = this.player.health;

    this.hud = new Hud();
    this.input = new Input();
    this.missions = new Missions(this);
    this.missions.start(0);
  }

  // ---------------------------------------------------------------- events --

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

  // ---------------------------------------------------------------- update --

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

    if (this.input.wasPressed('KeyR')) this.respawn();
  }

  // ----------------------------------------------------------------- scene --

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

    // Two analytic ground lights: the player's headlight pool and the nearest lamp.
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
      // The headlight cone is painted straight onto the asphalt in the ground
      // shader: a point light gives a round pool, but what sells a night drive
      // is the long wedge of light that stretches down the wet road ahead.
      headlight: {
        x: p.pos[0], z: p.pos[2],
        dx: f[0], dz: f[2],
        on: p.lightsOn ? 1 : 0,
      },
    };
  }

  render() {
    this.renderer.render(this.camera, this.scene(), this.time);
  }

  // ------------------------------------------------------------------ loop --

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

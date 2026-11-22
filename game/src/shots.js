// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// The ?shot=1|2|3 scenes: pose the real game state, then freeze for a frame that
// repeats exactly.

import { CONFIG, PAINTS } from './config.js';
import { TrafficCar } from './traffic.js';

// The radar dial is a 208px disc pinned to the bottom-left corner, so every
// framing leaves that corner plain road. The shots aim high and slightly right,
// fov tighter than the play default, so the car carries the frame.
const SHOT_FOV = 58;
const CHASE_FOV = 60;

// Seat the chase camera and take one damped step: the still uses the rig the
// player drives with, not a hand-placed pose.
function chaseFraming(game, fov) {
  game.cameraLocked = false;
  game.camera.fov = fov;
  game.camera.snapTo(game.player);
  game.camera.chase(1 / 30, game.player);
}

// 1 — the city itself: a low hero angle up an avenue, oncoming traffic, neon.
function stageCity(game) {
  const B = CONFIG.block;

  game.player.reset(4.6, -30, 0);
  game.player.vel[0] = 0;
  game.player.vel[2] = 0;
  game.player.speed = 0;

  // Cars placed by hand so the avenue reads live: oncoming headlights far lane,
  // tail lights pulling away in ours.
  const hero = [
    { dir: -1, z: 6, speed: 11 },
    { dir: -1, z: 30, speed: 13 },
    { dir: -1, z: 58, speed: 12 },
    { dir: 1, z: 18, speed: 12 },
    { dir: 1, z: 46, speed: 14 },
    { dir: -1, z: 86, speed: 15 },
  ];
  for (const h of hero) {
    game.traffic.push(new TrafficCar(game.rng, {
      axis: 'z', dir: h.dir, road: 0, along: h.z, speed: h.speed,
    }));
  }

  game.cameraLocked = true;
  // Tighter and closer than the old 67-degree pose, with the aim lifted so the
  // road under the radar dial stays empty.
  game.camera.setPose([7.4, 2.75, -43], [1.0, 10.4, 62], SHOT_FOV);
  game.wanted = 0;
  game.cops.length = 0;
}

// 2 — the chase: flat out down the avenue with two cruisers on the roof lights.
function stageChase(game) {
  game.player.reset(4.6, -62, 0);
  game.setWanted(2);
  game.cash = 1250;
  game.simulate(3.4, { throttle: 1, steer: 0, handbrake: false });
  chaseFraming(game, CHASE_FOV);
}

// 3 — the mission: rolling up on a pickup beacon with the clock running.
function stageMission(game) {
  const B = CONFIG.block;
  game.missions.start(1);
  game.missions.timeLeft = 84;
  game.player.reset(2 * B + 4.6, -38, 0);
  game.cash = 900;
  game.simulate(1.7, { throttle: 0.62, steer: 0, handbrake: false });
  chaseFraming(game, CHASE_FOV);
}

export function stageShot(game, id) {
  const n = Number(id) || 1;
  // No mission banner in a still frame; the objective card already says it.
  game.hud.toastEl.classList.remove('show');

  if (n === 2) stageChase(game);
  else if (n === 3) stageMission(game);
  else stageCity(game);

  game.hud.setObjective(game.missions.objective());
  game.hud.setStats({
    speed: game.player.speed,
    health: game.player.health,
    wanted: game.wanted,
    cash: game.cash,
  });
}

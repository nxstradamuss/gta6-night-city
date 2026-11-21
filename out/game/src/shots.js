// The three screenshot scenes behind ?shot=1|2|3. Each one poses the real game
// state (same cars, same physics, same seeded city) and then freezes, so the
// frame is repeatable and the capture harness can take its time.

import { CONFIG, PAINTS } from './config.js';
import { TrafficCar } from './traffic.js';

// 1 — the city itself: a low hero angle up an avenue, oncoming traffic, neon.
function stageCity(game) {
  const B = CONFIG.block;

  game.player.reset(4.6, -30, 0);
  game.player.vel[0] = 0;
  game.player.vel[2] = 0;
  game.player.speed = 0;

  // A handful of cars placed by hand so the avenue reads as a live street:
  // oncoming headlights in the far lane, tail lights pulling away in ours.
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
  game.camera.setPose([7.4, 2.95, -47], [1.2, 9.2, 62], 67);
  game.wanted = 0;
  game.cops.length = 0;
}

// 2 — the chase: flat out down the avenue with two cruisers on the roof lights.
function stageChase(game) {
  game.player.reset(4.6, -62, 0);
  game.setWanted(2);
  game.cash = 1250;
  game.simulate(3.4, { throttle: 1, steer: 0, handbrake: false });
  game.camera.chase(1 / 30, game.player);
}

// 3 — the mission: rolling up on a pickup beacon with the clock running.
function stageMission(game) {
  const B = CONFIG.block;
  game.missions.start(1);
  game.missions.timeLeft = 84;
  game.player.reset(2 * B + 4.6, -38, 0);
  game.cash = 900;
  game.simulate(1.7, { throttle: 0.62, steer: 0, handbrake: false });
  game.camera.chase(1 / 30, game.player);
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

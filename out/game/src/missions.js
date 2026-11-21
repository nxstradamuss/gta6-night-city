// Mission chain: a delivery run, a timed three-stop pickup and a survive-the-
// heat finale. Each mission exposes markers for the beacon renderer and an
// objective description for the HUD.

import { CONFIG } from './config.js';

const B = CONFIG.block;

const DEFS = [
  {
    kind: 'deliver',
    title: 'FIRST RUN',
    text: 'Deliver the package to the drop point on the avenue',
    reward: 500,
    markers: [{ x: 0, z: -2 * B, r: 8, color: [0.18, 1.0, 0.86] }],
  },
  {
    kind: 'collect',
    title: 'THREE STOPS',
    text: 'Collect 3 packages before the clock runs out',
    reward: 900,
    time: CONFIG.missions.pickupTime,
    markers: [
      { x: 2 * B, z: 0, r: 8, color: [1.0, 0.72, 0.20] },
      { x: -2 * B, z: B, r: 8, color: [1.0, 0.72, 0.20] },
      { x: 0, z: 2 * B, r: 8, color: [1.0, 0.72, 0.20] },
    ],
  },
  {
    kind: 'survive',
    title: 'LOSE THE HEAT',
    text: 'Survive 45 seconds with the cops on your tail',
    reward: 1500,
    time: CONFIG.missions.heatTime,
    wanted: 2,
    markers: [],
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.index = -1;
    this.def = null;
    this.state = 'idle';
    this.markers = [];
    this.timeLeft = 0;
    this.totalTime = 0;
    this.delay = 0;
    this.completed = 0;
  }

  start(index) {
    if (index >= DEFS.length) {
      this.state = 'all';
      this.def = null;
      this.markers = [];
      this.game.toast('ALL JOBS DONE — THE NIGHT IS YOURS');
      return;
    }
    this.index = index;
    const def = DEFS[index];
    this.def = def;
    this.markers = def.markers.map((m) => ({ ...m, done: false }));
    this.timeLeft = def.time ?? 0;
    this.totalTime = def.time ?? 0;
    this.state = 'active';
    this.game.toast(`${def.title} — ${def.text}`, 4200);
    if (def.wanted) this.game.setWanted(def.wanted);
  }

  _complete() {
    this.state = 'done';
    this.delay = 5.5;
    this.completed++;
    this.game.addCash(this.def.reward);
    this.game.toast(`MISSION COMPLETE  +$${this.def.reward}`, 3600);
    if (this.def.wanted) this.game.setWanted(0);
  }

  _fail() {
    this.timeLeft = this.totalTime;
    for (const m of this.markers) m.done = false;
    this.game.toast('WASTED — RUN IT AGAIN', 3000);
    this.game.respawn();
  }

  update(dt, car) {
    if (this.state === 'active') {
      const def = this.def;
      if (def.kind === 'deliver') {
        const m = this.markers[0];
        if (!m.done && this._near(car, m)) {
          m.done = true;
          this._complete();
        }
      } else if (def.kind === 'collect') {
        let remaining = 0;
        for (const m of this.markers) {
          if (m.done) continue;
          if (this._near(car, m)) {
            m.done = true;
            this.game.addCash(250);
            this.game.toast('PACKAGE SECURED  +$250', 2200);
          } else {
            remaining++;
          }
        }
        if (remaining === 0) {
          this._complete();
        } else {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) this._fail();
        }
      } else if (def.kind === 'survive') {
        this.timeLeft -= dt;
        if (car.health <= 0) this._fail();
        else if (this.timeLeft <= 0) this._complete();
      }
    } else if (this.state === 'done') {
      this.delay -= dt;
      if (this.delay <= 0) this.start(this.index + 1);
    }
  }

  _near(car, m) {
    const dx = car.pos[0] - m.x;
    const dz = car.pos[2] - m.z;
    return dx * dx + dz * dz < m.r * m.r;
  }

  activeMarkers() {
    return this.state === 'active' ? this.markers.filter((m) => !m.done) : [];
  }

  objective() {
    if (this.state !== 'active' || !this.def) {
      return { title: 'NIGHT CITY', text: 'Free roam — enjoy the rain', progress: 1, timer: null };
    }
    const def = this.def;
    let progress = 0;
    let timer = null;
    if (def.kind === 'deliver') {
      progress = this.markers[0].done ? 1 : 0;
    } else if (def.kind === 'collect') {
      const done = this.markers.filter((m) => m.done).length;
      progress = done / this.markers.length;
      timer = this.timeLeft;
    } else if (def.kind === 'survive') {
      progress = 1 - this.timeLeft / this.totalTime;
      timer = this.timeLeft;
    }
    return { title: def.title, text: def.text, progress, timer };
  }
}

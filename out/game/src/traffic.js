// Ambient traffic. Cars are grid-bound: each one owns a road, a direction and a
// progress coordinate, so they always sit in a lane, meet intersections at right
// angles, and never need pathfinding. They are real Car instances, so the car
// renderer draws their body, tail lights and headlight cones for free.

import { Car } from './car.js';
import { CONFIG, PAINTS } from './config.js';

const LANE = 4.6;

export class TrafficCar extends Car {
  constructor(rng, { axis, dir, road, along, speed }) {
    super({ paint: rng.pick(PAINTS) });
    this.rng = rng;
    this.axis = axis;
    this.dir = dir;
    this.road = road;
    this.along = along;
    this.cruise = speed;
    this.speed = speed;
    this._place();
  }

  _place() {
    const B = CONFIG.block;
    if (this.axis === 'z') {
      this.pos[0] = this.road * B + this.dir * LANE;
      this.pos[2] = this.along;
      this.heading = this.dir > 0 ? 0 : Math.PI;
    } else {
      this.pos[2] = this.road * B - this.dir * LANE;
      this.pos[0] = this.along;
      this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  update(dt) {
    const B = CONFIG.block;
    const prev = this.along;
    this.along += this.dir * this.cruise * dt;

    // Junction the car has just reached, if any.
    let junction = null;
    if (this.dir > 0) {
      const k = Math.ceil((prev + 0.001) / B);
      if (this.along >= k * B) junction = k;
    } else {
      const k = Math.floor((prev - 0.001) / B);
      if (this.along <= k * B) junction = k;
    }

    if (junction !== null) {
      this.along = junction * B;
      const edge = CONFIG.radius - 1;
      if (junction >= edge || junction <= -edge) {
        // Nothing beyond the district: turn the car around.
        this.dir = -this.dir;
      } else if (this.rng.chance(0.42)) {
        const turn = this.rng.sign();
        if (this.axis === 'z') {
          // Was travelling along z on road x = road*B: keep that x, swap axes.
          this.along = this.road * B + this.dir * LANE;
          this.axis = 'x';
        } else {
          this.along = this.road * B - this.dir * LANE;
          this.axis = 'z';
        }
        this.road = junction;
        this.dir = turn;
      }
    }

    this._place();
    this.wheelSpin += this.cruise * dt * 1.6;
    this.brake = 0;
  }
}

export function buildTraffic(rng, city, count = 26) {
  const B = CONFIG.block;
  const R = CONFIG.radius;
  const cars = [];
  for (let i = 0; i < count; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const road = rng.int(2 * R + 1) - R;
    const dir = rng.sign();
    const along = rng.float(-R + 1, R - 1) * B;
    cars.push(new TrafficCar(rng, {
      axis, dir, road, along,
      speed: rng.float(9, 17),
    }));
  }
  return cars;
}

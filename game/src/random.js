// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Deterministic pseudo random numbers. The whole city, the rain and every
// window light are derived from one seed, so ?shot=N always renders the same
// picture and ?seed=K gives a different but repeatable city.

export class Rng {
  constructor(seed = 1) {
    // A small integer LCG (Numerical Recipes constants). 32-bit, so it is
    // stable across engines and runs.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next() {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  float(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  int(n) {
    return Math.floor(this.next() * n) % n;
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[this.int(list.length)];
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

// Fold a few integers into one seed, so sub-systems can be seeded independently
// while still being driven by the master seed.
export function mixSeed(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    let v = Math.imul((part | 0) ^ 0x9e3779b9, 0x85ebca6b);
    v ^= v >>> 13;
    h = Math.imul(h ^ v, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

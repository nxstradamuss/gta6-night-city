// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Central tuning values for the whole game. Everything that shapes the world,
// the car feel or the look of the night lives here so the modules stay readable.

export const CONFIG = {
  seed: 1,

  // City layout. Roads run along every multiple of `block` on both axes.
  block: 62,
  roadWidth: 18,
  sidewalk: 4,
  radius: 5, // blocks out from the centre in each direction

  // Atmosphere
  fogNear: 52,
  fogFar: 340,
  fogColor: [0.062, 0.068, 0.115],

  render: {
    maxPixelRatio: 2,
    // Software rasterisation in CI: keep the backing store modest and let CSS
    // stretch it. The capture harness downsamples to 1280x720 anyway.
    maxPixels: 1.9e6,
    bloomThreshold: 0.70,
    bloomStrength: 0.90,
  },

  car: {
    accel: 18.5,
    reverseAccel: 10,
    maxSpeed: 54,
    maxReverse: 16,
    drag: 0.30,
    rollResist: 2.4,
    grip: 8.2,
    handbrakeGrip: 1.3,
    steerRate: 1.85,
    radius: 1.2,
    height: 1.5,
  },

  rain: {
    count: 2600,
    range: 96,
    height: 48,
  },

  missions: {
    pickupTime: 105,
    heatTime: 45,
  },
};

export const NEON = [
  [1.0, 0.16, 0.62], // magenta
  [0.16, 0.88, 1.0], // cyan
  [1.0, 0.62, 0.14], // amber
  [0.42, 1.0, 0.46], // mint
  [0.62, 0.24, 1.0], // violet
  [1.0, 0.28, 0.24], // red
];

export const PAINTS = [
  [0.72, 0.05, 0.16], // crimson
  [0.10, 0.42, 0.86], // cobalt
  [0.86, 0.86, 0.90], // pearl
  [0.92, 0.42, 0.06], // orange
  [0.12, 0.62, 0.42], // emerald
];

export const FOG_VEC3 = new Float32Array(CONFIG.fogColor);

// Fixed simulation step: physics and mission timers advance in whole steps so a
// slow frame never changes the outcome.
export const STEP = 1 / 60;

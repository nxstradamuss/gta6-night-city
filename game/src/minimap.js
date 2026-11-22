// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Dashboard radar: north-up, drawn from CONFIG.block, so map and city cannot
// disagree about where the next junction is. The chevron turns with the heading.

import { CONFIG } from './config.js';

const TAU = Math.PI * 2;
const KERB = 11;        // pavement left inside each block edge
const NEAREST_COPS = 3; // the radar answers "where is the law", not "every cruiser"

const CSS = `
#hud-map { position:absolute; left:30px; bottom:74px; width:178px; height:178px;
  border-radius:50%; overflow:hidden; background:#080c18;
  box-shadow:0 0 0 1px rgba(120,230,255,0.28), 0 0 26px rgba(40,180,255,0.16) inset,
    0 6px 26px rgba(0,0,0,0.55); }
#hud-map canvas { display:block; width:100%; height:100%; }
`;

export class Minimap {
  constructor(parent, size = 192) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'hud-map';
    this.root.innerHTML = `<canvas width="${size * 2}" height="${size * 2}"></canvas>`;
    parent.appendChild(this.root);

    this.ctx = this.root.querySelector('canvas').getContext('2d');
    this.size = size * 2;
    this.span = CONFIG.block * 5;               // world half-width of the dial
    this.scale = this.size / (this.span * 2);
  }

  update({ x, z, heading = 0, traffic = [], cops = [], marker = null }) {
    const c = this.ctx;
    const S = this.size;
    const B = CONFIG.block;
    const span = this.span;
    const k = this.scale;
    const mid = S / 2;
    // World -> dial, north-up: +x is right, +z is down.
    const px = (wx) => mid + (wx - x) * k;
    const pz = (wz) => mid + (wz - z) * k;

    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(mid, mid, mid - 2, 0, TAU);
    c.clip();

    // Blocks first, so the roads read as cuts through a city.
    c.fillStyle = 'rgba(26,38,64,0.78)';
    const first = Math.floor((x - span) / B);
    const last = Math.ceil((x + span) / B);
    // Hoisted: the same bounds for every column, and recomputing them was hot.
    const jFirst = Math.floor((z - span) / B);
    const jLast = Math.ceil((z + span) / B);
    const w = (B - KERB * 2) * k;
    for (let i = first; i <= last; i++) {
      for (let j = jFirst; j <= jLast; j++) {
        c.fillRect(px(i * B + KERB), pz(j * B + KERB), w, w);
      }
    }

    // Roads: one line per multiple of CONFIG.block on each axis.
    c.strokeStyle = 'rgba(150,215,255,0.20)';
    c.lineWidth = Math.max(2, 18 * k);
    c.beginPath();
    for (let i = first; i <= last; i++) {
      const lx = px(i * B);
      c.moveTo(lx, 0);
      c.lineTo(lx, S);
    }
    for (let j = jFirst; j <= jLast; j++) {
      const lz = pz(j * B);
      c.moveTo(0, lz);
      c.lineTo(S, lz);
    }
    c.stroke();

    // Traffic: cold little blips, deliberately quieter than the patrol cars.
    c.fillStyle = 'rgba(190,215,235,0.5)';
    for (const car of traffic) c.fillRect(px(car.pos[0]) - 2, pz(car.pos[2]) - 2, 4, 4);

    // Patrol cars: the nearest few, a dot with a ring that tightens in, the pulse
    // off the wall clock so it cannot stall on pause.
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.006);
    const near = [];
    for (const cop of cops) {
      const d = Math.hypot(cop.pos[0] - x, cop.pos[2] - z);
      if (d < span) near.push([d, cop]);
    }
    near.sort((a, b) => a[0] - b[0]);
    c.fillStyle = `rgba(255,64,80,${0.70 + 0.30 * pulse})`;
    c.strokeStyle = `rgba(255,64,80,${0.55 * pulse})`;
    c.lineWidth = 2;
    for (let n = 0; n < near.length && n < NEAREST_COPS; n++) {
      const [d, cop] = near[n];
      const bx = px(cop.pos[0]);
      const bz = pz(cop.pos[2]);
      c.beginPath();
      c.arc(bx, bz, 5, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(bx, bz, 7 + 9 * (d / span), 0, TAU);
      c.stroke();
    }

    // Objective marker: amber diamond, the only warm colour on the dial.
    if (marker) {
      const s = 9 + 2 * pulse;
      c.save();
      c.translate(px(marker.x), pz(marker.z));
      c.rotate(Math.PI / 4);
      c.fillStyle = '#ffd166';
      c.shadowColor = 'rgba(255,209,102,0.9)';
      c.shadowBlur = 14;
      c.fillRect(-s / 2, -s / 2, s, s);
      c.restore();
    }

    // Player chevron: canvas y is +z, so heading h bears at (sin h, cos h) and an
    // up-drawn chevron needs rotate(PI - h).
    c.save();
    c.translate(mid, mid);
    c.rotate(Math.PI - heading);
    c.beginPath();
    c.moveTo(0, -14);
    c.lineTo(10, 10);
    c.lineTo(0, 5);
    c.lineTo(-10, 10);
    c.closePath();
    c.fillStyle = '#4fe8ff';
    c.shadowColor = 'rgba(80,230,255,0.95)';
    c.shadowBlur = 16;
    c.fill();
    c.restore();
    c.restore();

    // Bezel and compass ticks, then an N drawn with no transform of its own.
    c.strokeStyle = 'rgba(140,240,255,0.30)';
    c.lineWidth = 2;
    c.beginPath();
    for (let a = 0; a < 4; a++) {
      const th = (a * TAU) / 4;
      const dx = Math.sin(th);
      const dz = -Math.cos(th);
      c.moveTo(mid + dx * (mid - 16), mid + dz * (mid - 16));
      c.lineTo(mid + dx * (mid - 7), mid + dz * (mid - 7));
    }
    c.stroke();
    c.fillStyle = '#9fe8ff';
    c.font = 'bold 22px ui-monospace, Menlo, Consolas, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', mid, 27);
  }
}

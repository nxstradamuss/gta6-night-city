// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// The radar in the bottom-left corner. Roads are drawn analytically from the
// same grid the city is generated on — every multiple of CONFIG.block is a
// street — so the map never has to sample the world and stays pixel-stable
// between frames.

import { CONFIG } from './config.js';

const CSS = `
#hud-map {
  position: absolute; left: 30px; bottom: 74px; width: 178px; height: 178px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(120,230,255,0.28), 0 0 26px rgba(40,180,255,0.16) inset,
              0 6px 26px rgba(0,0,0,0.55);
  overflow: hidden;
  background: radial-gradient(circle at 50% 50%, rgba(10,16,32,0.92), rgba(4,6,14,0.96));
}
#hud-map canvas { display: block; width: 100%; height: 100%; }
#hud-map .ring {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 1px solid rgba(140,240,255,0.22);
}
#hud-map .north {
  position: absolute; left: 50%; top: 5px; transform: translateX(-50%);
  font-size: 9px; letter-spacing: 2px; color: #9fe8ff; opacity: 0.8;
}
`;

export class Minimap {
  constructor(parent, size = 178) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'hud-map';
    this.root.innerHTML = `<canvas width="${size * 2}" height="${size * 2}"></canvas>
      <div class="ring"></div><div class="north">N</div>`;
    parent.appendChild(this.root);

    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.size = size * 2;
    // How much world fits across the dial: five blocks each way.
    this.span = CONFIG.block * 5;
    this.scale = this.size / (this.span * 2);
    this.t = 0;
  }

  // World -> dial. The map is north-up, so the player's heading turns the arrow
  // rather than the map: that keeps the streets readable while you corner.
  _px(wx, wz, cx, cz) {
    return [this.size / 2 + (wx - cx) * this.scale, this.size / 2 + (wz - cz) * this.scale];
  }

  update({ x, z, heading = 0, traffic = [], cops = [], marker = null, dt = 0 }) {
    this.t += dt;
    const c = this.ctx;
    const S = this.size;
    const B = CONFIG.block;
    const half = this.span;

    c.clearRect(0, 0, S, S);

    // Blocks: fill the cells between roads so the grid reads as a city and not
    // as graph paper.
    c.fillStyle = 'rgba(28,40,66,0.72)';
    const first = Math.floor((x - half) / B);
    const last = Math.ceil((x + half) / B);
    for (let i = first; i <= last; i++) {
      for (let j = Math.floor((z - half) / B); j <= Math.ceil((z + half) / B); j++) {
        const [ax, az] = this._px(i * B + 11, j * B + 11, x, z);
        const w = (B - 22) * this.scale;
        c.fillRect(ax, az, w, w);
      }
    }

    // Roads: two axes of lines across the whole dial.
    c.strokeStyle = 'rgba(150,215,255,0.20)';
    c.lineWidth = Math.max(2, 18 * this.scale);
    c.beginPath();
    for (let i = first; i <= last; i++) {
      const [lx] = this._px(i * B, 0, x, z);
      c.moveTo(lx, 0); c.lineTo(lx, S);
    }
    for (let j = Math.floor((z - half) / B); j <= Math.ceil((z + half) / B); j++) {
      const [, lz] = this._px(0, j * B, x, z);
      c.moveTo(0, lz); c.lineTo(S, lz);
    }
    c.stroke();

    // Traffic and police as blips.
    for (const t of traffic) {
      const [bx, bz] = this._px(t.pos[0], t.pos[2], x, z);
      c.fillStyle = 'rgba(190,215,235,0.55)';
      c.fillRect(bx - 2, bz - 2, 4, 4);
    }
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 6.0);
    for (const cop of cops) {
      const [bx, bz] = this._px(cop.pos[0], cop.pos[2], x, z);
      c.beginPath();
      c.fillStyle = `rgba(255,64,80,${0.65 + 0.35 * pulse})`;
      c.arc(bx, bz, 6, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `rgba(255,64,80,${0.5 * pulse})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(bx, bz, 11, 0, Math.PI * 2);
      c.stroke();
    }

    // Objective marker.
    if (marker) {
      const [mx, mz] = this._px(marker.x, marker.z, x, z);
      const s = 9 + 2 * pulse;
      c.save();
      c.translate(mx, mz);
      c.rotate(Math.PI / 4);
      c.fillStyle = '#ffd166';
      c.shadowColor = 'rgba(255,209,102,0.9)';
      c.shadowBlur = 14;
      c.fillRect(-s / 2, -s / 2, s, s);
      c.restore();
    }

    // The player: a triangle pointing along the heading, cyan so it never gets
    // confused with the amber objective.
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(heading);
    c.beginPath();
    c.moveTo(0, -13);
    c.lineTo(9.5, 10);
    c.lineTo(0, 5.5);
    c.lineTo(-9.5, 10);
    c.closePath();
    c.fillStyle = '#4fe8ff';
    c.shadowColor = 'rgba(80,230,255,0.95)';
    c.shadowBlur = 16;
    c.fill();
    c.restore();

    // Sweep line, purely cosmetic: it makes the dial feel alive in a still.
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(this.t * 1.1);
    const g = c.createLinearGradient(0, 0, 0, -S / 2);
    g.addColorStop(0, 'rgba(120,240,255,0.20)');
    g.addColorStop(1, 'rgba(120,240,255,0)');
    c.strokeStyle = g;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -S / 2);
    c.stroke();
    c.restore();
  }
}

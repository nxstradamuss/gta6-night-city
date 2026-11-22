// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// DOM overlay: objective card, wanted stars, speedometer, health bar, cash,
// control hint, mission toasts and a damage flash. Styled to match the neon
// night rather than a generic debug panel.

const CSS = `
#hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  color: #e9f6ff; opacity: 1; transition: opacity 260ms ease;
  -webkit-font-smoothing: antialiased;
}
#hud[data-visible="0"] { opacity: 0; }

#hud-obj {
  position: absolute; left: 30px; top: 26px; padding: 10px 22px 12px 15px;
  border-left: 3px solid #ff2d95;
  background: linear-gradient(90deg, rgba(6,8,18,0.78), rgba(6,8,18,0));
  text-shadow: 0 0 14px rgba(255,45,149,0.5);
  max-width: 430px;
}
#hud-obj .kicker {
  font-size: 10px; letter-spacing: 4px; color: #ff5fae; opacity: 0.9;
}
#hud-obj .title {
  font-size: 21px; font-weight: 700; letter-spacing: 2.5px; margin-top: 3px;
  color: #ffffff;
}
#hud-obj .text {
  font-size: 12px; line-height: 1.45; letter-spacing: 0.6px; margin-top: 5px;
  color: #b9d4e6;
}
#hud-obj .bar {
  margin-top: 9px; width: 240px; height: 3px; background: rgba(255,255,255,0.14);
}
#hud-obj .bar i {
  display: block; height: 100%; width: 0%;
  background: linear-gradient(90deg, #23e6ff, #ff2d95);
  box-shadow: 0 0 10px rgba(35,230,255,0.8);
  transition: width 180ms linear;
}
#hud-obj .timer {
  position: absolute; right: 16px; top: 12px; font-size: 19px; font-weight: 700;
  color: #ffd166; letter-spacing: 1px; text-shadow: 0 0 12px rgba(255,209,102,0.6);
}

#hud-wanted {
  position: absolute; right: 30px; top: 26px; text-align: right;
  font-size: 25px; letter-spacing: 3px; color: #ffd166;
  text-shadow: 0 0 14px rgba(255,180,40,0.75);
}
#hud-wanted .stars { opacity: 0.96; }
#hud-wanted .cash {
  margin-top: 4px; font-size: 15px; letter-spacing: 1.5px; color: #9ef7c9;
  text-shadow: 0 0 10px rgba(80,255,170,0.5);
}

#hud-speed {
  position: absolute; right: 32px; bottom: 26px; text-align: right;
  line-height: 0.86;
}
#hud-speed .num {
  font-size: 62px; font-weight: 700; letter-spacing: -3px; color: #ffffff;
  text-shadow: 0 0 22px rgba(90,200,255,0.7), 0 0 46px rgba(90,200,255,0.28);
}
#hud-speed .unit {
  font-size: 11px; letter-spacing: 5px; color: #7fd8ff; opacity: 0.85;
  display: block; margin-top: 6px;
}

#hud-health {
  position: absolute; left: 30px; bottom: 30px; width: 250px;
}
#hud-health .label {
  font-size: 9px; letter-spacing: 4px; color: #8fb6c9; margin-bottom: 6px;
}
#hud-health .bar {
  height: 8px; background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.16);
}
#hud-health .bar i {
  display: block; height: 100%; width: 100%;
  background: linear-gradient(90deg, #16f5c0, #6ff5a0);
  box-shadow: 0 0 12px rgba(40,240,180,0.7);
  transition: width 140ms linear;
}
#hud-health.low .bar i {
  background: linear-gradient(90deg, #ff3b3b, #ff8a3b);
  box-shadow: 0 0 14px rgba(255,60,60,0.8);
}

#hud-hint {
  position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%);
  font-size: 10.5px; letter-spacing: 2.6px; color: #a8c6d8; opacity: 0.75;
  text-shadow: 0 0 10px rgba(0,0,0,0.9);
  white-space: nowrap;
}

#hud-toast {
  position: absolute; left: 50%; top: 15%; transform: translate(-50%, -8px);
  font-size: 15px; letter-spacing: 3px; padding: 9px 20px;
  background: rgba(8,10,22,0.7); border: 1px solid rgba(120,230,255,0.35);
  color: #d8f4ff; text-shadow: 0 0 12px rgba(120,230,255,0.6);
  opacity: 0; transition: opacity 300ms ease, transform 300ms ease;
  white-space: nowrap;
}
#hud-toast.show { opacity: 1; transform: translate(-50%, 0); }

#hud-damage {
  position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255,20,40,0) 42%, rgba(255,20,40,0.55) 100%);
  transition: opacity 380ms ease;
}
`;

export class Hud {
  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.setAttribute('data-visible', '1');
    this.root.innerHTML = `
      <div id="hud-obj">
        <div class="kicker">MISSION</div>
        <div class="title"></div>
        <div class="text"></div>
        <div class="timer"></div>
        <div class="bar"><i></i></div>
      </div>
      <div id="hud-wanted"><div class="stars">☆☆☆☆☆</div><div class="cash">$0</div></div>
      <div id="hud-speed"><div class="num">0</div><span class="unit">KM/H</span></div>
      <div id="hud-health"><div class="label">CONDITION</div><div class="bar"><i></i></div></div>
      <div id="hud-hint">W A S D &nbsp;·&nbsp; SPACE handbrake &nbsp;·&nbsp; R reset</div>
      <div id="hud-toast"></div>
      <div id="hud-damage"></div>
    `;
    document.body.appendChild(this.root);

    this.objTitle = this.root.querySelector('#hud-obj .title');
    this.objText = this.root.querySelector('#hud-obj .text');
    this.objTimer = this.root.querySelector('#hud-obj .timer');
    this.objBar = this.root.querySelector('#hud-obj .bar i');
    this.stars = this.root.querySelector('#hud-wanted .stars');
    this.cash = this.root.querySelector('#hud-wanted .cash');
    this.speedNum = this.root.querySelector('#hud-speed .num');
    this.healthWrap = this.root.querySelector('#hud-health');
    this.healthBar = this.root.querySelector('#hud-health .bar i');
    this.hint = this.root.querySelector('#hud-hint');
    this.toastEl = this.root.querySelector('#hud-toast');
    this.damageEl = this.root.querySelector('#hud-damage');

    this._toastTimer = 0;
    this._last = {};
  }

  setVisible(on) {
    this.root.setAttribute('data-visible', on ? '1' : '0');
  }

  setHint(on) {
    this.hint.style.display = on ? '' : 'none';
  }

  setObjective({ title, text, progress = 0, timer = null }) {
    if (this._last.title !== title) {
      this.objTitle.textContent = title;
      this._last.title = title;
    }
    if (this._last.text !== text) {
      this.objText.textContent = text;
      this._last.text = text;
    }
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    if (this._last.pct !== pct) {
      this.objBar.style.width = pct + '%';
      this._last.pct = pct;
    }
    const t = timer === null || timer === undefined ? '' : `${Math.max(0, Math.ceil(timer))}s`;
    if (this._last.timer !== t) {
      this.objTimer.textContent = t;
      this._last.timer = t;
    }
  }

  setStats({ speed = 0, health = 100, wanted = 0, cash = 0 }) {
    const kmh = Math.round(speed * 3.6);
    if (this._last.kmh !== kmh) {
      this.speedNum.textContent = String(kmh);
      this._last.kmh = kmh;
    }
    const hp = Math.max(0, Math.min(100, health));
    const hpRounded = Math.round(hp);
    if (this._last.hp !== hpRounded) {
      this.healthBar.style.width = hpRounded + '%';
      this.healthWrap.classList.toggle('low', hp < 34);
      this._last.hp = hpRounded;
    }
    const w = Math.max(0, Math.min(5, wanted | 0));
    if (this._last.wanted !== w) {
      this.stars.textContent = '★'.repeat(w) + '☆'.repeat(5 - w);
      this._last.wanted = w;
    }
    if (this._last.cash !== cash) {
      this.cash.textContent = '$' + cash.toLocaleString('en-US');
      this._last.cash = cash;
    }
  }

  toast(message, ms = 3200) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  flash() {
    this.damageEl.style.opacity = '1';
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this.damageEl.style.opacity = '0'; }, 90);
  }
}

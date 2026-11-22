// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Keyboard with an action layer, plus a pointer/touch drag layer so the game is
// playable on a tablet. `pressed` is a one-shot set main.js clears each frame.

const DRIVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

// Touch tuning, in CSS pixels: a drag clears the dead zone, then ramps linearly
// to full lock over TOUCH_FULL px.
const TOUCH_DEAD = 12;
const TOUCH_FULL = 88;

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.anyPress = false;
    this.touch = { active: false, id: -1, x0: 0, y0: 0, x: 0, y: 0 };

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (DRIVE_KEYS.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.anyPress = true;
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.touch.active = false;
      this.touch.id = -1;
    };

    // One pointer drives the car: vertical drag is throttle/brake, horizontal is
    // steering. Tracking the id means a second finger landing mid-corner is
    // ignored rather than snapping the wheel to where it touched down.
    this._onPointerDown = (e) => {
      if (this.touch.active) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target && e.target.id === 'game') e.preventDefault();
      this.touch.active = true;
      this.touch.id = e.pointerId;
      this.touch.x0 = this.touch.x = e.clientX;
      this.touch.y0 = this.touch.y = e.clientY;
    };
    this._onPointerMove = (e) => {
      if (!this.touch.active || e.pointerId !== this.touch.id) return;
      this.touch.x = e.clientX;
      this.touch.y = e.clientY;
    };
    this._onPointerUp = (e) => {
      if (e.pointerId !== this.touch.id) return;
      this.touch.active = false;
      this.touch.id = -1;
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
  }

  down(...codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  wasPressed(...codes) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  // Drag axis, dead-zoned and clamped to [-1, 1]. Negative is up/left.
  _axis(delta) {
    const a = Math.abs(delta);
    if (a <= TOUCH_DEAD) return 0;
    const v = Math.min(1, (a - TOUCH_DEAD) / (TOUCH_FULL - TOUCH_DEAD));
    return delta < 0 ? -v : v;
  }

  // Drag up from the touch-down point to go, drag down to brake or reverse.
  get touchThrottle() {
    return this.touch.active ? this._axis(this.touch.y0 - this.touch.y) : 0;
  }

  // Drag right to steer right, relative to the touch-down point, so the wheel
  // self-centres when the thumb lifts.
  get touchSteer() {
    return this.touch.active ? this._axis(this.touch.x - this.touch.x0) : 0;
  }

  get throttle() {
    const k = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    // Keys win outright while held, so a hybrid device never fights itself.
    return k !== 0 ? k : this.touchThrottle;
  }

  // +1 steers right, -1 steers left.
  get steer() {
    const k = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    return k !== 0 ? k : this.touchSteer;
  }

  get handbrake() {
    return this.down('Space', 'ShiftLeft', 'ShiftRight');
  }

  endFrame() {
    this.pressed.clear();
    this.anyPress = false;
  }
}

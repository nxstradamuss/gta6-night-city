// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Keyboard input with a small action layer. Held keys drive the car every
// frame; `pressed` is a one-shot set that main.js clears at the end of a frame.

const DRIVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.anyPress = false;

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
    this._onBlur = () => this.keys.clear();

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  down(...codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  wasPressed(...codes) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  get throttle() {
    return (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
  }

  // +1 steers right, -1 steers left.
  get steer() {
    return (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
  }

  get handbrake() {
    return this.down('Space', 'ShiftLeft', 'ShiftRight');
  }

  endFrame() {
    this.pressed.clear();
    this.anyPress = false;
  }
}

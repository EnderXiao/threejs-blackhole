import * as THREE from 'three';

/**
 * Free-fly camera with pointer-look + WASD, inertial damping.
 * Positions are world Cartesian; BH is at origin.
 */
export class FreeCamera {
  constructor(dom, { position = new THREE.Vector3(0, 6, 22) } = {}) {
    this.dom = dom;
    this.object = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.object.position.copy(position);

    // Aim at the black hole at origin (stable framing)
    this.yaw = 0;
    this.pitch = -0.28;
    this.roll = 0;

    this.speed = 8;
    this.boost = 3.2;
    this.damping = 6;

    this.keys = new Set();
    this.velocity = new THREE.Vector3();
    this.locked = false;
    this.enabled = false;

    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      // ignore synthetic spikes (headless / pointer-lock glitches)
      const mx = Math.max(-80, Math.min(80, e.movementX || 0));
      const my = Math.max(-80, Math.min(80, e.movementY || 0));
      const s = 0.0022;
      this.yaw -= mx * s;
      this.pitch -= my * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    dom.addEventListener('click', (e) => {
      if (this.enabled && !this.locked && e.target === dom) {
        dom.requestPointerLock?.();
      }
    });

    this._applyRotation();
    this._bindTouch(dom);
  }

  setEnabled(v) {
    this.enabled = v;
  }

  reset(position = new THREE.Vector3(0, 7.5, 24), yaw = 0, pitch = -0.28) {
    this.object.position.copy(position);
    this.yaw = yaw ?? 0;
    this.pitch = pitch;
    this.velocity.set(0, 0, 0);
    this._applyRotation();
  }

  _applyRotation() {
    this.object.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  resize(w, h) {
    this.object.aspect = w / h;
    this.object.updateProjectionMatrix();
  }

  update(dt) {
    this._applyRotation();
    if (!this.enabled) return;

    const q = this.object.quaternion;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    const wish = new THREE.Vector3();
    const k = this.keys;
    if (k.has('KeyW')) wish.add(forward);
    if (k.has('KeyS')) wish.addScaledVector(forward, -1);
    if (k.has('KeyD')) wish.add(right);
    if (k.has('KeyA')) wish.addScaledVector(right, -1);
    if (k.has('KeyE') || k.has('KeySpace')) wish.add(up);
    if (k.has('KeyQ')) wish.addScaledVector(up, -1);
    if (wish.lengthSq() > 0) wish.normalize();

    const sp = this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? this.boost : 1);
    this.velocity.addScaledVector(wish, sp * dt * 8);
    this.velocity.multiplyScalar(Math.exp(-this.damping * dt));
    this.object.position.addScaledVector(this.velocity, dt);

    // soft keep-out near horizon so free-fly stays observational
    const r = this.object.position.length();
    const minR = 3.2;
    if (r < minR) {
      this.object.position.multiplyScalar(minR / r);
    }
    // prevent escaping to infinity
    const maxR = 55;
    if (r > maxR) this.object.position.multiplyScalar(maxR / r);
  }

  /** Basis matrix for shader: columns right, up, forward */
  getBasisMatrix() {
    const q = this.object.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const m = new THREE.Matrix4().makeBasis(right, up, forward);
    return new THREE.Matrix3().setFromMatrix4(m);
  }

  // ---- mobile: one-finger look, two-finger pinch dolly ----
  _bindTouch(dom) {
    this._touch = { id: null, x: 0, y: 0, pinch: 0 };
    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._touch.id = e.touches[0].identifier;
        this._touch.x = e.touches[0].clientX;
        this._touch.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._touch.pinch = Math.hypot(dx, dy);
      }
      e.preventDefault();
    }, { passive: false });

    dom.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.enabled) {
        const t = e.touches[0];
        const mx = Math.max(-80, Math.min(80, t.clientX - this._touch.x));
        const my = Math.max(-80, Math.min(80, t.clientY - this._touch.y));
        this._touch.x = t.clientX;
        this._touch.y = t.clientY;
        this.yaw -= mx * 0.005;
        this.pitch -= my * 0.005;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
      } else if (e.touches.length === 2 && this.enabled) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const delta = dist - this._touch.pinch;
        this._touch.pinch = dist;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.object.quaternion);
        this.object.position.addScaledVector(dir, delta * 0.05);
        const r = this.object.position.length();
        if (r < 3.2) this.object.position.multiplyScalar(3.2 / r);
        if (r > 55) this.object.position.multiplyScalar(55 / r);
      }
    }, { passive: false });

    dom.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this._touch.id = e.touches[0].identifier;
        this._touch.x = e.touches[0].clientX;
        this._touch.y = e.touches[0].clientY;
      }
    }, { passive: false });
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

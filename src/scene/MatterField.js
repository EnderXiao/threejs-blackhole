import * as THREE from 'three';
import { makeKerr } from '../physics/kerr.js';

/**
 * Infalling matter with clearly visible Keplerian shear + inspiral.
 * Colors encode Doppler (left/right) and gravitational redshift (radius).
 */
export class MatterField {
  constructor(count = 4500) {
    this.count = count;
    this.params = { a: 0.9, timeScale: 1, paused: false };
    this.kerr = makeKerr(this.params.a);
    this._time = 0;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    this.state = {
      r: new Float32Array(count),
      phi: new Float32Array(count),
      th: new Float32Array(count),
      vr: new Float32Array(count),
      phase: new Float32Array(count),
    };

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      // keep matter near the bright disk so it reads as flowing sparks
      const r = 2.4 + Math.pow(u, 1.4) * 9.5;
      this.state.r[i] = r;
      this.state.phi[i] = Math.random() * Math.PI * 2;
      const puff = 0.025 * Math.exp(-r / 4) + 0.005;
      this.state.th[i] = Math.PI / 2 + (Math.random() - 0.5) * puff * 2;
      this.state.vr[i] = -0.002 * Math.random();
      this.state.phase[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.5 + Math.random() * 1.0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(0.8, -mv.z);
          gl_PointSize = aSize * uPixelRatio * (55.0 / dist);
          gl_PointSize = clamp(gl_PointSize, 0.8, 6.5);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.05, length(d));
          gl_FragColor = vec4(vColor, a * 0.7);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this._writePositions();
  }

  setSpin(a) {
    this.params.a = a;
    this.kerr = makeKerr(a);
  }

  setTimeScale(t) {
    this.params.timeScale = t;
  }

  setPaused(p) {
    this.params.paused = p;
  }

  update(dt) {
    if (this.params.paused || dt <= 0) return;
    const { r, phi, th, vr, phase } = this.state;
    const a = this.params.a;
    const isco = this.kerr.rIsco;
    const rh = this.kerr.rPlus;
    const t = Math.min(dt, 0.05) * this.params.timeScale;
    this._time += t;
    const time = this._time;

    for (let i = 0; i < this.count; i++) {
      let ri = r[i];
      // Kerr Ω = 1/(r^{3/2}+a) — scaled up so shear is obvious in real time
      const om = 1 / (Math.pow(Math.max(ri, 0.5), 1.5) + a);
      phi[i] += om * t * 40.0;

      if (ri > isco) {
        vr[i] += (-0.004 / ((ri - isco) + 0.3)) * t;
        vr[i] = Math.max(vr[i], -0.04);
      } else {
        vr[i] += -0.08 * t;
        vr[i] = Math.max(vr[i], -0.2);
      }
      vr[i] *= Math.exp(-0.35 * t);
      ri += vr[i] * t * 22.0;

      // frame-drag swirl near horizon
      if (ri < 5.0) {
        phi[i] += (2.5 * a / (ri * ri * ri + 0.1)) * t * 16.0;
        th[i] += Math.sin(time * 2.0 + phase[i]) * 0.003 * t * Math.max(0, 5.0 - ri);
      }

      if (ri < rh + 0.1) {
        ri = 10.5 + Math.random() * 5.5;
        vr[i] = 0;
        th[i] = Math.PI / 2 + (Math.random() - 0.5) * 0.03;
        phi[i] = Math.random() * Math.PI * 2;
      }
      r[i] = ri;
    }
    this._writePositions();
  }

  _writePositions() {
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.aColor.array;
    const { r, phi, th } = this.state;
    const isco = this.kerr.rIsco;

    for (let i = 0; i < this.count; i++) {
      const rr = r[i];
      const st = Math.sin(th[i]);
      const ct = Math.cos(th[i]);
      pos[i * 3] = rr * st * Math.cos(phi[i]);
      pos[i * 3 + 1] = rr * ct;
      pos[i * 3 + 2] = rr * st * Math.sin(phi[i]);

      const t = Math.max(0, 1 - (rr - isco) / 12);
      // orbital direction (-z, 0, x)·om — beaming proxy via screen-ish azimuth
      // approaching side (sin φ > 0 ~ +z half toward typical camera) brighter
      const beam = 0.35 + 0.9 * Math.max(0, Math.sin(phi[i]));
      const fade = 0.35 + 0.65 * Math.max(0, -Math.sin(phi[i]));
      const g = Math.sqrt(Math.max(0.08, 1 - 3 / rr + (2 * this.params.a) / Math.pow(rr, 1.5)));
      const hot = t * t;

      // approaching: gold/white; receding: deep red; inner: redder via g
      const ap = beam;
      const rc = fade * (1.1 - g * 0.5);
      col[i * 3] = (0.85 + 0.5 * hot) * (ap + rc * 0.35) * 0.5;
      col[i * 3 + 1] = (0.4 + 0.5 * hot) * ap * g * 0.4;
      col[i * 3 + 2] = (0.1 + 0.3 * hot) * ap * g * 0.28 + rc * 0.06;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

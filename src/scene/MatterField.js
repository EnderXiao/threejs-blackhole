import * as THREE from 'three';
import { makeKerr } from '../physics/kerr.js';

/**
 * Infalling matter: compact additive points on Kerr-aligned orbits.
 * Visually: warm sparks in a thin disk, not snow.
 */
export class MatterField {
  constructor(count = 8000) {
    this.count = count;
    this.params = { a: 0.9, timeScale: 1, paused: false };
    this.kerr = makeKerr(this.params.a);

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
      const r = 2.4 + Math.pow(u, 1.8) * 13.5;
      this.state.r[i] = r;
      this.state.phi[i] = Math.random() * Math.PI * 2;
      const puff = 0.035 * Math.exp(-r / 5) + 0.008;
      this.state.th[i] = Math.PI / 2 + (Math.random() - 0.5) * puff * 2;
      this.state.vr[i] = -0.001 * Math.random();
      this.state.phase[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.25 + Math.random() * 0.55;
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
          gl_PointSize = aSize * uPixelRatio * (42.0 / dist);
          gl_PointSize = clamp(gl_PointSize, 0.5, 4.5);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.05, length(d));
          gl_FragColor = vec4(vColor, a * 0.22);
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
    const time = performance.now() * 0.001 * this.params.timeScale;

    for (let i = 0; i < this.count; i++) {
      let ri = r[i];
      const om = 1 / (Math.pow(Math.max(ri, 0.5), 1.5) + a);
      // shear animation base
      phi[i] += om * t * 10.0;

      if (ri > isco) {
        vr[i] += (-0.003 / ((ri - isco) + 0.35)) * t;
        vr[i] = Math.max(vr[i], -0.03);
      } else {
        vr[i] += -0.05 * t;
        vr[i] = Math.max(vr[i], -0.15);
      }
      vr[i] *= Math.exp(-0.5 * t);
      ri += vr[i] * t * 18.0;

      // frame-drag swirl near horizon
      if (ri < 4.5) {
        phi[i] += (2.2 * a / (ri * ri * ri + 0.1)) * t * 12.0;
        th[i] += Math.sin(time * 1.3 + phase[i]) * 0.002 * t * Math.max(0, 4.5 - ri);
      }

      if (ri < rh + 0.12) {
        ri = 11 + Math.random() * 5.5;
        vr[i] = 0;
        th[i] = Math.PI / 2 + (Math.random() - 0.5) * 0.04;
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
      const om = 1 / (Math.pow(Math.max(rr, 0.5), 1.5) + this.params.a);
      const beta = Math.min(0.85, om * rr);
      // view-dependent-ish beaming proxy via azimuth
      const beam = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(phi[i]));
      const g = Math.sqrt(Math.max(0.08, 1 - 3 / rr + (2 * this.params.a) / Math.pow(rr, 1.5)));
      const hot = t * t;
      // warm gold / orange only
      col[i * 3] = (0.55 + 0.45 * hot) * beam * g * 0.18;
      col[i * 3 + 1] = (0.22 + 0.38 * hot) * beam * g * 0.12;
      col[i * 3 + 2] = (0.05 + 0.18 * hot) * beam * g * 0.08;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

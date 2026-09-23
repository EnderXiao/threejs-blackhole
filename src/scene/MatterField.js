import * as THREE from 'three';
import { makeKerr } from '../physics/kerr.js';

/**
 * Dense warm-gold infalling matter in the disk annulus.
 * Sparks that would paint the BH silhouette are culled in the vertex shader.
 * Colors: cream/gold approaching, amber receding — never blood-red.
 */
export class MatterField {
  constructor(count = 16000) {
    this.count = count;
    this.params = { a: 0.9, timeScale: 1, paused: false };
    this.kerr = makeKerr(this.params.a);
    this._time = 0;
    this.rMin = 5.3;
    this.rMax = 13.5;

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
      const r = this.rMin + Math.pow(u, 1.25) * (this.rMax - this.rMin);
      this.state.r[i] = r;
      this.state.phi[i] = Math.random() * Math.PI * 2;
      const puff = 0.02 * Math.exp(-r / 5) + 0.004;
      this.state.th[i] = Math.PI / 2 + (Math.random() - 0.5) * puff * 2;
      this.state.vr[i] = -0.0015 * Math.random();
      this.state.phase[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.4 + Math.random() * 0.8;
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
        uCamPos: { value: new THREE.Vector3(0, 7.5, 24) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        uniform float uPixelRatio;
        uniform vec3 uCamPos;
        void main() {
          // Cull sparks that project onto the BH silhouette
          vec3 toBH = -uCamPos;
          vec3 toP  = position - uCamPos;
          float lenBH = max(length(toBH), 0.001);
          float lenP  = max(length(toP), 0.001);
          float cosAng = dot(toBH, toP) / (lenBH * lenP);
          // Cull only INSIDE the silhouette — never in the photon-ring band
          float shadowCos = cos(4.6 / max(lenBH, 1.0));
          float inFront = step(lenP, lenBH + 0.5);
          float occl = smoothstep(shadowCos, shadowCos + 0.002, cosAng) * inFront;
          float inside = smoothstep(4.9, 4.2, length(position));
          float vis = 1.0 - max(occl, inside);

          // Cull inside the same elliptical shadow as the shader (no sticker dust)
          vec4 clipP = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec4 clipB = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 ndcP = clipP.xy / max(clipP.w, 1e-4);
          vec2 ndcB = clipB.xy / max(clipB.w, 1e-4);
          vec2 dxy = (ndcP - ndcB) * vec2(1.0, 1.0);
          // approximate semi-axes in NDC for b_c≈5.2 at current camera distance
          float camDist = max(length(uCamPos), 1.0);
          float pix = (5.2 / camDist) / tan(0.5); // rough NDC scale
          // cover the full shadow + photon ring (generous)
          float axn = pix * 1.25;
          float ayn = pix * 1.25;
          float ell = (dxy.x * dxy.x) / (axn * axn) + (dxy.y * dxy.y) / (ayn * ayn);
          vis *= smoothstep(0.85, 1.2, ell);

          vColor = aColor * vis;
          if (vis < 0.08) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(0.8, -mv.z);
          gl_PointSize = aSize * uPixelRatio * (48.0 / dist);
          gl_PointSize = clamp(gl_PointSize, 0.5, 5.5);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.08, length(d));
          gl_FragColor = vec4(vColor, a * 0.38);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this._writePositions();
  }

  setCameraPosition(v) {
    this.material.uniforms.uCamPos.value.copy(v);
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
    const t = Math.min(dt, 0.05) * this.params.timeScale;
    this._time += t;
    const time = this._time;

    for (let i = 0; i < this.count; i++) {
      let ri = r[i];
      const om = 1 / (Math.pow(Math.max(ri, 0.5), 1.5) + a);
      phi[i] += om * t * 36.0;

      if (ri > isco) {
        vr[i] += (-0.003 / ((ri - isco) + 0.35)) * t;
        vr[i] = Math.max(vr[i], -0.03);
      } else {
        vr[i] += -0.05 * t;
        vr[i] = Math.max(vr[i], -0.12);
      }
      vr[i] *= Math.exp(-0.4 * t);
      ri += vr[i] * t * 18.0;

      if (ri < 5.5) {
        phi[i] += (2.2 * a / (ri * ri * ri + 0.1)) * t * 14.0;
        th[i] += Math.sin(time * 2.0 + phase[i]) * 0.002 * t * Math.max(0, 5.5 - ri);
      }

      if (ri < this.rMin) {
        ri = this.rMax - Math.random() * 1.5;
        vr[i] = 0;
        th[i] = Math.PI / 2 + (Math.random() - 0.5) * 0.025;
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

    for (let i = 0; i < this.count; i++) {
      const rr = r[i];
      const st = Math.sin(th[i]);
      const ct = Math.cos(th[i]);
      pos[i * 3] = rr * st * Math.cos(phi[i]);
      pos[i * 3 + 1] = rr * ct;
      pos[i * 3 + 2] = rr * st * Math.sin(phi[i]);

      // approaching: bright cream/gold · receding: warm amber
      const beam = 0.5 + 0.7 * Math.max(0, Math.sin(phi[i]));
      const dim = 0.5 + 0.5 * Math.max(0, -Math.sin(phi[i]));
      const inner = Math.max(0, 1 - (rr - this.rMin) / 8);
      const hot = inner * inner;

      col[i * 3] = (0.8 + 0.4 * hot) * beam * 0.45 + dim * 0.2;
      col[i * 3 + 1] = (0.48 + 0.38 * hot) * beam * 0.36 + dim * 0.12;
      col[i * 3 + 2] = (0.16 + 0.32 * hot) * beam * 0.24 + dim * 0.04;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
